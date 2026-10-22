import { CROSSHAIR_STYLES, clampCrosshair, crosshairSvg, defaultCrosshair, type CrosshairCfg } from '../../crosshair.ts';
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';

/** The crosshair editor: every change is drawn on the HUD at once and remembered in this browser. */
export class CrosshairPage implements DevPage {
  readonly id = 'crosshair';
  readonly title = 'Crosshair';

  constructor(
    private get: () => CrosshairCfg,
    private set: (c: CrosshairCfg) => void,
  ) {}

  render(host: HTMLElement): void {
    host.replaceChildren();
    const section = el('div', { class: 'dev-section' });
    section.append(el('h4', {}, 'Crosshair'));
    const preview = el('div', { class: 'dev-xh-preview' });
    const paint = (): void => {
      const c = this.get();
      preview.replaceChildren(...[['#3a3f4c', 'floor'], ['#1a1d26', 'dark'], ['#c9c2a8', 'bright']].map(([bg, name]) => {
        const cell = el('div', { class: 'dev-xh-cell', title: name });
        cell.style.background = bg;
        const a = el('span');
        a.innerHTML = crosshairSvg(c, false);
        const b = el('span');
        b.innerHTML = crosshairSvg(c, true);
        cell.append(a, b);
        return cell;
      }));
    };
    const change = (patch: Partial<CrosshairCfg>): void => {
      this.set(clampCrosshair({ ...this.get(), ...patch }));
      paint();
    };
    const row = (label: string, input: HTMLElement): void => {
      const r = el('label', { class: 'dev-xh-row' });
      r.append(el('span', {}, label), input);
      section.append(r);
    };
    const c = this.get();
    const show = el('input', { type: 'checkbox' });
    show.checked = c.show;
    show.addEventListener('change', () => change({ show: show.checked }));
    row('Show the crosshair', show);
    const style = el('select');
    for (const s of CROSSHAIR_STYLES) style.append(el('option', { value: s }, s === 'crossdot' ? 'cross and dot' : s));
    style.value = c.style;
    style.addEventListener('change', () => change({ style: style.value as CrosshairCfg['style'] }));
    row('Style', style);
    const range = (label: string, key: 'size' | 'thickness' | 'gap' | 'opacity', min: number, max: number, step: number): void => {
      const wrap = el('span', { class: 'dev-xh-range' });
      const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
      const n = el('input', { type: 'number', min: String(min), max: String(max), step: String(step), class: 'dev-num' });
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
      const i = el('input', { type: 'color' });
      i.value = c[key];
      i.addEventListener('input', () => change({ [key]: i.value }));
      row(label, i);
    };
    colour('Colour', 'color');
    colour('Colour over an enemy', 'hotColor');
    const outline = el('input', { type: 'checkbox' });
    outline.checked = c.outline;
    outline.addEventListener('change', () => change({ outline: outline.checked }));
    row('Dark outline', outline);
    const reset = el('button', {}, 'Back to the default');
    reset.addEventListener('click', () => {
      this.set(defaultCrosshair());
      this.render(host);
    });
    section.append(reset, el('h4', {}, 'Preview (normal, then over an enemy)'), preview);
    host.append(section);
    paint();
  }
}
