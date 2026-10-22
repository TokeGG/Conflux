// The crosshair: its look is a small config the player (and the dev panel) can edit, saved in the browser and drawn as SVG.
export type CrosshairStyle = 'cross' | 'dot' | 'ring' | 'crossdot';
export const CROSSHAIR_STYLES: CrosshairStyle[] = ['cross', 'dot', 'ring', 'crossdot'];

export interface CrosshairCfg {
  show: boolean;
  style: CrosshairStyle;
  /** Whole width in pixels. */
  size: number;
  thickness: number;
  /** Empty space at the centre of a cross, in pixels. */
  gap: number;
  color: string;
  /** The colour over an enemy. */
  hotColor: string;
  opacity: number;
  /** A dark edge so it shows on bright floors. */
  outline: boolean;
}

const KEY = 'conflux.crosshair';
export const defaultCrosshair = (): CrosshairCfg => ({ show: true, style: 'cross', size: 24, thickness: 2, gap: 6, color: '#ffffff', hotColor: '#ff5a4a', opacity: 0.9, outline: true });

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v: unknown, d: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

/** Any partial or hostile config turned into a valid one. */
export function clampCrosshair(c: Partial<CrosshairCfg>): CrosshairCfg {
  const d = defaultCrosshair();
  return {
    show: typeof c.show === 'boolean' ? c.show : d.show,
    style: CROSSHAIR_STYLES.includes(c.style as CrosshairStyle) ? (c.style as CrosshairStyle) : d.style,
    size: Math.round(num(c.size, 4, 80, d.size)),
    thickness: Math.round(num(c.thickness, 1, 8, d.thickness)),
    gap: Math.round(num(c.gap, 0, 30, d.gap)),
    color: hex(c.color, d.color),
    hotColor: hex(c.hotColor, d.hotColor),
    opacity: num(c.opacity, 0.1, 1, d.opacity),
    outline: typeof c.outline === 'boolean' ? c.outline : d.outline,
  };
}

export function loadCrosshair(storage: { getItem(k: string): string | null } | null): CrosshairCfg {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? clampCrosshair(JSON.parse(raw) as Partial<CrosshairCfg>) : defaultCrosshair();
  } catch {
    return defaultCrosshair();
  }
}

export function saveCrosshair(storage: { setItem(k: string, v: string): void } | null, c: CrosshairCfg): void {
  try {
    storage?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* blocked storage: the crosshair lasts for this visit */
  }
}

/** The crosshair as SVG markup (empty when hidden). The element holding it should be `size` pixels square, centred on the screen. */
export function crosshairSvg(c: CrosshairCfg, hot: boolean): string {
  if (!c.show) return '';
  const colour = hot ? c.hotColor : c.color;
  const half = c.size / 2;
  const t = c.thickness;
  const stroke = (extra = 0) => `stroke="${extra ? '#000' : colour}" stroke-width="${t + extra}" stroke-linecap="butt" opacity="${extra ? c.opacity * 0.7 : c.opacity}"`;
  const parts: string[] = [];
  const lines = (extra: number) => {
    const g = c.gap;
    return [`<line x1="${half}" y1="0" x2="${half}" y2="${half - g}" ${stroke(extra)}/>`, `<line x1="${half}" y1="${half + g}" x2="${half}" y2="${c.size}" ${stroke(extra)}/>`, `<line x1="0" y1="${half}" x2="${half - g}" y2="${half}" ${stroke(extra)}/>`, `<line x1="${half + g}" y1="${half}" x2="${c.size}" y2="${half}" ${stroke(extra)}/>`].join('');
  };
  const dot = (extra: number) => `<circle cx="${half}" cy="${half}" r="${Math.max(1, t) + extra / 2}" fill="${extra ? '#000' : colour}" opacity="${extra ? c.opacity * 0.7 : c.opacity}"/>`;
  const ring = (extra: number) => `<circle cx="${half}" cy="${half}" r="${Math.max(2, half - t)}" fill="none" ${stroke(extra)}/>`;
  const draw = (extra: number) => {
    if (c.style === 'cross') return lines(extra);
    if (c.style === 'dot') return dot(extra);
    if (c.style === 'ring') return ring(extra);
    return lines(extra) + dot(extra);
  };
  if (c.outline) parts.push(draw(2));
  parts.push(draw(0));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.size}" height="${c.size}" viewBox="0 0 ${c.size} ${c.size}" overflow="visible">${parts.join('')}</svg>`;
}

/** The floors the preview is drawn on, so the crosshair is checked against dark, mid and bright ground. */
export const PREVIEW_BACKDROPS: { name: string; colour: string }[] = [
  { name: 'floor', colour: '#3a3f4c' },
  { name: 'dark', colour: '#1a1d26' },
  { name: 'bright', colour: '#c9c2a8' },
];
