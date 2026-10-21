// Enemy behaviour: one small state machine per archetype over a few movement primitives and the attacks in attacks.json.
// Nothing here is random, so the same fight plays out the same way every time.
import { dealDamage } from './damage.ts';
import { runAttack } from './attacks.ts';
import { statusModifiers } from './statuses.ts';
import type { EnemyState } from './state.ts';
import type { Sim } from './sim.ts';
import type { AiArchetype, AttackDef } from '../types.ts';

const EPS = 1e-9;
const HOVER_Y = 2.5;
const SEPARATION = 0.9;

type Behaviour = (sim: Sim, e: EnemyState, dt: number) => void;

const bodyRadius = (e: EnemyState) => Math.max(0.4, ...e.def.hurtboxes.map((h) => h.r));
const toPlayer = (sim: Sim, e: EnemyState) => ({ dx: sim.player.pos.x - e.pos.x, dz: sim.player.pos.z - e.pos.z, d: Math.hypot(sim.player.pos.x - e.pos.x, sim.player.pos.z - e.pos.z) });

/** Moves along a heading (radians, 0 faces +Z), trying to the sides when something is in the way. Each axis on its own so walls are slid along. */
function walk(sim: Sim, e: EnemyState, heading: number, speed: number, dt: number): void {
  const r = bodyRadius(e);
  for (const turn of [0, 0.8, -0.8, 1.6, -1.6]) {
    const h = heading + turn;
    const vx = Math.sin(h) * speed * dt;
    const vz = Math.cos(h) * speed * dt;
    let moved = false;
    if (!sim.world.blocked({ x: e.pos.x + vx, y: e.pos.y, z: e.pos.z }, r)) {
      e.pos.x += vx;
      moved = true;
    }
    if (!sim.world.blocked({ x: e.pos.x, y: e.pos.y, z: e.pos.z + vz }, r)) {
      e.pos.z += vz;
      moved = true;
    }
    if (moved) return;
  }
}

const headingTo = (dx: number, dz: number) => Math.atan2(dx, dz);

function face(sim: Sim, e: EnemyState): void {
  const { dx, dz } = toPlayer(sim, e);
  e.facing = headingTo(dx, dz);
}

/** The first of the enemy's attacks of a template that is off cooldown. */
function readyAttack(sim: Sim, e: EnemyState, ...templates: AttackDef['template'][]): { id: string; a: AttackDef } | null {
  for (const id of e.def.attacks) {
    const a = sim.data.attacks[id];
    if (a && templates.includes(a.template) && sim.time >= (e.cooldowns[id] ?? 0) - EPS) return { id, a };
  }
  return null;
}

const firstOf = (sim: Sim, e: EnemyState, ...templates: AttackDef['template'][]) => {
  for (const id of e.def.attacks) {
    const a = sim.data.attacks[id];
    if (a && templates.includes(a.template)) return { id, a };
  }
  return null;
};

const speedOf = (sim: Sim, e: EnemyState) => e.def.speed * statusModifiers(e, sim.time, sim.data.statuses).speedMul;

/** Walks at the player until within `stand`, attacking with a melee attack when it is in reach. */
function rush(sim: Sim, e: EnemyState, dt: number, separate: boolean): void {
  const { dx, dz, d } = toPlayer(sim, e);
  const melee = firstOf(sim, e, 'melee_swipe', 'slam');
  const reach = melee ? melee.a.range - 0.3 : 1.4;
  face(sim, e);
  if (d <= reach + 0.1 && melee) {
    const ready = readyAttack(sim, e, 'melee_swipe', 'slam');
    if (ready) runAttack(sim, e, ready.id, sim.player.pos);
    return;
  }
  if (d <= reach) return;
  let hx = dx / (d || 1);
  let hz = dz / (d || 1);
  if (separate) {
    for (const o of sim.enemies) {
      if (o === e) continue;
      const ox = e.pos.x - o.pos.x;
      const oz = e.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < SEPARATION) {
        // identical positions get a deterministic push so a stacked crowd can come apart
        const w = (SEPARATION - od) / SEPARATION;
        hx += (od > 1e-6 ? ox / od : Math.cos(e.id)) * w * 2.5;
        hz += (od > 1e-6 ? oz / od : Math.sin(e.id)) * w * 2.5;
      }
    }
  }
  walk(sim, e, headingTo(hx, hz), speedOf(sim, e), dt);
}

/** Keeps a distance band from the player: closes in beyond `far`, backs off inside `near`, drifts sideways between. */
function hold(sim: Sim, e: EnemyState, near: number, far: number, dt: number, strafe = 0.5): void {
  const { dx, dz, d } = toPlayer(sim, e);
  face(sim, e);
  const to = headingTo(dx, dz);
  if (d > far) walk(sim, e, to, speedOf(sim, e), dt);
  else if (d < near) walk(sim, e, to + Math.PI, speedOf(sim, e), dt);
  else walk(sim, e, to + (e.id % 2 ? 1 : -1) * Math.PI / 2, speedOf(sim, e) * strafe, dt);
}

const rusher: Behaviour = (sim, e, dt) => rush(sim, e, dt, false);
const swarm: Behaviour = (sim, e, dt) => rush(sim, e, dt, true);

const shooter: Behaviour = (sim, e, dt) => {
  hold(sim, e, 8, 12, dt);
  const { d } = toPlayer(sim, e);
  const shot = readyAttack(sim, e, 'projectile');
  if (shot && d >= 6 && d <= 14) runAttack(sim, e, shot.id, sim.player.pos);
};

