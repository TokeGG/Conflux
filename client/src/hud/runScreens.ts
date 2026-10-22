// The screens between rooms: run start, reward choice, door choice, and the end of the run. Plain DOM over the canvas; the
// choices are made by clicking, so each screen lets go of the mouse pointer first.
import type { DoorChoice, GameData, RewardOffer, RunState, UnlockLedger } from '@conflux/shared';
import { visiblePatches, patchTime, type PatchEntry } from './patchNotes.ts';
import { describeDoor, describeOffer, elementCombos, endSummary, achievementLines } from './runFormat.ts';
import { elementColour, elementIcon, iconEl, roomIcon, shapeIcon } from './icons.ts';
import './theme.css';
import './runScreens.css';

export type ScreenName = 'none' | 'text' | 'start' | 'reward' | 'doors' | 'end';

export class RunScreens {
  private root = document.createElement('div');
  private current: ScreenName = 'none';
  /** Called from the click of every button that goes back to playing, so the game can take the mouse again. */
  onResume: () => void = () => undefined;

  constructor() {
    this.root.id = 'runscreen';
    document.body.append(this.root);
  }

  get open(): ScreenName {
    return this.current;
  }

  hide(): void {
    this.current = 'none';
    this.root.classList.remove('open');
    this.root.replaceChildren();
  }

  private show(name: ScreenName, ...content: HTMLElement[]): HTMLElement {
    document.exitPointerLock?.();
    this.current = name;
    const panel = el('div', 'panel', ...content);
    this.root.replaceChildren(panel);
    this.root.classList.add('open');
    return panel;
  }

  /** A page of text with a way back (patch notes, credits). */
  text(title: string, lines: string[], onBack: () => void): void {
    this.show('text', el('h2', '', title), el('div', 'scroll', ...lines.map((l) => el('p', '', l))), el('div', 'row', button('go', 'Back', onBack)));
  }

  start(ledger: UnlockLedger, data: GameData, onBegin: () => void, pages?: { patches: PatchEntry[]; credits: () => Promise<string[]> }, daily?: { label: string; best: string; onBegin: () => void }): void {
    const total = Object.keys(data.unlocks).length;
    const back = () => this.start(ledger, data, onBegin, pages, daily);
    const menu: HTMLElement[] = [button('go', 'Begin run', () => (this.onResume(), onBegin()))];
    // the daily run: three elements chosen by the day, locked for the whole run; see how far you get
    if (daily) menu.push(button('go daily', 'Daily run', () => (this.onResume(), daily.onBegin()), el('small', '', daily.label), el('small', '', daily.best)));
    if (pages) {
      menu.push(
        button('plain', 'Patch notes', () => this.text('Patch notes', visiblePatches(pages.patches).flatMap((p) => [`v${p.version}, ${patchTime(p.at)}`, ...p.notes.map((n) => `- ${n}`)]), back)),
        button('plain', 'Credits', () => void pages.credits().then((lines) => this.text('Credits', lines.length ? lines : ['No credits yet.'], back))),
      );
    }
    this.show(
      'start',
      el('div', 'title', 'CONFLUX'),
      el('div', 'tagline', 'Ten elements. Combine them. Descend.'),
      el('div', 'menu', ...menu),
      el('div', 'foot', `${ledger.unlocked.length} of ${total} unlocks earned   |   WASD move   mouse aim   click cast   1 2 3 element   Space jump   Shift dash   Q utility`),
    );
  }

  rewards(offers: RewardOffer[], data: GameData, equipped: string[], onPick: (i: number, slot?: number) => void): void {
    const choose = (): void => {
      const cards = offers.map((o, i) => {
        const t = describeOffer(o, data);
        // an element is picked in two steps: which one, then which of your three keys it takes over
        const click = o.kind === 'element' ? () => replaceWhich(o, i) : () => (this.onResume(), onPick(i));
        const elem = o.element ?? (o.kind === 'skill' && o.id ? data.skills[o.id]?.element : undefined);
        const art = o.kind === 'element' ? elementIcon(o.element) : o.kind === 'skill' ? shapeIcon(o.id ? data.skills[o.id]?.shape.type : undefined) : roomIcon(o.kind);
        const kids = [el('div', 'cico', iconEl(art)), el('div', 'tag', t.tag), el('div', 'title', t.title), el('p', '', t.detail)];
        // hovering an element shows what it combines into with the ones you hold
        if (o.kind === 'element' && o.element) {
          const combos = elementCombos(o.element, equipped, data);
          kids.push(el('div', 'tip', el('b', '', `${o.element[0].toUpperCase()}${o.element.slice(1)} combines with what you hold`), ...(combos.length ? combos.map((c) => el('div', 'combo', iconEl(elementIcon(c.with), elementColour(c.with)), el('span', '', `${c.with[0].toUpperCase()}${c.with.slice(1)}: ${c.text}`))) : [el('div', 'combo', 'No reaction with your three elements yet.')])));
        }
        const card = button(`card ${o.kind}${o.rarity ? ` ${o.rarity}` : ''}`, '', click, ...kids);
        card.style.setProperty('--ec', elementColour(elem));
        if (!elem) card.style.removeProperty('--ec');
        return card;
      });
      this.show('reward', el('h2', '', 'Room cleared. Choose a reward'), el('div', 'row', ...cards), heldRow(equipped));
    };
    const replaceWhich = (o: RewardOffer, i: number): void => {
      const keys = equipped.map((name, slot) => tint(button('card element', '', () => (this.onResume(), onPick(i, slot)), el('div', 'cico', iconEl(elementIcon(name))), el('div', 'tag', `Key ${slot + 1}`), el('div', 'title', `Replace ${name[0].toUpperCase()}${name.slice(1)}`), el('p', '', `${name} goes to the bench with its skills and augments.`)), name));
      this.show('reward', el('h2', '', `Which element does ${o.element} replace?`), el('div', 'row', ...keys), el('div', 'row', button('plain', 'Back', choose)));
    };
    choose();
  }

