// Makes an element a floating window: dragged by its strip, resized from the bottom-right corner, remembered in the browser.
// Double-click the corner for the default size and place.
import { fitWindow, type WinRect } from './winfit.ts';

export interface WindowOptions {
  key: string;
  minW?: number;
  minH?: number;
  /** The place and size when nothing is saved. */
  initial: () => WinRect;
}

export function makeWindow(win: HTMLElement, strip: HTMLElement, opts: WindowOptions): { reset(): void; refit(): void } {
  const minW = opts.minW ?? 340;
  const minH = opts.minH ?? 260;
  const storeKey = `conflux.win.${opts.key}`;
  const page = () => ({ w: window.innerWidth, h: window.innerHeight });
  let rect: WinRect = opts.initial();
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as Partial<WinRect> | null;
    if (saved && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((saved as Record<string, unknown>)[k]))) rect = saved as WinRect;
  } catch {
    /* default place */
  }
  const apply = (r: WinRect): void => {
    rect = fitWindow(r, page(), { minW, minH });
    win.style.left = `${rect.x}px`;
    win.style.top = `${rect.y}px`;
    win.style.width = `${rect.w}px`;
    win.style.height = `${rect.h}px`;
  };
  const save = (): void => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(rect));
    } catch {
      /* not remembered */
    }
  };
  apply(rect);

  // drag by the strip (not when the press lands on a tab, button or field)
  let drag: { px: number; py: number; x: number; y: number } | null = null;
  strip.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, label')) return;
    drag = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y };
    strip.setPointerCapture(e.pointerId);
    document.body.classList.add('dev-dragging');
  });
  strip.addEventListener('pointermove', (e) => {
    if (drag) apply({ ...rect, x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py });
  });
  const endDrag = (): void => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('dev-dragging');
    save();
  };
  strip.addEventListener('pointerup', endDrag);
  strip.addEventListener('pointercancel', endDrag);

  // resize from the corner
  const grip = document.createElement('div');
  grip.className = 'dev-grip';
  grip.title = 'Drag to resize. Double-click for the default size.';
  win.append(grip);
  let size: { px: number; py: number; w: number; h: number } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    size = { px: e.clientX, py: e.clientY, w: rect.w, h: rect.h };
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('dev-dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (size) apply({ ...rect, w: size.w + e.clientX - size.px, h: size.h + e.clientY - size.py });
  });
  const endSize = (): void => {
    if (!size) return;
    size = null;
    document.body.classList.remove('dev-dragging');
    save();
  };
  grip.addEventListener('pointerup', endSize);
  grip.addEventListener('pointercancel', endSize);
  const reset = (): void => {
    apply(opts.initial());
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
  };
  grip.addEventListener('dblclick', (e) => (e.stopPropagation(), reset()));
  window.addEventListener('resize', () => apply(rect));
  return { reset, refit: () => apply(rect) };
}
