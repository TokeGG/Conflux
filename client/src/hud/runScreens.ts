// The screens between rooms: run start, reward choice, door choice, and the end of the run. Plain DOM over the canvas; the
// choices are made by clicking, so each screen lets go of the mouse pointer first.
import type { DoorChoice, GameData, RewardOffer, RunState, UnlockLedger } from '@conflux/shared';
import { visiblePatches, patchTime, type PatchEntry } from './patchNotes.ts';
import { describeDoor, describeOffer, endSummary, achievementLines } from './runFormat.ts';
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

  start(ledger: UnlockLedger, data: GameData, onBegin: () => void, pages?: { patches: PatchEntry[]; credits: () => Promise<string[]> }): void {
    const total = Object.keys(data.unlocks).length;
    const back = () => this.start(ledger, data, onBegin, pages);
    const menu: HTMLElement[] = [button('go', 'Begin run', () => (this.onResume(), onBegin()))];
    if (pages) {
      menu.push(
        button('plain', 'Patch notes', () => this.text('Patch notes', visiblePatches(pages.patches).flatMap((p) => [`v${p.version}, ${patchTime(p.at)}`, ...p.notes.map((n) => `- ${n}`)]), back)),
        button('plain', 'Credits', () => void pages.credits().then((lines) => this.text('Credits', lines.length ? lines : ['No credits yet.'], back))),
      );
    }
    this.show(
      'start',
      el('div', 'title', 'CONFLUX'),
      el('div', 'tagline', 'Fire, water, earth and wind. Combine them. Descend.'),
      el('div', 'menu', ...menu),
      el('div', 'foot', `${ledger.unlocked.length} of ${total} unlocks earned   |   WASD move   mouse aim   click cast   1 2 3 4 element   Space jump   Shift dash   Q utility`),
    );
  }

  rewards(offers: RewardOffer[], data: GameData, onPick: (i: number) => void): void {
    const cards = offers.map((o, i) => {
      const t = describeOffer(o, data);
      return button('card', '', () => (this.onResume(), onPick(i)), el('div', 'tag', t.tag), el('div', 'title', t.title), el('p', '', t.detail));
    });
    this.show('reward', el('h2', '', 'Room cleared. Choose a reward'), el('div', 'row', ...cards));
  }

  doors(doors: DoorChoice[], data: GameData, roomNumber: number, onPick: (i: number) => void): void {
    const cards = doors.map((d, i) => {
      const t = describeDoor(d, data);
      const kids = [el('div', 'tag', t.biome), el('div', 'title', `${t.reward} reward`)];
      if (t.badge) kids.push(el('span', 'badge', t.badge));
      return button('card', '', () => (this.onResume(), onPick(i)), ...kids);
    });
    this.show('doors', el('h2', '', `Room ${roomNumber} done. Choose a door`), el('div', 'row', ...cards));
  }

  end(run: RunState, earned: string[], data: GameData, onAgain: () => void): void {
    const s = endSummary(run);
    this.show(
      'end',
      el('h1', '', s.headline),
      ...s.lines.map((l) => el('p', '', l)),
      ...achievementLines(earned, data).map((l) => el('p', 'earned', l)),
      el('div', 'row', button('go', 'New run', () => (this.onResume(), onAgain()))),
    );
  }
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
