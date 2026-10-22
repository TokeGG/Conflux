// The crosshair editor, drawn once and used twice: in the Esc menu for every player and on the dev panel's Crosshair page.
// Every change goes through `set` (which saves it and redraws the HUD at once); the live preview shows it on three floors, normal and over an enemy.
import { CROSSHAIR_STYLES, PREVIEW_BACKDROPS, clampCrosshair, crosshairSvg, defaultCrosshair, type CrosshairCfg } from './crosshair.ts';
import './crosshairEditor.css';

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function buildCrosshairEditor(host: HTMLElement, get: () => CrosshairCfg, set: (c: CrosshairCfg) => void): void {
  host.replaceChildren();
  const root = mk('div', 'xh-editor');
  const preview = mk('div', 'xh-preview');
  root.append(mk('div', 'xh-cap', 'Preview: normal, then over an enemy'), preview);
  const paint = (): void => {
    const c = get();
    preview.replaceChildren(
      ...PREVIEW_BACKDROPS.map(({ name, colour }) => {
        const cell = mk('div', 'xh-cell');
        cell.title = name;
        cell.style.background = colour;
        const a = mk('span');
        a.innerHTML = crosshairSvg(c, false);
        const b = mk('span');
        b.innerHTML = crosshairSvg(c, true);
        cell.append(a, b);
        return cell;
      }),
    );
  };
  const change = (patch: Partial<CrosshairCfg>): void => {
    set(clampCrosshair({ ...get(), ...patch }));
    paint();
  };
  const row = (label: string, input: HTMLElement): void => {
    const r = mk('label', 'xh-row');
    r.append(mk('span', '', label), input);
    root.append(r);
  };
  const c = get();
  const show = mk('input');
  show.type = 'checkbox';
  show.checked = c.show;
  show.addEventListener('change', () => change({ show: show.checked }));
  row('Show the crosshair', show);
  const style = mk('select');
  for (const s of CROSSHAIR_STYLES) {
    const o = mk('option', '', s === 'crossdot' ? 'cross and dot' : s);
    o.value = s;
    style.append(o);
  }
  style.value = c.style;
  style.addEventListener('change', () => change({ style: style.value as CrosshairCfg['style'] }));
  row('Style', style);
  const range = (label: string, key: 'size' | 'thickness' | 'gap' | 'opacity', min: number, max: number, step: number): void => {
    const wrap = mk('span', 'xh-range');
    const r = mk('input');
    const n = mk('input', 'xh-num');
    for (const i of [r, n]) Object.assign(i, { min: String(min), max: String(max), step: String(step) });
    r.type = 'range';
    n.type = 'number';
    r.value = n.value = String(c[key]);
    const go = (v: string): void => {
      r.value = n.value = v;
      change({ [key]: Number(v) });
    };
    r.addEventListener('input', () => go(r.value));
    n.addEventListener('change', () => go(n.value));
    wrap.append(r, n);
    row(label, wrap);
  };
  range('Size', 'size', 4, 80, 1);
  range('Thickness', 'thickness', 1, 8, 1);
  range('Gap in the middle', 'gap', 0, 30, 1);
  range('Opacity', 'opacity', 0.1, 1, 0.05);
  const colour = (label: string, key: 'color' | 'hotColor'): void => {
    const i = mk('input');
    i.type = 'color';
    i.value = c[key];
    i.addEventListener('input', () => change({ [key]: i.value }));
    row(label, i);
  };
  colour('Colour', 'color');
  colour('Colour over an enemy', 'hotColor');
  const outline = mk('input');
  outline.type = 'checkbox';
  outline.checked = c.outline;
  outline.addEventListener('change', () => change({ outline: outline.checked }));
  row('Dark outline', outline);
  const reset = mk('button', 'xh-reset', 'Back to the default');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    set(defaultCrosshair());
    buildCrosshairEditor(host, get, set);
  });
  root.append(reset);
  host.append(root);
  paint();
}
