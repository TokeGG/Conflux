// Guard stance: tanks and golems raise a guard that cuts most damage, except from their weakness, which breaks it. Reactions ignore it.
import type { Element } from '../types.ts';
import type { EnemyState } from './state.ts';

const EPS = 1e-9;

/** Raises and lowers the guard on its timers. A stagger keeps it down until it ends. */
export function stepGuard(e: EnemyState, now: number): void {
  const g = e.guard;
  const cfg = e.def.guard;
  if (!g || !cfg) return;
  if (g.on && now >= g.until - EPS) {
    g.on = false;
    g.until = now + cfg.offFor;
  } else if (!g.on && now >= g.until - EPS && now >= g.staggeredUntil - EPS) {
    g.on = true;
    g.until = now + cfg.onFor;
  }
}

/** How much of a hit gets through a raised guard, and whether the hit breaks it (a weakness does; a reaction passes straight through). */
export function guardReduction(e: EnemyState, element: Element | 'none', isReaction: boolean): { mul: number; stagger: boolean } {
  const cfg = e.def.guard;
  if (!cfg || !e.guard?.on || isReaction) return { mul: 1, stagger: false };
  if (element !== 'none' && e.def.weak.includes(element)) return { mul: 1, stagger: true };
  return { mul: 1 - cfg.reduction, stagger: false };
}
