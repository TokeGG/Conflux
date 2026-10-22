// Keeps a floating window usable: not smaller than its minimum, not bigger than the page, and with part of its title strip always on screen.
export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How much of a window must stay on the page so it can be grabbed again. */
const KEEP_X = 80;
const KEEP_Y = 40;

export function fitWindow(r: WinRect, page: { w: number; h: number }, min: { minW: number; minH: number }): WinRect {
  const w = Math.round(Math.max(min.minW, Math.min(r.w, page.w)));
  const h = Math.round(Math.max(min.minH, Math.min(r.h, page.h)));
  const x = Math.round(Math.max(KEEP_X - w, Math.min(r.x, page.w - KEEP_X)));
  const y = Math.round(Math.max(0, Math.min(r.y, page.h - KEEP_Y)));
  return { x, y, w, h };
}
