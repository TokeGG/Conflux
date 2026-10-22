// Reactions: a hit of one element on a target carrying another element's status. The table is data (reactions.json): one row
// for every pair of elements, which works in either order. Each row names an effect; every effect is built here from a few
// reusable kinds (burst, pool, chain, pull, debuff, heal, reflect, spread, haste, slow) with the numbers taken from the row's params.
import { ELEMENTS, type Element, type ReactionDef, type StatusId } from '../types.ts';
import { damageEnemy, hitEnemies } from './skills.ts';
import { applyStatus } from './statuses.ts';
import type { EnemyState, Mark, MarkId, Zone, ZoneEffects } from './state.ts';
import type { Sim } from './sim.ts';

export interface ReactionResult {
  id: string;
  effect: string;
  /** What the reaction itself did to the target (a chain: to everything it jumped to). */
  damage: number;
  enemyId: number;
}

/** What led to the reaction: the status that was on the target (now used up) and how many stacks it had. */
interface Ctx {
  consumed: StatusId;
  stacks: number;
  /** The element that was hit and the one whose status was on the target. */
  hit: Element;
  other: Element;
}

type Handler = (sim: Sim, e: EnemyState, hitDamage: number, p: Record<string, number>, now: number, ctx: Ctx) => number;

const EPS = 1e-9;
const REACTION_ZONE_TICK = 0.5;
const UP = { x: 0, y: 0, z: 1 };

const active = (e: EnemyState, s: StatusId, now: number) => (e.statuses[s]?.until ?? 0) > now + EPS;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const bodyOf = (e: EnemyState) => Math.max(0.4, ...e.def.hurtboxes.map((h) => h.r));

// ---- reusable effect kinds -------------------------------------------------------------------------------------------

/** Everything within `radius` of the target (the target included), in id order. */
const around = (sim: Sim, e: EnemyState, radius: number) => hitEnemies(sim, { type: 'zone', radius }, e.pos, UP).map((h) => h.enemy);

/** Damage to everything in the radius; returns what the target itself took. */
function burst(sim: Sim, e: EnemyState, id: string, radius: number, amount: number): number {
  let total = 0;
  for (const other of around(sim, e, radius)) {
    damageEnemy(sim, other, amount, `reaction.${id}`, other.pos);
    if (other === e) total += amount;
  }
  return total;
}

