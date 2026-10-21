// The dev panel: F2 (or the small button) opens it. A toolbar for tuning edits, a list of pages, and the Changes drawer.
import type { SimBridge } from '@conflux/shared';
import { el } from './dom.ts';
import type { DevPage } from './page.ts';
import type { DevState } from './devstate.ts';
import './dev.css';

export class DevPanel {
  readonly root: HTMLElement;
  private pages: DevPage[] = [];
  private current: DevPage | null = null;
  private body: HTMLElement;
  private nav: HTMLElement;
  private msg: HTMLElement;
  private drawer: HTMLElement;
  private changesBtn: HTMLButtonElement;
  private isOpen = false;
  private filter = '';
  private pauseWhileEditing = true;
  private pausedByPanel = false;

  constructor(
    readonly state: DevState,
    readonly bridge: SimBridge,
    private onDataChanged: () => void = () => {},
  ) {
    this.root = el('div', { id: 'devpanel', hidden: '' });
    const head = el('header', { class: 'dev-head' });
    head.append(el('b', {}, 'Dev'));
    const search = el('input', { type: 'search', placeholder: 'Search pages', class: 'dev-search' });
    search.addEventListener('input', () => {
      this.filter = search.value.toLowerCase();
      this.drawNav();
    });
    const close = el('button', { title: 'Close (F2)' }, '✕');
    close.addEventListener('click', () => this.hide());
    head.append(search, close);

    const bar = el('div', { class: 'dev-bar' });
    const button = (label: string, title: string, fn: () => void) => {
      const b = el('button', { title }, label);
      b.addEventListener('click', fn);
      bar.append(b);
      return b;
    };
    button('Try now', 'Use the staged edits in this run', () => this.report(this.state.tryNow()));
    button('Keep for my session', 'Keep the edits for every run in this browser', () => this.say(this.state.keep() ? 'Saved for this browser.' : 'Could not save here; kept for this visit only.'));
    button('Put all back', 'Undo every edit', () => (this.state.putBack(), this.say('Everything put back.')));
    button('Copy changes', 'Copy the edits as JSON to paste back to Claude', () => void this.copyChanges());
    this.changesBtn = button('Changes (0)', 'Every changed value, old to new', () => this.toggleDrawer());

    const pauseLabel = el('label', { class: 'dev-check', title: 'Stop the game while a data page is open' });
    const pauseBox = el('input', { type: 'checkbox', id: 'dev-pause-edit' });
    pauseBox.checked = true;
    pauseBox.addEventListener('change', () => {
      this.pauseWhileEditing = pauseBox.checked;
      this.syncPause();
    });
    pauseLabel.append(pauseBox, ' Pause while editing');
    bar.append(pauseLabel);

    this.msg = el('div', { class: 'dev-msg', id: 'dev-msg' });
    this.drawer = el('div', { class: 'dev-drawer', hidden: '' });
    this.nav = el('nav', { class: 'dev-nav' });
    this.body = el('section', { class: 'dev-body', id: 'devpage' });
    this.root.append(head, bar, this.msg, this.drawer, this.nav, this.body);
    document.body.append(this.root);

    const openBtn = el('button', { id: 'devbtn', title: 'Dev panel (F2)' }, '🛠 Dev');
    openBtn.addEventListener('click', () => this.toggle());
    document.body.append(openBtn);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        this.toggle();
      }
    });
    this.updateCount();
  }

  /** Redraws the Changes count and list (pages call this after an edit). */
  refresh(): void {
    this.updateCount();
    this.drawChanges();
  }

  registerPage(page: DevPage): void {
    this.pages.push(page);
    this.drawNav();
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    this.isOpen = true;
    this.root.hidden = false;
    this.showPage(this.current?.id ?? this.pages[0]?.id);
    this.syncPause();
  }

  hide(): void {
    this.isOpen = false;
    this.root.hidden = true;
    this.current?.dispose?.();
    this.syncPause();
  }

  showPage(id: string | undefined): void {
    const page = this.pages.find((p) => p.id === id);
    if (!page) return;
    this.current?.dispose?.();
    this.current = page;
    page.render(this.body);
    this.drawNav();
    this.syncPause();
  }

  /** The sim is held while a data page is open and the toggle is on; it runs again when the panel closes or moves to another kind of page. */
  private syncPause(): void {
    const want = this.isOpen && this.pauseWhileEditing && !!this.current?.pausesSim;
    if (want === this.pausedByPanel) return;
    this.pausedByPanel = want;
    this.bridge.command({ op: 'pause', on: want });
  }

  private drawNav(): void {
    this.nav.replaceChildren(
      ...this.pages
        .filter((p) => p.title.toLowerCase().includes(this.filter))
        .map((p) => {
          const b = el('button', { class: p === this.current ? 'dev-on' : '' }, p.title);
          b.addEventListener('click', () => this.showPage(p.id));
          return b;
        }),
    );
  }

  private say(text: string): void {
    this.msg.textContent = text;
    this.updateCount();
    this.drawChanges();
  }

  private report(errors: string[]): void {
    this.onDataChanged();
    this.say(errors.length ? `Some edits were refused: ${errors.join('; ')}` : 'Edits are in use in this run.');
  }

  private async copyChanges(): Promise<void> {
    const text = this.state.changesText();
    try {
      await navigator.clipboard.writeText(text);
      this.say(`Copied ${this.state.layers.patches().length} change(s).`);
    } catch {
      this.say('Could not use the clipboard; the changes are shown in the Changes list.');
    }
  }

  private toggleDrawer(): void {
    this.drawer.hidden = !this.drawer.hidden;
    this.drawChanges();
  }

  private updateCount(): void {
    this.changesBtn.textContent = `Changes (${this.state.layers.changes().length + this.state.staged.length})`;
  }

  private drawChanges(): void {
    if (this.drawer.hidden) return;
    const rows = this.state.layers.changes();
    const list = rows.map((r) => {
      const row = el('div', { class: 'dev-change' });
      row.append(el('code', {}, r.path), el('span', {}, ` ${String(r.from)} → ${String(r.to)} (${r.layer})`));
      const undo = el('button', {}, 'Undo');
      undo.addEventListener('click', () => {
        this.state.layers.revert(r.path);
        this.onDataChanged();
        this.say(`Put ${r.path} back.`);
      });
      row.append(undo);
      return row;
    });
    for (const p of this.state.staged) list.push(el('div', { class: 'dev-change dev-staged' }, `${p.path} → ${String(p.value)} (not tried yet)`));
    this.drawer.replaceChildren(...(list.length ? list : [el('div', {}, 'No changes.')]));
  }
}
