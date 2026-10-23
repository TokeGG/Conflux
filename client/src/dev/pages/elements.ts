// The Elements page: a 10 x 10 grid of the pair reactions (click one to edit its numbers and try it on a dummy), and below it
// each element's status and skills as editable rows. Edits stage, try live and export as patches like every other page.
import { ELEMENTS, type Element, type GameData, type SimBridge } from '@conflux/shared';
import { el } from '../dom.ts';
import { buildForm, type FormGroup } from '../form.ts';
import { drawGroups } from '../formView.ts';
import type { DevPage } from '../page.ts';
import type { DevState } from '../devstate.ts';

export interface ElementsPageOptions {
  state: DevState;
  base: () => GameData;
  bridge: SimBridge;
  /** Sends the tried numbers to the sim (the toolbar's Try). */
  applyNow: () => void;
  changed(): void;
}

/** The reaction row ids laid out as a grid: grid[i][j] is the reaction of ELEMENTS[i] and ELEMENTS[j], null on the diagonal. */
export function reactionGrid(data: GameData): ({ id: string; label: string } | null)[][] {
  return ELEMENTS.map((a) =>
    ELEMENTS.map((b) => {
      if (a === b) return null;
      const row = data.reactions.find((r) => (r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a));
      return row ? { id: row.id, label: row.id.replace(/_/g, ' ') } : null;
    }),
  );
}

const SKILL_ROWS = /\.(damage|cooldown)$/;

export class ElementsPage implements DevPage {
  readonly id = 'elements';
  readonly title = 'Elements';
  /** Trying a pair needs the game running. */
  readonly pausesSim = false;
  private picked: { a: Element; b: Element } | null = null;
  private detail: HTMLElement | null = null;
  private host: HTMLElement | null = null;

  constructor(private o: ElementsPageOptions) {}

  private live(): GameData {
    return this.o.state.layers.current();
  }

  private view(host: HTMLElement, groups: FormGroup[]): void {
    drawGroups(host, groups, '', { state: this.o.state, changed: this.o.changed });
  }

  private drawDetail(): void {
    const box = this.detail;
    if (!box) return;
    box.replaceChildren();
    if (!this.picked) {
      box.append(el('div', { class: 'dev-empty' }, 'Click a cell to edit that reaction.'));
      return;
    }
    const { a, b } = this.picked;
    const row = this.live().reactions.find((r) => (r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a));
    if (!row) {
      box.append(el('div', { class: 'dev-empty' }, `No reaction for ${a} + ${b}.`));
      return;
    }
    const head = el('div', { class: 'dev-pagehead' });
    head.append(el('h4', { id: 'el-title' }, `${row.id.replace(/_/g, ' ')}  (${row.pair[0]} + ${row.pair[1]}, effect ${row.effect})`));
    const tryIt = el('button', { id: 'el-try', title: 'Spawn a dummy beside you, give it the first element\'s status and hit it with the second' }, 'Try it');
    tryIt.addEventListener('click', () => {
      this.o.state.tryNow();
      this.o.applyNow();
      this.o.bridge.command({ op: 'tryReaction', a: row.pair[0], b: row.pair[1] });
      this.o.changed();
    });
    const tryRev = el('button', { id: 'el-try-rev', title: 'The same pair the other way round' }, 'Try reversed');
    tryRev.addEventListener('click', () => {
      this.o.state.tryNow();
      this.o.applyNow();
      this.o.bridge.command({ op: 'tryReaction', a: row.pair[1], b: row.pair[0] });
      this.o.changed();
    });
    head.append(tryIt, tryRev);
    const rows = el('div', { class: 'dev-rows', id: 'el-params' });
    box.append(head, rows);
    this.view(rows, buildForm(this.live(), `reactions.${row.id}.params`, this.o.base()));
  }

  private drawGrid(grid: HTMLElement): void {
    grid.replaceChildren();
    const cells = reactionGrid(this.live());
    grid.append(el('div', { class: 'el-corner' }));
    for (const e of ELEMENTS) grid.append(el('div', { class: 'el-head' }, e));
    ELEMENTS.forEach((a, i) => {
      grid.append(el('div', { class: 'el-head' }, a));
      ELEMENTS.forEach((b, j) => {
        const c = cells[i][j];
        const cell = el('button', { class: 'el-cell', 'data-a': a, 'data-b': b, ...(c ? { 'data-id': c.id } : { disabled: 'true' }) }, c ? c.label : '');
        if (this.picked && ((this.picked.a === a && this.picked.b === b) || (this.picked.a === b && this.picked.b === a))) cell.classList.add('on');
        cell.addEventListener('click', () => {
          this.picked = { a, b };
          this.drawGrid(grid);
          this.drawDetail();
        });
        grid.append(cell);
      });
    });
  }

  private drawElements(host: HTMLElement): void {
    const data = this.live();
    for (const e of ELEMENTS) {
      const box = el('details', { class: 'el-element' });
      box.append(el('summary', {}, e));
      const status = data.elements.reacts[e];
      const groups: FormGroup[] = [];
      if (status) groups.push(...buildForm(data, `statuses.${status}`, this.o.base()).map((g) => ({ title: `status ${status}`, rows: g.rows })));
      const ids = Object.keys(data.skills).filter((k) => data.skills[k].element === e).sort();
      for (const id of ids) {
        for (const g of buildForm(data, `skills.${id}`, this.o.base())) {
          const rows = g.rows.filter((r) => SKILL_ROWS.test(r.path));
          if (rows.length) groups.push({ title: id, rows });
        }
      }
      const rows = el('div', { class: 'dev-rows', 'data-element': e });
      box.append(rows);
      this.view(rows, groups);
      host.append(box);
    }
  }

  render(host: HTMLElement): void {
    this.host = host;
    host.replaceChildren();
    host.append(el('h4', {}, 'Pair reactions'));
    const grid = el('div', { class: 'el-grid', id: 'el-grid' });
    this.detail = el('div', { class: 'el-detail', id: 'el-detail' });
    host.append(grid, this.detail, el('h4', {}, 'Each element: status and skills'));
    this.drawGrid(grid);
    this.drawDetail();
    this.drawElements(host);
  }

  dispose(): void {
    this.detail = null;
    this.host = null;
  }
}
