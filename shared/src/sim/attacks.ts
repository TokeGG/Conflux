// Enemy attacks: five templates driven by attacks.json. Every attack shows a ground telegraph that ends exactly when it lands.
import { rayVsCapsule, v3, type Vec3 } from '../math.ts';
import { dealDamage } from './damage.ts';
import { statusModifiers } from './statuses.ts';
import { spawnEnemy, type EnemyState } from './state.ts';
import type { Sim } from './sim.ts';
import type { AttackDef } from '../types.ts';

const EPS = 1e-9;
/** Chest height of an enemy's shots, and the player's body for the hit tests. */
const MUZZLE_Y = 1.0;
const PLAYER_CHEST = 1.0;

const bodyRadius = (e: EnemyState) => Math.max(0.4, ...e.def.hurtboxes.map((h) => h.r));
/** What an enemy's attack damage is multiplied by: its depth scaling and any curse on it. */
export const outgoing = (sim: Sim, e: EnemyState): number => e.damageMul * statusModifiers(e, sim.time, sim.data.statuses).damageDealtMul;
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Starts an attack aimed at a point. False when the enemy is busy, the attack is cooling down, or it does not exist. */
export function runAttack(sim: Sim, e: EnemyState, attackId: string, target: Vec3): boolean {
  const a = sim.data.attacks[attackId];
  if (!a || e.attack) return false;
  const now = sim.time;
  if (now < (e.cooldowns[attackId] ?? 0) - EPS) return false;
  e.cooldowns[attackId] = now + a.cooldown;
  const yaw = Math.atan2(target.x - e.pos.x, target.z - e.pos.z);
  e.facing = yaw;
  e.attack = { attackId, hitAt: now + a.windup, yaw, phase: 'windup', remaining: a.range, hit: false };
  sim.emit('telegraph', telegraph(e, a, attackId, yaw, now + a.windup));
  return true;
}

function telegraph(e: EnemyState, a: AttackDef, attackId: string, yaw: number, until: number): Record<string, unknown> {
  const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const base = { enemyId: e.id, attackId, yaw, until };
  switch (a.template) {
    case 'melee_swipe':
      return { ...base, shape: 'cone', pos: { ...e.pos }, range: a.range, angle: a.angle ?? 90 };
    case 'slam':
      return { ...base, shape: 'circle', pos: { x: e.pos.x + fwd.x * a.range, y: e.pos.y, z: e.pos.z + fwd.z * a.range }, radius: a.radius ?? 2 };
    case 'summon':
      return { ...base, shape: 'circle', pos: { ...e.pos }, radius: a.range };
    default:
      return { ...base, shape: 'line', pos: { ...e.pos }, range: a.range, width: (a.radius ?? 0.4) * 2 };
  }
}

function hurtPlayer(sim: Sim, a: AttackDef, damageMul = 1): void {
  dealDamage(sim, sim.player, a.damage * damageMul, 'none', { applies: a.applies ?? null });
}

/** Lands the attacks whose telegraphs have ended and moves charging enemies. */
export function stepAttacks(sim: Sim): void {
  const now = sim.time;
  for (const e of [...sim.enemies]) {
    const act = e.attack;
    if (!act) continue;
    const a = sim.data.attacks[act.attackId];
    if (!a) {
      e.attack = null;
      continue;
    }
    if (act.phase === 'windup') {
      if (now < act.hitAt - EPS) continue;
      land(sim, e, a);
    } else {
      charge(sim, e, a);
    }
  }
}

function land(sim: Sim, e: EnemyState, a: AttackDef): void {
  const act = e.attack!;
  const p = sim.player;
  const fwd = { x: Math.sin(act.yaw), z: Math.cos(act.yaw) };
  switch (a.template) {
    case 'melee_swipe': {
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const r = sim.data.player.radius;
      const angle = d < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / d)));
      const slack = d > r ? Math.asin(Math.min(1, r / d)) : Math.PI;
      if (d <= a.range + r && angle <= (((a.angle ?? 90) * Math.PI) / 180) / 2 + slack) hurtPlayer(sim, a, outgoing(sim, e));
      e.attack = null;
      break;
    }
    case 'slam': {
      const centre = { x: e.pos.x + fwd.x * a.range, y: 0, z: e.pos.z + fwd.z * a.range };
      if (flat(p.pos, centre) <= (a.radius ?? 2)) hurtPlayer(sim, a, outgoing(sim, e));
      e.attack = null;
      break;
    }
    case 'projectile': {
      const origin = { x: e.pos.x + fwd.x * bodyRadius(e), y: e.pos.y + MUZZLE_Y, z: e.pos.z + fwd.z * bodyRadius(e) };
      const aim = v3.norm({ x: p.pos.x - origin.x, y: p.pos.y + PLAYER_CHEST - origin.y, z: p.pos.z - origin.z });
      const speed = a.speed ?? 12;
      sim.projectiles.push({ id: sim.allocId(), pos: origin, vel: v3.scale(aim, speed), r: a.radius ?? 0.3, gravity: 0, skillId: act.attackId, ownerId: e.id, diesAt: sim.time + a.range / speed + 0.1 });
      e.attack = null;
      break;
    }
    case 'charge':
      act.phase = 'active';
      charge(sim, e, a);
      break;
    case 'summon': {
      const spec = a.summon;
      if (spec) {
        for (let k = 0; k < spec.count; k++) {
          const ang = (k / spec.count) * Math.PI * 2;
          const x = e.pos.x + Math.cos(ang) * a.range;
          const z = e.pos.z + Math.sin(ang) * a.range;
          spawnEnemy(sim, spec.enemy, { x, y: sim.world.groundAt(x, z), z }, e.level).summoned = true;
        }
      }
      e.attack = null;
      break;
    }
  }
}

function charge(sim: Sim, e: EnemyState, a: AttackDef): void {
  const act = e.attack!;
  const step = Math.min(act.remaining, (a.speed ?? 14) / 60);
  const dir = { x: Math.sin(act.yaw), y: 0, z: Math.cos(act.yaw) };
  const from = { x: e.pos.x, y: e.pos.y + 0.9, z: e.pos.z };
  const to = v3.add(from, v3.scale(dir, step));
  const stop = sim.world.sweepSphere(from, to, bodyRadius(e));
  const moved = stop === null ? step : Math.max(0, stop);
  e.pos.x += dir.x * moved;
  e.pos.z += dir.z * moved;
  act.remaining -= moved;
  if (!act.hit && flat(e.pos, sim.player.pos) <= (a.radius ?? 0.8) + sim.data.player.radius) {
    act.hit = true;
    hurtPlayer(sim, a, outgoing(sim, e));
  }
  if (stop !== null || act.remaining <= EPS) e.attack = null;
}

/** An enemy projectile's hit on the player, tested along its last step. Returns the distance of the hit or null. */
export function projectileVsPlayer(sim: Sim, from: Vec3, dir: Vec3, length: number, r: number): number | null {
  const p = sim.player;
  const t = rayVsCapsule(from, dir, { x: p.pos.x, y: p.pos.y + 0.4, z: p.pos.z }, { x: p.pos.x, y: p.pos.y + 1.4, z: p.pos.z }, sim.data.player.radius + r);
  return t !== null && t <= length ? t : null;
}
