// Reactions: a hit of one element on a target carrying another element's status. The table is data (reactions.json);
// each distinct effect has one handler here, and the numbers come from the row's params.
import type { Element, ReactionDef } from '../types.ts';
import { damageEnemy, hitEnemies } from './skills.ts';
import { applyStatus } from './statuses.ts';
import type { EnemyState, Zone, ZoneEffects } from './state.ts';
import type { Sim } from './sim.ts';

export interface ReactionResult {
  id: string;
  effect: string;
  /** What the reaction itself did to the target (shock chain: to everything it jumped to). */
  damage: number;
  enemyId: number;
}

type Handler = (sim: Sim, e: EnemyState, hitDamage: number, p: Record<string, number>, now: number) => number;

const EPS = 1e-9;
const REACTION_ZONE_TICK = 0.5;

const around = (sim: Sim, e: EnemyState, radius: number) => hitEnemies(sim, { type: 'zone', radius }, e.pos, { x: 0, y: 0, z: 1 }).map((h) => h.enemy);

function burst(sim: Sim, e: EnemyState, id: string, radius: number, amount: number): number {
  let total = 0;
  for (const other of around(sim, e, radius)) {
    damageEnemy(sim, other, amount, `reaction.${id}`, other.pos);
    if (other === e) total += amount;
  }
  return total;
}

function pool(sim: Sim, e: EnemyState, kind: string, radius: number, seconds: number, dps: number, effects?: ZoneEffects): void {
  const z: Zone = {
    id: sim.allocId(),
    kind,
    pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
    radius,
    until: sim.time + seconds,
    ownerId: 0,
    skillId: `reaction.${kind}`,
    yaw: 0,
    width: 0,
    height: 0,
    damage: dps * REACTION_ZONE_TICK,
    tick: REACTION_ZONE_TICK,
    nextTick: sim.time,
    effects,
  };
  sim.zones.push(z);
}

const HANDLERS: Record<string, Handler> = {
  steam(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'steam', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) o.marks.blind = { until: now + p.blindSeconds };
    return total;
  },
  obsidian(_sim, e, _dmg, p, now) {
    e.marks.brittle = { until: now + p.brittleSeconds, damageTakenMul: p.damageTakenMul, speedMul: p.speedMul };
    return 0;
  },
  firestorm(sim, e, dmg, p, now) {
    for (const o of around(sim, e, p.radius)) if (o !== e) applyStatus(sim, o, 'burning', now); // the target's own fire was just used up
    return burst(sim, e, 'firestorm', p.radius, dmg * p.damageMul);
  },
  mud(_sim, e, _dmg, p, now) {
    e.marks.rooted = { until: now + p.rootSeconds, speedMul: 0 };
    e.marks.slowed = { until: now + p.rootSeconds + p.slowSeconds, speedMul: p.slowMul };
    return 0;
  },
  shock_chain(sim, e, dmg, p, now) {
    const hit = new Set<EnemyState>([e]);
    let from = e;
    let total = 0;
    for (let jump = 0; jump < p.jumps; jump++) {
      const next = sim.enemies
        .filter((o) => !hit.has(o) && o.hp > 0 && (o.statuses.soaked?.until ?? 0) > now + EPS && Math.hypot(o.pos.x - from.pos.x, o.pos.z - from.pos.z) <= p.radius)
        .sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.z - from.pos.z) - Math.hypot(b.pos.x - from.pos.x, b.pos.z - from.pos.z) || a.id - b.id)[0];
      if (!next) break;
      hit.add(next);
      damageEnemy(sim, next, dmg * p.damageMul, 'reaction.shock_chain', next.pos);
      total += dmg * p.damageMul;
      from = next;
    }
    return total;
  },
  magma(sim, e, _dmg, p) {
    pool(sim, e, 'magma', p.radius, p.seconds, p.dps);
    return 0;
  },
  sandstorm(sim, e, _dmg, p) {
    pool(sim, e, 'sandstorm', p.radius, p.seconds, p.dps, { blindSeconds: p.blindSeconds });
    return 0;
  },
  fire_tornado(sim, e, dmg, p, now) {
    e.marks.airborne = { until: now + p.seconds, canAct: false };
    const ticks = Math.round(p.seconds / REACTION_ZONE_TICK);
    pool(sim, e, 'fire_tornado', 2, p.seconds, (dmg * p.damageMul) / ticks / REACTION_ZONE_TICK, p.spreadBurning ? { burn: true } : undefined);
    return dmg * p.damageMul;
  },
  rain_cloud(sim, e, _dmg, p) {
    pool(sim, e, 'rain_cloud', p.radius, p.seconds, 0, { soak: true, healPercentPerSecond: p.healPercentPerSecond });
    return 0;
  },
  meteor_slam(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'meteor_slam', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) o.marks.stunned = { until: now + p.stunSeconds, canAct: false };
    return total;
  },
};

/**
 * Resolves the reaction (if any) of a hit of `element` and `hitDamage` on `enemy`. The old status is consumed and the hit's
 * own status is applied afterwards. A reaction on cooldown for this enemy does nothing and consumes nothing.
 */
export function triggerReaction(sim: Sim, enemy: EnemyState, element: Element, hitDamage: number, now: number): ReactionResult | null {
  const row: ReactionDef | undefined = sim.data.reactions.find((r) => r.hitBy === element && (enemy.statuses[r.existing]?.until ?? 0) > now + EPS);
  if (!row) return null;
  const key = `reaction.${row.id}`;
  if (now < (enemy.cooldowns[key] ?? 0) - EPS) return null;
  const handler = HANDLERS[row.effect];
  if (!handler) throw new Error(`reaction ${row.id}: no handler for effect "${row.effect}"`);
  enemy.cooldowns[key] = now + sim.data.reactionCooldown;
  delete enemy.statuses[row.existing];
  const own = sim.data.elements.status[element];
  if (own) applyStatus(sim, enemy, own, now);
  const damage = handler(sim, enemy, hitDamage, row.params, now);
  sim.emit('reaction', { id: row.id, effect: row.effect, enemyId: enemy.id, pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z } });
  return { id: row.id, effect: row.effect, damage, enemyId: enemy.id };
}

/** Resolves several hits that landed on the same tick, lower enemy id first, so the outcome never depends on hit order. */
export function triggerReactions(sim: Sim, hits: { enemy: EnemyState; element: Element; damage: number }[], now: number): (ReactionResult | null)[] {
  return [...hits].sort((a, b) => a.enemy.id - b.enemy.id).map((h) => triggerReaction(sim, h.enemy, h.element, h.damage, now));
}