const tank: Behaviour = (sim, e, dt) => {
  const g = e.guard;
  if (g && e.def.guard) {
    // guard goes up and down on its own timers (a weakness hit can knock it down early)
    if (g.on && sim.time >= g.until - EPS) {
      g.on = false;
      g.until = sim.time + e.def.guard.offFor;
    } else if (!g.on && sim.time >= g.until - EPS && sim.time >= g.staggeredUntil) {
      g.on = true;
      g.until = sim.time + e.def.guard.onFor;
    }
  }
  rush(sim, e, dt, false);
};

const flyer: Behaviour = (sim, e, dt) => {
  const p = sim.player;
  const dive = firstOf(sim, e, 'charge');
  const speed = speedOf(sim, e);
  face(sim, e);
  const climb = (rate: number) => {
    e.pos.y += Math.max(-rate * dt, Math.min(rate * dt, HOVER_Y - e.pos.y));
  };
  if (e.aiState === 'dive') {
    const { dx, dz, d } = toPlayer(sim, e);
    const targetY = p.pos.y + 0.9;
    const dy = targetY - e.pos.y;
    const reach = Math.hypot(d, dy);
    walk(sim, e, headingTo(dx, dz), speed * 2.5, dt);
    e.pos.y += Math.max(-speed * 2.5 * dt, Math.min(speed * 2.5 * dt, dy));
    if (reach < 1.2 && dive) {
      dealDamage(sim, p, dive.a.damage, 'none', { applies: dive.a.applies ?? null });
      e.aiState = 'recover';
      e.aiUntil = sim.time + 1.5;
    } else if (sim.time >= e.aiUntil) {
      e.aiState = 'recover';
      e.aiUntil = sim.time + 1.5;
    }
    return;
  }
  climb(speed * 1.5);
  if (e.aiState === 'recover') {
    if (sim.time >= e.aiUntil) e.aiState = 'hover';
    return;
  }
  if (e.aiState !== 'hover') e.aiUntil = sim.time + 1.5; // a moment of circling before the first dive
  e.aiState = 'hover';
  hold(sim, e, 5, 8, dt, 0.8);
  const { d } = toPlayer(sim, e);
  const ready = dive ? readyAttack(sim, e, 'charge') : null;
  if (ready && d < 10 && sim.time >= e.aiUntil && Math.abs(e.pos.y - HOVER_Y) < 0.3) {
    e.cooldowns[ready.id] = sim.time + ready.a.cooldown;
    e.aiState = 'dive';
    e.aiUntil = sim.time + 2;
    return;
  }
  const shot = readyAttack(sim, e, 'projectile');
  if (shot && d <= 14) runAttack(sim, e, shot.id, sim.player.pos);
};

const charger: Behaviour = (sim, e, dt) => {
  if (e.aiState === 'recover') {
    if (sim.time >= e.aiUntil) e.aiState = 'idle';
    return;
  }
  if (e.aiState === 'charging') {
    e.aiState = 'recover';
    e.aiUntil = sim.time + 1.5;
    return;
  }
  const { d } = toPlayer(sim, e);
  const c = readyAttack(sim, e, 'charge');
  if (c && d >= 3 && d <= c.a.range + 3) {
    e.aiState = 'charging';
    runAttack(sim, e, c.id, sim.player.pos);
    return;
  }
  hold(sim, e, 5, 8, dt, 0.4);
};

const summoner: Behaviour = (sim, e, dt) => {
  hold(sim, e, 9, 13, dt, 0.3);
  const s = readyAttack(sim, e, 'summon');
  const spec = s?.a.summon;
  if (!s || !spec) return;
  const alive = sim.enemies.filter((o) => o.def.id === spec.enemy && o !== e).length;
  if (alive + spec.count <= (spec.cap ?? 4)) runAttack(sim, e, s.id, sim.player.pos);
};

const ambusher: Behaviour = (sim, e, dt) => {
  const { dx, dz, d } = toPlayer(sim, e);
  switch (e.aiState) {
    case 'buried':
      walk(sim, e, headingTo(dx, dz), speedOf(sim, e) * 1.5, dt);
      if (d < 1.2) {
        const slam = firstOf(sim, e, 'slam', 'melee_swipe');
        e.aiState = 'surfacing';
        e.aiUntil = sim.time + 0.5;
        if (slam) runAttack(sim, e, slam.id, sim.player.pos);
      }
      return;
    case 'surfacing':
      if (!e.attack && sim.time >= e.aiUntil) e.aiState = 'surfaced';
      return;
    case 'surfaced':
      rush(sim, e, dt, false);
      return;
    default:
      e.aiState = 'buried';
  }
};

export const AI: Record<AiArchetype, Behaviour> = { rusher, shooter, tank, swarm, flyer, charger, summoner, ambusher, none: () => {} };

/** Runs every living enemy's behaviour, then announces the room as cleared once its last enemy is gone. */
export function stepAI(sim: Sim, dt: number): void {
  for (const e of [...sim.enemies]) {
    if (e.hp <= 0 || e.attack) continue;
    if (!statusModifiers(e, sim.time, sim.data.statuses).canAct) continue;
    AI[e.def.ai]?.(sim, e, dt);
  }
  if (!sim.roomCleared && sim.spawned > 0 && sim.enemies.length === 0) {
    sim.roomCleared = true;
    sim.emit('room_cleared');
  }
}