  /** Which of the three keys a bought element takes over (or back out). */
  pickKey(element: string, equipped: string[], onPick: (slot: number) => void, onCancel: () => void): void {
    const keys = equipped.map((name, slot) => button('card', '', () => (this.hide(), this.onResume(), onPick(slot)), el('div', 'tag', `Key ${slot + 1}`), el('div', 'title', `Replace ${name[0].toUpperCase()}${name.slice(1)}`), el('p', '', `${name} goes to the bench with its skills and augments.`)));
    this.show('reward', el('h2', '', `Which element does ${element} replace?`), el('div', 'row', ...keys), el('div', 'row', button('plain', 'Back', () => (this.hide(), this.onResume(), onCancel()))));
  }

  doors(doors: DoorChoice[], data: GameData, roomNumber: number, onPick: (i: number) => void): void {
    const cards = doors.map((d, i) => {
      const t = describeDoor(d, data);
      const kids = [el('div', 'tag', t.biome), el('div', 'title', `${t.reward} reward`)];
      if (t.badge) kids.push(el('span', 'badge', t.badge));
      return button(`card ${t.badge.toLowerCase()}`, '', () => (this.onResume(), onPick(i)), el('div', 'cico', iconEl(roomIcon(t.badge === 'Boss' ? 'boss' : t.badge === 'Elite' ? 'elite' : 'fight'))), ...kids);
    });
    this.show('doors', el('h2', '', `Room ${roomNumber} done. Choose a door`), el('div', 'row', ...cards));
  }

  end(run: RunState, earned: string[], data: GameData, onAgain: () => void, bestToday = 0, extra: { souls?: number; depth?: number } = {}): void {
    const s = endSummary(run, bestToday);
    const stat = (cls: string, n: number, label: string) => el('div', `stat ${cls}`, el('div', 'n', String(n)), el('div', 'l', label));
    const stats = [stat('rooms', run.history.length, run.history.length === 1 ? 'Room cleared' : 'Rooms cleared')];
    if (extra.depth !== undefined) stats.unshift(stat('depth', extra.depth, 'Depth reached'));
    if (extra.souls !== undefined) stats.push(stat('souls', extra.souls, 'Souls banked'));
    this.show(
      'end',
      el('h1', '', s.headline),
      el('div', 'stats', ...stats),
      el('div', 'end-lines', ...s.lines.filter((l) => !/^(Reached depth \d+|\d+ souls banked|\d+ rooms? cleared)$/.test(l)).map((l) => el('p', '', l))),
      ...achievementLines(earned, data).map((l) => el('p', 'earned', l)),
      el('div', 'row', button('go', 'Main menu', onAgain)),
    );
  }
}

/** The elements you hold, as chips under the reward row (ten element colours all fit). */
function heldRow(equipped: string[]): HTMLElement {
  return el('div', 'held', 'You hold', ...equipped.map((n) => {
    const chip = el('span', 'chip', iconEl(elementIcon(n)), n[0].toUpperCase() + n.slice(1));
    chip.style.setProperty('--ec', elementColour(n));
    return chip;
  }));
}

function tint(b: HTMLElement, element: string): HTMLElement {
  b.style.setProperty('--ec', elementColour(element));
  return b;
}

function el(tag: string, cls: string, ...kids: (HTMLElement | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

function button(cls: string, text: string, onClick: () => void, ...kids: HTMLElement[]): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  if (text) b.textContent = text;
  b.append(...kids);
  b.addEventListener('click', onClick);
  return b;
}
