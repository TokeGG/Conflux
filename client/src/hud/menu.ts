// The Esc menu: Resume, Controls (every key can be changed), Game (mouse and view), Graphics, and a way back to the main menu.
import type { Bindings } from '../input.ts';
import { ACTIONS, keyFor, keyLabel, rebind } from '../keybinds.ts';
import { defaultBindings } from '../input.ts';
import type { Settings } from '../settings.ts';
import './runScreens.css';
import './menu.css';

export interface MenuDeps {
  getSettings(): Settings;
  onSettings(s: Settings): void;
  getBindings(): Bindings;
  onBindings(b: Bindings): void;
  /** Back to playing: called from the click, so the game can take the mouse again. */
  onResume(): void;
  onOpen(): void;
  onQuit(): void;
}

type Tab = 'controls' | 'game' | 'graphics';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class EscMenu {
  private root = h('div');
  private tab: Tab = 'controls';
  private listening: ((e: KeyboardEvent) => void) | null = null;
  private note = '';

  constructor(private d: MenuDeps) {
    this.root.id = 'escmenu';
    this.root.className = 'escmenu';
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open');
  }

  open(): void {
    if (this.isOpen) return;
    this.root.classList.add('open');
    this.d.onOpen();
    this.render();
  }

  close(): void {
    this.stopListening();
    this.root.classList.remove('open');
  }

  /** Resume: closes the menu and gives the mouse back to the game. */
  resume(): void {
    this.close();
    this.d.onResume();
  }

  private stopListening(): void {
    if (this.listening) window.removeEventListener('keydown', this.listening, true);
    this.listening = null;
  }

  private render(): void {
    this.root.replaceChildren();
    const panel = h('div', 'panel');
    panel.append(h('div', 'etitle', 'Paused'));
    const tabs = h('div', 'etabs');
    const tabButton = (id: Tab, label: string) => {
      const b = h('button', `etab${this.tab === id ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => ((this.tab = id), (this.note = ''), this.stopListening(), this.render()));
      return b;
    };
    tabs.append(tabButton('controls', 'Controls'), tabButton('game', 'Game'), tabButton('graphics', 'Graphics'));
    const body = h('div', 'ebody');
    if (this.tab === 'controls') this.controls(body);
    else if (this.tab === 'game') this.game(body);
    else this.graphics(body);
    const foot = h('div', 'efoot');
    const resume = h('button', 'go', 'Resume');
    resume.type = 'button';
    resume.addEventListener('click', () => this.resume());
    const quit = h('button', 'plain', 'Quit to main menu');
    quit.type = 'button';
    quit.addEventListener('click', () => this.d.onQuit());
    foot.append(resume, quit);
    panel.append(tabs, body, foot);
    this.root.append(panel);
  }

  private controls(body: HTMLElement): void {
    const b = this.d.getBindings();
    const list = h('div', 'keylist');
    for (const a of ACTIONS) {
      const row = h('div', 'keyrow');
      row.append(h('span', 'keylabel', a.label));
      const btn = h('button', 'keybtn', keyLabel(keyFor(b, a.id)));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        this.stopListening();
        btn.textContent = 'Press a key...';
        btn.classList.add('listening');
        this.listening = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.stopListening();
          const r = rebind(this.d.getBindings(), a.id, e.code);
          this.note = r.error ?? '';
          if (!r.error) this.d.onBindings(r.bindings);
          this.render();
        };
        window.addEventListener('keydown', this.listening, true);
      });
      row.append(btn);
      list.append(row);
    }
    body.append(list, h('div', 'enote', this.note));
    const reset = h('button', 'plain small', 'Reset to defaults');
    reset.type = 'button';
    reset.addEventListener('click', () => (this.d.onBindings(defaultBindings()), (this.note = ''), this.render()));
    body.append(reset);
  }

  private slider(label: string, min: number, max: number, step: number, value: number, show: (v: number) => string, set: (v: number) => void): HTMLElement {
    const row = h('div', 'keyrow');
    row.append(h('span', 'keylabel', label));
    const out = h('span', 'sval', show(value));
    const input = h('input');
    input.type = 'range';
    Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener('input', () => ((out.textContent = show(Number(input.value))), set(Number(input.value))));
    row.append(input, out);
    return row;
  }

  private check(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
    const row = h('div', 'keyrow');
    const l = h('label');
    const box = h('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => set(box.checked));
    l.append(box, ` ${label}`);
    row.append(l);
    return row;
  }

  private game(body: HTMLElement): void {
    const s = () => this.d.getSettings();
    body.append(
      this.slider('Mouse speed', 0.25, 4, 0.05, s().sensitivity, (v) => `${v.toFixed(2)}x`, (v) => this.d.onSettings({ ...s(), sensitivity: v })),
      this.slider('Field of view', 40, 100, 1, s().fov, (v) => `${v}`, (v) => this.d.onSettings({ ...s(), fov: v })),
    );
  }

  private graphics(body: HTMLElement): void {
    const s = () => this.d.getSettings();
    body.append(
      this.slider('Resolution', 0.75, 1, 0.05, s().renderScale, (v) => `${Math.round(v * 100)}%`, (v) => this.d.onSettings({ ...s(), renderScale: v })),
      this.check('Shadows', s().shadows, (v) => this.d.onSettings({ ...s(), shadows: v })),
      this.check('Smooth edges (applies after a reload)', s().antialias, (v) => this.d.onSettings({ ...s(), antialias: v })),
      this.check('Sprites and particles', s().effects.sprites, (v) => this.d.onSettings({ ...s(), effects: { ...s().effects, sprites: v, particles: v } })),
    );
  }
}
