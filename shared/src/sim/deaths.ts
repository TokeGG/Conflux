// What a death leaves behind: Hellfire and Plague carry on to whoever stands near the body.
import type { EnemyState } from './state.ts';
import { applyStatus } from './statuses.ts';
import type { Sim } from './sim.ts';

const EPS = 1e-9;

/** Called once an enemy has been removed. Marks that spread on death pass to the enemies round the body. */
export function spreadOnDeath(sim: Sim, dead: EnemyState): void {
  const now = sim.time;
  const hell = dead.marks.hellfire;
  const plague = dead.marks.plague;
  if ((!hell || now >= hell.until - EPS) && (!plague || now >= plague.until - EPS)) return;
  for (const o of sim.enemies) {
    const d = Math.hypot(o.pos.x - dead.pos.x, o.pos.z - dead.pos.z);
    if (hell && now < hell.until - EPS && d <= (hell.radius ?? 4)) {
      applyStatus(sim, o, 'burning', now);
      if (o.statuses.burning) {
        const until = Math.max(o.statuses.burning.until, hell.until);
        o.statuses.burning.until = until;
        o.marks.hellfire = { until, radius: hell.radius };
      }
    }
    if (plague && now < plague.until - EPS && d <= (plague.radius ?? 5)) {
      applyStatus(sim, o, 'poisoned', now);
      applyStatus(sim, o, 'poisoned', now);
      o.marks.plague = { until: plague.until, radius: plague.radius };
    }
  }
}
