// A dev page made of form rows: optional picker for which entry to edit, a search box, the rows, and a reset for the whole page.
import type { GameData } from '@conflux/shared';
import { el } from '../dom.ts';
import { buildForm } from '../form.ts';
import { drawGroups } from '../formView.ts';
import type { DevPage } from '../page.ts';
import type { DevState } from '../devstate.ts';

export interface FormPageOptions {
  id: string;
  title: string;
  state: DevState;
  /** The file's data, to show next to the live values. */
  base: () => GameData;
  /** Paths to show when there is no picker; with a picker, the roots of the chosen entry. */
  roots: (choice: string) => string[];
  picker?: { label: string; options: () => string[] };
  changed(): void;
}

export class FormPage implements DevPage {
  readonly id: string;
  readonly title: string;
  /** Data pages pause the sim while open (the panel can turn that off). */
  readonly pausesSim = true;
  private choice = '';
  private filter = '';
  private rowsHost: HTMLElement | null = null;

  constructor(private o: FormPageOptions) {
    this.id = o.id;
    this.title = o.title;
  }

  private draw(): void {
    if (!this.rowsHost) return;
    const live = this.o.state.layers.current();
    const groups = this.o.roots(this.choice).flatMap((root) => buildForm(live, root, this.o.base()));
    drawGroups(this.rowsHost, groups, this.filter, { state: this.o.state, changed: this.o.changed });
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const head = el('div', { class: 'dev-pagehead' });
    if (this.o.picker) {
      const options = this.o.picker.options();
      if (!options.includes(this.choice)) this.choice = options[0] ?? '';
      const select = el('select', { id: `${this.id}-pick`, title: this.o.picker.label });
      for (const opt of options) {
        const option = el('option', { value: opt }, opt);
        if (opt === this.choice) option.selected = true;
        select.append(option);
      }
      select.addEventListener('change', () => {
        this.choice = select.value;
        this.draw();
      });
      head.append(el('label', {}, `${this.o.picker.label} `), select);
    }
    const search = el('input', { type: 'search', placeholder: 'Search values', class: 'dev-search', id: `${this.id}-search` });
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.draw();
    });
    const resetPage = el('button', { title: 'Put every value on this page back to the file\'s' }, 'Reset page');
    resetPage.addEventListener('click', () => {
      for (const root of this.o.roots(this.choice)) {
        for (const g of buildForm(this.o.state.layers.current(), root, this.o.base())) for (const r of g.rows) this.o.state.revertPath(r.path);
      }
      this.o.changed();
      this.draw();
    });
    head.append(search, resetPage);
    this.rowsHost = el('div', { class: 'dev-rows', id: `${this.id}-rows` });
    host.append(head, this.rowsHost);
    this.draw();
  }

  dispose(): void {
    this.rowsHost = null;
  }
}