/** A ground effect that stays: it hurts and affects whatever stands in it. */
function pool(sim: Sim, at: { x: number; y: number; z: number }, kind: string, radius: number, seconds: number, dps: number, effects?: ZoneEffects): Zone {
  const z: Zone = {
    id: sim.allocId(),
    kind,
    pos: { x: at.x, y: at.y, z: at.z },
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
  return z;
}

interface ChainOpts {
  id: string;
  jumps: number;
  radius: number;
  damage: number;
  /** Hits dealt at every enemy the arc reaches. */
  hits?: number;
  /** Only enemies carrying this status are jumped to. */
  needs?: StatusId;
  /** A status every enemy the arc reaches is left with. */
  leaves?: StatusId;
}

/** An arc from `start` to the nearest enemy not yet hit, and on from there. Returns the damage dealt along it. */
function chain(sim: Sim, start: EnemyState, o: ChainOpts, now: number): number {
  const hit = new Set<EnemyState>([start]);
  let from = start;
  let total = 0;
  if (o.leaves) applyStatus(sim, start, o.leaves, now);
  for (let jump = 0; jump < o.jumps; jump++) {
    const next = sim.enemies
      .filter((x) => !hit.has(x) && x.hp > 0 && x.aiState !== 'buried' && (!o.needs || active(x, o.needs, now)) && dist(x.pos, from.pos) <= o.radius)
      .sort((a, b) => dist(a.pos, from.pos) - dist(b.pos, from.pos) || a.id - b.id)[0];
    if (!next) break;
    hit.add(next);
    for (let h = 0; h < (o.hits ?? 1); h++) {
      damageEnemy(sim, next, o.damage, `reaction.${o.id}`, next.pos);
      total += o.damage;
    }
    if (o.leaves) applyStatus(sim, next, o.leaves, now);
    from = next;
  }
  return total;
}

/** Drags every enemy within `radius` of the point toward it, by at most `distance` metres, never into a wall. */
function pull(sim: Sim, centre: { x: number; z: number }, radius: number, distance: number, skip?: EnemyState): void {
  for (const o of sim.enemies) {
    if (o === skip || o.hp <= 0 || o.aiState === 'buried') continue;
    const d = dist(o.pos, centre);
    if (d > radius || d < 0.3) continue;
    const r = bodyOf(o);
    for (const share of [1, 0.5, 0.25]) {
      const step = Math.min(distance * share, d - 0.2);
      if (step <= 0) break;
      const x = o.pos.x + ((centre.x - o.pos.x) / d) * step;
      const z = o.pos.z + ((centre.z - o.pos.z) / d) * step;
      if (!sim.world.blocked({ x, y: o.pos.y, z }, r)) {
        o.pos.x = x;
        o.pos.z = z;
        break;
      }
    }
  }
}

/** Puts a timed mark on an enemy. */
function mark(e: EnemyState, id: MarkId, m: Mark): void {
  e.marks[id] = m;
}

/** A broken-armour mark: the target takes more damage, and can bleed rust besides. Stacks add to the damage taken. */
function armour(e: EnemyState, now: number, seconds: number, mulPerStack: number, stacks: number, maxStacks: number, dps = 0): void {
  const have = e.marks.corroded && now < e.marks.corroded.until - EPS ? e.marks.corroded.stacks ?? 1 : 0;
  const n = Math.min(maxStacks, have + stacks);
  mark(e, 'corroded', { until: now + seconds, stacks: n, damageTakenMul: 1 + mulPerStack * n, ...(dps > 0 ? { dps, nextTick: now + REACTION_ZONE_TICK } : {}) });
}

/** Heals the player, never above full health. */
function healPlayer(sim: Sim, amount: number): void {
  const p = sim.player;
  p.hp = Math.min(sim.data.player.health, p.hp + amount);
}

const stun = (e: EnemyState, now: number, seconds: number) => mark(e, 'stunned', { until: now + seconds, canAct: false });
const blind = (e: EnemyState, now: number, seconds: number) => mark(e, 'blind', { until: now + seconds });

// ---- the 45 effects --------------------------------------------------------------------------------------------------

const HANDLERS: Record<string, Handler> = {
  // fire
  steam(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'steam', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) blind(o, now, p.blindSeconds);
    return total;
  },
  magma(sim, e, _dmg, p, now) {
    mark(e, 'brittle', { until: now + p.brittleSeconds, damageTakenMul: p.damageTakenMul, speedMul: p.speedMul }); // the obsidian crust
    pool(sim, e.pos, 'magma', p.radius, p.seconds, p.dps);
    return 0;
  },
  firestorm(sim, e, dmg, p, now) {
    for (const o of around(sim, e, p.radius)) if (o !== e) applyStatus(sim, o, 'burning', now); // the target's own fire was just used up
    return burst(sim, e, 'firestorm', p.radius, dmg * p.damageMul);
  },
  plasma(sim, e, dmg, p) {
    return burst(sim, e, 'plasma', p.radius, dmg * p.damageMul);
  },
  overheat(sim, e, _dmg, p, now) {
    applyStatus(sim, e, 'burning', now); // the fire goes on, only faster
    mark(e, 'overheat', { until: now + p.seconds, rate: p.rate });
    return 0;
  },
  toxic_blaze(sim, e, dmg, p, now, ctx) {
    const stacks = Math.max(1, ctx.consumed === 'poisoned' ? ctx.stacks : e.statuses.poisoned?.stacks ?? 1);
    const total = burst(sim, e, 'toxic_blaze', p.radius, dmg * (p.damageMul + p.perStack * stacks));
    for (const o of around(sim, e, p.radius)) delete o.statuses.poisoned; // the cloud is used up
    void now;
    return total;
  },
  solar_flare(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'solar_flare', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) blind(o, now, p.blindSeconds);
    return total;
  },
  hellfire(sim, e, _dmg, p, now) {
    applyStatus(sim, e, 'burning', now);
    const burning = e.statuses.burning;
    if (burning) burning.until = now + p.seconds; // it burns for the whole curse, and nothing puts it out
    mark(e, 'hellfire', { until: now + p.seconds, radius: p.radius });
    return 0;
  },
  forge(sim, e, _dmg, p, now) {
    armour(e, now, p.armourSeconds, p.damageTakenMul - 1, 1, 1);
    pool(sim, e.pos, 'slag', p.radius, p.seconds, p.dps);
    return 0;
  },

  // water
  mud(_sim, e, _dmg, p, now) {
    mark(e, 'rooted', { until: now + p.rootSeconds, speedMul: 0 });
    mark(e, 'slowed', { until: now + p.rootSeconds + p.slowSeconds, speedMul: p.slowMul });
    return 0;
  },
  rain_cloud(sim, e, _dmg, p) {
    pool(sim, e.pos, 'rain_cloud', p.radius, p.seconds, 0, { status: 'soaked', healPercentPerSecond: p.healPercentPerSecond });
    return 0;
  },
  chain_lightning(sim, e, dmg, p, now) {
    return chain(sim, e, { id: 'chain_lightning', jumps: p.jumps, radius: p.radius, damage: dmg * p.damageMul, needs: 'soaked', leaves: 'shocked' }, now);
  },
  stasis(_sim, e, _dmg, p, now) {
    mark(e, 'stasis', { until: now + p.seconds, canAct: false, speedMul: 0 });
    return 0;
  },
  toxic_flood(sim, e, _dmg, p) {
    pool(sim, e.pos, 'toxic_flood', p.radius, p.seconds, p.dps, { status: 'poisoned', growPerSecond: p.grow });
    return 0;
  },
  prism(sim, e, dmg, p, now) {
    const near = sim.enemies
      .filter((o) => o !== e && o.hp > 0 && o.aiState !== 'buried' && dist(o.pos, e.pos) <= p.radius)
      .sort((a, b) => dist(a.pos, e.pos) - dist(b.pos, e.pos) || a.id - b.id)
      .slice(0, p.count);
    for (const o of near) {
      damageEnemy(sim, o, dmg * p.damageMul, 'reaction.prism', o.pos);
      applyStatus(sim, o, 'exposed', now);
    }
    return 0;
  },
  whirlpool(sim, e, _dmg, p) {
    pool(sim, e.pos, 'whirlpool', p.radius, p.seconds, p.dps, { pull: p.pull });
    pull(sim, e.pos, p.radius, p.pull, e);
    return 0;
  },
  rust(_sim, e, _dmg, p, now) {
    armour(e, now, p.seconds, p.damageTakenMul - 1, 1, 1, p.dps);
    return 0;
  },

  // earth
  sandstorm(sim, e, _dmg, p) {
    pool(sim, e.pos, 'sandstorm', p.radius, p.seconds, p.dps, { blindSeconds: p.blindSeconds });
    return 0;
  },
  fulgurite(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'fulgurite', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) {
      stun(o, now, p.stunSeconds);
      applyStatus(sim, o, 'rent', now); // the glass shards cut
    }
    return total;
  },
  petrify(_sim, e, _dmg, p, now) {
    mark(e, 'petrified', { until: now + p.seconds, speedMul: p.speedMul, damageTakenMul: p.damageTakenMul });
    return 0;
  },
  spore_bloom(sim, e, _dmg, p) {
    pool(sim, e.pos, 'spore_bloom', p.radius, p.seconds, p.dps, { status: 'poisoned' });
    return 0;
  },
  crystal(sim, e, _dmg, p) {
    pool(sim, e.pos, 'crystal', p.radius, p.seconds, p.dps, { reflect: true });
    return 0;
  },
  sinkhole(sim, e, _dmg, p, now) {
    mark(e, 'rooted', { until: now + 0.6, speedMul: 0 });
    pool(sim, e.pos, 'sinkhole', p.radius, p.seconds, p.dps, { hold: true });
    return 0;
  },
  ore_shards(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'ore_shards', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) applyStatus(sim, o, 'rent', now);
    return total;
  },

  // wind
  thunderstorm(sim, e, _dmg, p, now) {
    pool(sim, e.pos, 'thunderstorm', p.radius, p.seconds, 0, { strikeEvery: p.strikeEvery, strikeDamage: p.strikeDamage, strikeNext: now + p.strikeEvery });
    return 0;
  },
  time_rift(sim, e, _dmg, p) {
    pool(sim, e.pos, 'time_rift', p.radius, p.seconds, 0, { slowMul: p.slowMul });
    return 0;
  },
  miasma(sim, e, _dmg, p, now) {
    for (const o of around(sim, e, p.radius)) applyStatus(sim, o, 'poisoned', now);
    pool(sim, e.pos, 'miasma', p.cloudRadius, p.seconds, p.dps, { status: 'poisoned' });
    return 0;
  },
  aurora(sim, e, _dmg, p, now) {
    for (const o of around(sim, e, p.radius)) applyStatus(sim, o, 'exposed', now);
    sim.player.marks.swift = { until: now + p.seconds, speedMul: p.speedMul };
    return 0;
  },
  vacuum(sim, e, dmg, p) {
    pull(sim, e.pos, p.radius, p.radius, e);
    return burst(sim, e, 'vacuum', 2.5, dmg * p.damageMul);
  },
  razor_wind(sim, e, dmg, p, now) {
    let total = 0;
    for (const o of around(sim, e, p.radius)) {
      for (let h = 0; h < p.hits; h++) {
        damageEnemy(sim, o, dmg * p.damageMul, 'reaction.razor_wind', o.pos);
        if (o === e) total += dmg * p.damageMul;
      }
      applyStatus(sim, o, 'rent', now);
    }
    return total;
  },

  // lightning
  overclock(sim, e, dmg, p, now) {
    let total = 0;
    for (let pass = 0; pass < p.passes; pass++) total += chain(sim, e, { id: 'overclock', jumps: p.jumps, radius: p.radius, damage: dmg * p.damageMul, leaves: 'shocked' }, now);
    return total;
  },
  toxic_arc(sim, e, dmg, p, now) {
    return chain(sim, e, { id: 'toxic_arc', jumps: p.jumps, radius: p.radius, damage: dmg * p.damageMul, leaves: 'poisoned' }, now);
  },
  radiant_bolt(sim, e, dmg, p, now) {
    const from = sim.player.pos;
    const d = dist(e.pos, from) || 1;
    const dir = { x: (e.pos.x - from.x) / d, z: (e.pos.z - from.z) / d };
    let total = 0;
    for (const o of [...sim.enemies]) {
      if (o.hp <= 0 || o.aiState === 'buried') continue;
      const rx = o.pos.x - from.x;
      const rz = o.pos.z - from.z;
      const along = rx * dir.x + rz * dir.z;
      const off = Math.abs(rx * dir.z - rz * dir.x);
      if (along < 0 || along > p.length || off > p.width / 2 + bodyOf(o)) continue;
      damageEnemy(sim, o, dmg * p.damageMul, 'reaction.radiant_bolt', o.pos);
      applyStatus(sim, o, 'exposed', now);
      if (o === e) total += dmg * p.damageMul;
    }
    return total;
  },
  void_arc(sim, e, dmg, p, now) {
    return chain(sim, e, { id: 'void_arc', jumps: p.jumps, radius: p.radius, damage: dmg * p.damageMul, leaves: 'cursed' }, now);
  },
  conduction(sim, e, dmg, p, now) {
    return chain(sim, e, { id: 'conduction', jumps: p.jumps, radius: p.radius, damage: dmg * p.damageMul, hits: p.hits, leaves: 'rent' }, now);
  },

  // time
  wither(sim, e, _dmg, p, now, ctx) {
    const poison = sim.data.statuses.poisoned;
    const left = ctx.consumed === 'poisoned' ? ctx.stacks : e.statuses.poisoned?.stacks ?? 1;
    const ticksLeft = Math.max(1, Math.round(poison.duration / (poison.tickInterval ?? 1)));
    const amount = (poison.tickDamage ?? 0) * left * ticksLeft * p.damageMul;
    delete e.statuses.poisoned;
    void now;
    damageEnemy(sim, e, amount, 'reaction.wither', e.pos);
    return amount;
  },
  haste_aura(sim, _e, _dmg, p, now) {
    sim.player.marks.haste = { until: now + p.seconds, rate: p.rate };
    return 0;
  },
  rewind_curse(sim, e, _dmg, p, now) {
    const recent = e.dmgLog.filter((l) => l.t >= now - p.seconds - EPS).reduce((sum, l) => sum + l.a, 0);
    applyStatus(sim, e, 'cursed', now);
    const amount = recent * p.fraction;
    if (amount > 0) damageEnemy(sim, e, amount, 'reaction.rewind_curse', e.pos);
    return amount;
  },
  fatigue(_sim, e, _dmg, p, now) {
    mark(e, 'fatigue', { until: now + p.seconds, ramp: p.ramp, cap: p.cap, since: now });
    return 0;
  },

  // poison
  purge(sim, e, _dmg, p, now, ctx) {
    let stacks = ctx.consumed === 'poisoned' ? ctx.stacks : 0;
    for (const o of around(sim, e, p.radius)) {
      if (active(o, 'poisoned', now)) stacks += o.statuses.poisoned?.stacks ?? 1;
      delete o.statuses.poisoned;
    }
    healPlayer(sim, stacks * p.healPerStack);
    return 0;
  },
  plague(sim, e, _dmg, p, now) {
    applyStatus(sim, e, 'poisoned', now);
    applyStatus(sim, e, 'poisoned', now);
    mark(e, 'plague', { until: now + p.seconds, radius: p.radius });
    return 0;
  },
  corrosion(_sim, e, _dmg, p, now) {
    armour(e, now, p.seconds, p.damageTakenPerStack, 1, p.maxStacks);
    return 0;
  },

  // light, dark, metal
  eclipse(sim, e, dmg, p, now) {
    const total = burst(sim, e, 'eclipse', p.radius, dmg * p.damageMul);
    for (const o of around(sim, e, p.radius)) {
      delete o.statuses.exposed;
      delete o.statuses.cursed;
      stun(o, now, p.stunSeconds);
    }
    delete e.statuses.exposed;
    delete e.statuses.cursed;
    return total;
  },
  mirror(sim, _e, _dmg, p) {
    pool(sim, sim.player.pos, 'mirror', p.radius, p.seconds, 0, { reflect: true });
    return 0;
  },
  cursed_steel(_sim, e, _dmg, p, now) {
    mark(e, 'leech', { until: now + p.seconds, heal: p.heal });
    return 0;
  },
};

