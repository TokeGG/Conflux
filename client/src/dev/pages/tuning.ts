// The Motion tuning page: every object registered in client/src/anim/tuning.ts (the mob motion numbers, and whatever else is registered)
// as sliders and number boxes. Edits apply to the running game at once (these are looks, not rules), can be kept for this browser's
// session, put back, and copied out as JSON. The game keeps running while this page is open so a mob can be watched while it is tuned.
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';
import { tuning as globalTuning, type TuningRegistry, type TuningRow } from '../../anim/tuning.ts';

const show = (v: number | boolean): string => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(Math.round(v * 1e4) / 1e4));

export class TuningPage implements DevPage {
  readonly id = 'tuning';
  readonly title = 'Motion tuning';
  readonly pausesSim = false;
  private host: HTMLElement | null = null;
  private msg: HTMLElement | null = null;
  private choice = '';
  private filter = '';
  private rowsHost: HTMLElement | null = null;

  constructor(
    private storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null,
    private registry: TuningRegistry = globalTuning,
  ) {}

  render(host: HTMLElement): void {
    this.host = host;
    host.replaceChildren();
    const list = this.registry.list();
    if (!list.some((l) => l.name === this.choice)) this.choice = list[0]?.name ?? '';
    const head = el('div', { class: 'dev-pagehead' });
    const pick = el('select', { id: 'tuning-pick', title: 'Which set of numbers' });
    for (const l of list) pick.append(el('option', { value: l.name }, l.title));
    pick.value = this.choice;
    pick.addEventListener('change', () => {
      this.choice = pick.value;
      this.draw();
    });
    const search = el('input', { type: 'search', class: 'dev-search', placeholder: 'Search values', id: 'tuning-search' });
    search.addEventListener('input', () => {
      this.filter = search.value.toLowerCase();
      this.draw();
    });
    const button = (label: string, title: string, fn: () => void) => {
      const b = el('button', { title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    head.append(
      pick,
      search,
      button('Reset this set', 'Put every number of this set back', () => {
        this.registry.reset(this.choice);
        this.say('Put back.');
        this.draw();
      }),
      button('Keep for my session', 'Keep these numbers for every visit in this browser', () => this.say(this.registry.keep(this.storage) ? 'Saved for this browser.' : 'Could not save here; kept for this visit only.')),
      button('Put all back', 'Undo every motion edit and forget the saved ones', () => {
        this.registry.putBack(this.storage);
        this.say('Everything put back.');
        this.draw();
      }),
      button('Copy changes', 'Copy the changed numbers as JSON', () => void this.copy()),
    );
    this.msg = el('div', { class: 'dev-msg', id: 'tuning-msg' }, list.length ? 'Edits apply at once.' : 'Nothing is registered for tuning.');
    this.rowsHost = el('div', { class: 'dev-rows', id: 'tuning-rows' });
    host.append(head, this.msg, this.rowsHost);
    this.draw();
  }

  private say(text: string): void {
    if (this.msg) this.msg.textContent = text;
  }

  private async copy(): Promise<void> {
    const text = this.registry.exportText();
    try {
      await navigator.clipboard.writeText(text);
      this.say(`Copied ${this.registry.changes().length} change(s).`);
    } catch {
      this.say(this.registry.changes().length ? text : 'No changes.');
    }
  }

  private draw(): void {
    const host = this.rowsHost;
    if (!host) return;
    host.replaceChildren();
    const rows = this.registry.rows(this.choice).filter((r) => !this.filter || r.label.toLowerCase().includes(this.filter) || r.path.toLowerCase().includes(this.filter));
    if (!rows.length) {
      host.append(el('div', { class: 'dev-empty' }, 'Nothing matches.'));
      return;
    }
    const box = el('div', { class: 'dev-group' });
    for (const r of rows) box.append(this.row(r));
    host.append(box);
  }

  private row(r: TuningRow): HTMLElement {
    const wrap = el('div', { class: `dev-row dev-tunerow${r.value !== r.default ? ' dev-changed' : ''}`, 'data-path': r.path });
    const msg = el('span', { class: 'dev-rowmsg' });
    const apply = (value: number | boolean): void => {
      const err = this.registry.set(this.choice, r.path, value);
      msg.textContent = err ?? '';
      wrap.classList.toggle('dev-changed', !err && value !== r.default);
    };
    let control: HTMLElement;
    if (r.boolean) {
      const box = el('input', { type: 'checkbox' }) as HTMLInputElement;
      box.checked = r.value === true;
      box.addEventListener('change', () => apply(box.checked));
      control = box;
    } else {
      const num = el('input', { type: 'number', min: String(r.min), max: String(r.max), step: String(r.step), value: String(r.value) }) as HTMLInputElement;
      const range = el('input', { type: 'range', min: String(r.min), max: String(r.max), step: String(r.step), value: String(r.value) }) as HTMLInputElement;
      num.addEventListener('change', () => {
        const v = Number(num.value);
        if (Number.isFinite(v)) range.value = String(v);
        apply(v);
      });
      range.addEventListener('input', () => {
        num.value = range.value;
        apply(Number(range.value));
      });
      const both = el('span', { class: 'dev-castnum' });
      both.append(num, range);
      control = both;
    }
    const file = el('span', { class: 'dev-file' }, `default: ${show(r.default)}`);
    const reset = el('button', { class: 'dev-reset', title: 'Put this value back' }, '↺');
    reset.addEventListener('click', () => {
      this.registry.reset(this.choice, r.path);
      this.draw();
    });
    wrap.append(el('label', { title: `${this.choice}.${r.path}` }, r.label), control, file, reset, msg);
    return wrap;
  }

  dispose(): void {
    this.host = null;
    this.msg = null;
    this.rowsHost = null;
  }
}