/** The reaction row for a pair of elements, in either order. */
export function reactionFor(rows: readonly ReactionDef[], a: Element, b: Element): ReactionDef | undefined {
  return rows.find((r) => (r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a));
}

/** The effect names that have a handler (the data check uses it). */
export const REACTION_EFFECTS: readonly string[] = Object.keys(HANDLERS);

/**
 * Resolves the reaction (if any) of a hit of `element` and `hitDamage` on `enemy`: the target carries the status of some other
 * element, and the pair has a row. The old status is consumed and the hit's own status is applied afterwards. A reaction on
 * cooldown for this enemy does nothing and consumes nothing.
 */
export function triggerReaction(sim: Sim, enemy: EnemyState, element: Element, hitDamage: number, now: number): ReactionResult | null {
  for (const other of ELEMENTS) {
    if (other === element) continue;
    const status = sim.data.elements.reacts[other];
    const have = enemy.statuses[status];
    if (!have || have.until <= now + EPS) continue;
    const row = reactionFor(sim.data.reactions, element, other);
    if (!row) continue;
    const key = `reaction.${row.id}`;
    if (now < (enemy.cooldowns[key] ?? 0) - EPS) return null;
    const handler = HANDLERS[row.effect];
    if (!handler) throw new Error(`reaction ${row.id}: no handler for effect "${row.effect}"`);
    enemy.cooldowns[key] = now + sim.data.reactionCooldown;
    const unquenchable = status === 'burning' && !!enemy.marks.hellfire && now < enemy.marks.hellfire.until - EPS;
    if (!unquenchable) delete enemy.statuses[status];
    const own = sim.data.elements.status[element];
    if (own) applyStatus(sim, enemy, own, now);
    const damage = handler(sim, enemy, hitDamage, sim.reactionParams(row), now, { consumed: status, stacks: have.stacks ?? 1, hit: element, other });
    sim.emit('reaction', { id: row.id, effect: row.effect, enemyId: enemy.id, pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z } });
    return { id: row.id, effect: row.effect, damage, enemyId: enemy.id };
  }
  return null;
}

/** Resolves several hits that landed on the same tick, lower enemy id first, so the outcome never depends on hit order. */
export function triggerReactions(sim: Sim, hits: { enemy: EnemyState; element: Element; damage: number }[], now: number): (ReactionResult | null)[] {
  return [...hits].sort((a, b) => a.enemy.id - b.enemy.id).map((h) => triggerReaction(sim, h.enemy, h.element, h.damage, now));
}
