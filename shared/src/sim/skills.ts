// Casting: a skill is data with a shape. The windup delays the effect; the shape decides who gets hit and how.
import { rayVsCapsule, v3, type Vec3 } from '../math.ts';
import { resolveAim } from '../aim.ts';
import type { Input, ShapeDef, SkillDef } from '../types.ts';
import type { Sim } from './sim.ts';
import { enemyHurtboxes, type Bonus, type EnemyState, type PlayerState } from './state.ts';
import { consumeSwapBonus } from './swap.ts';
import { dealDamage } from './damage.ts';

export interface CastResult {
  ok: boolean;
  reason?: 'cooldown' | 'casting' | 'unknown';
}

export interface EnemyHit {
  enemy: EnemyState;
  point: Vec3;
  t: number;
}

/** Chest height: where spells leave the caster. */
const CHEST = 1.4;

const chest = (p: PlayerState): Vec3 => ({ x: p.pos.x, y: p.pos.y + CHEST, z: p.pos.z });

/** Takes health off an enemy and emits the hit; removes it when it dies. Element, status and reaction rules live in dealDamage. */
export function damageEnemy(sim: Sim, e: EnemyState, amount: number, skillId: string, point: Vec3): void {
  if (e.hp <= 0) return;
  e.hp = Math.max(0, e.hp - amount);
  sim.emit('hit', { target: 'enemy', id: e.id, amount, skillId, x: point.x, y: point.y, z: point.z });
  if (e.hp <= 0) {
    sim.emit('enemy_died', { id: e.id, defId: e.def.id, x: e.pos.x, y: e.pos.y, z: e.pos.z });
    sim.enemies = sim.enemies.filter((x) => x !== e);
  }
}

/** A skill's hit on an enemy: the status it leaves is certain with the swap-in bonus, otherwise by the skill's chance. */
export function skillHit(sim: Sim, e: EnemyState, skill: SkillDef, amount: number, point: Vec3, bonus?: Bonus): void {
  const chance = skill.statusChance ?? 1;
  const lands = !!skill.applies && (bonus?.guarantee || chance >= 1 || (chance > 0 && sim.streams.combat.next() < chance));
  dealDamage(sim, e, amount, skill.element, { swapBonus: bonus?.mul, applies: lands ? skill.applies : null, skillId: skill.id, point });
}

/** A shield that has soaked all it can bursts: a splash around the caster that hurts and applies the skill's status. */
export function popShield(sim: Sim, skillId: string): void {
  const p = sim.player;
  p.buff = null;
  sim.emit('shield_pop', { skillId, x: p.pos.x, y: p.pos.y, z: p.pos.z });
  const skill = sim.data.skills[skillId];
  if (!skill) return;
  for (const h of hitEnemies(sim, { type: 'zone', radius: skill.shape.radius ?? 3 }, p.pos, { x: 0, y: 0, z: 1 })) {
    dealDamage(sim, h.enemy, skill.damage, skill.element, { applies: skill.applies, skillId, point: h.point });
  }
}

/** Starts a cast. The effect lands when the windup ends (see stepCast). */
export function castSkill(sim: Sim, caster: PlayerState, skillId: string, aimPoint: Vec3): CastResult {
  const skill = sim.data.skills[skillId];
  if (!skill) return { ok: false, reason: 'unknown' };
  const now = sim.time;
  if (caster.castState && now < caster.castState.until) return { ok: false, reason: 'casting' };
  if (!sim.noCooldowns && now < (caster.cooldowns[skillId] ?? 0)) return { ok: false, reason: 'cooldown' };
  const channel = skill.shape.type === 'stream' ? (skill.shape.duration ?? 0) : 0;
  if (!sim.noCooldowns) caster.cooldowns[skillId] = now + skill.cooldown;
  const swap = consumeSwapBonus(caster, now, sim.data.player.swap);
  const bonus: Bonus = { mul: swap.damageMul, guarantee: swap.guaranteeStatus };
  caster.castState = {
    skillId,
    until: now + skill.cast.windup + channel,
    move: skill.cast.move,
    fireAt: now + skill.cast.windup,
    fired: false,
    aim: { ...aimPoint },
    nextTick: now + skill.cast.windup,
    bonus,
  };
  sim.emit('cast', { skillId, archetype: skill.cast.archetype, clip: skill.cast.clip });
  return { ok: true };
}

/** Runs the player's current cast for this tick. */
export function stepCast(sim: Sim, p: PlayerState, input: Input): void {
  const cs = p.castState;
  const now = sim.time;
  if (!cs) return;
  if (now >= cs.until && cs.fired) {
    p.castState = null;
    return;
  }
  const skill = sim.data.skills[cs.skillId];
  if (!skill) {
    p.castState = null;
    return;
  }
  const origin = chest(p);
  if (skill.shape.type === 'stream') {
    cs.aim = resolveAim(sim.world, sim.enemies.flatMap((e) => enemyHurtboxes(e)), input.camOrigin, input.aimYaw, input.aimPitch, sim.data.player.maxAimRange).point;
  }
  if (!cs.fired && now >= (cs.fireAt ?? 0)) {
    cs.fired = true;
    fire(sim, p, skill, origin, cs.aim ?? { x: origin.x, y: origin.y, z: origin.z + 1 }, cs.bonus);
  }
  if (cs.fired && skill.shape.type === 'stream') {
    const tick = skill.shape.tick ?? 0.25;
    while (cs.nextTick !== undefined && now >= cs.nextTick && cs.nextTick < cs.until - 1e-9) {
      cs.nextTick += tick;
      const dir = v3.norm(v3.sub(cs.aim ?? origin, origin));
      for (const h of hitEnemies(sim, skill.shape, origin, dir)) skillHit(sim, h.enemy, skill, skill.damage, h.point, cs.bonus);
    }
  }
  if (now >= cs.until && cs.fired) p.castState = null;
}

function fire(sim: Sim, p: PlayerState, skill: SkillDef, origin: Vec3, aim: Vec3, bonus?: Bonus): void {
  const s = skill.shape;
  const now = sim.time;
  const dir = v3.norm(v3.sub(aim, origin));
  switch (s.type) {
    case 'projectile': {
      const aimDir = s.gravity ? lobDirection(origin, aim, s.speed ?? 20, s.gravity) ?? dir : dir;
      const count = Math.max(1, s.count ?? 1);
      const spread = ((s.angle ?? 0) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const off = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
        const c = Math.cos(off);
        const sn = Math.sin(off);
        const d = { x: aimDir.x * c + aimDir.z * sn, y: aimDir.y, z: -aimDir.x * sn + aimDir.z * c };
        sim.projectiles.push({ id: sim.allocId(), pos: { ...origin }, vel: v3.scale(d, s.speed ?? 20), r: s.radius ?? 0.25, gravity: s.gravity ?? 0, skillId: skill.id, ownerId: 0, diesAt: now + (s.lifetime ?? 1), bonus });
      }
      break;
    }
    case 'cone':
      for (const h of hitEnemies(sim, s, origin, dir)) skillHit(sim, h.enemy, skill, skill.damage, h.point, bonus);
      break;
    case 'stream':
      break; // ticks run in stepCast
    case 'zone': {
      const tick = s.tick ?? 0;
      sim.zones.push({ id: sim.allocId(), kind: skill.id, pos: { x: aim.x, y: sim.world.groundAt(aim.x, aim.z), z: aim.z }, radius: s.radius ?? 2, until: now + (s.duration ?? 1), ownerId: 0, skillId: skill.id, yaw: 0, width: 0, height: 0, damage: skill.damage, tick, nextTick: now, bonus });
      break;
    }
    case 'wall': {
      const yaw = Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z);
      sim.zones.push({ id: sim.allocId(), kind: 'wall', pos: { x: aim.x, y: sim.world.groundAt(aim.x, aim.z), z: aim.z }, radius: (s.width ?? 3) / 2, until: now + (s.duration ?? 5), ownerId: 0, skillId: skill.id, yaw, width: s.width ?? 3, height: s.height ?? 3, damage: 0, tick: 0, nextTick: 0 });
      break;
    }
    case 'self':
      p.buff = { skillId: skill.id, until: now + (s.duration ?? 3), absorb: s.absorb ?? 0, damageTakenMul: s.damageTakenMul ?? 1, speedMul: s.speedMul ?? 1 };
      break;
    case 'dash': {
      const flat = v3.norm({ x: dir.x, y: 0, z: dir.z });
      const want = v3.add({ x: p.pos.x, y: CHEST - 0.5, z: p.pos.z }, v3.scale(flat, s.distance ?? 5));
      const start = { x: p.pos.x, y: CHEST - 0.5, z: p.pos.z };
      const hit = sim.world.sweepSphere(start, want, sim.data.player.radius);
      const travel = hit === null ? (s.distance ?? 5) : Math.max(0, hit);
      if (s.trailRadius) {
        // ground effect along the path walked, one patch for every trail-width of distance
        const step = Math.max(0.5, s.trailRadius);
        for (let d = 0; d <= travel + 1e-9; d += step) {
          const gx = p.pos.x + flat.x * d;
          const gz = p.pos.z + flat.z * d;
          sim.zones.push({ id: sim.allocId(), kind: skill.id, pos: { x: gx, y: sim.world.groundAt(gx, gz), z: gz }, radius: s.trailRadius, until: now + (s.trailSeconds ?? 3), ownerId: 0, skillId: skill.id, yaw: 0, width: 0, height: 0, damage: skill.damage, tick: 0.5, nextTick: now, bonus, effects: skill.applies === 'burning' ? { burn: true } : undefined });
        }
      }
      p.pos.x += flat.x * travel;
      p.pos.z += flat.z * travel;
      p.facing = Math.atan2(flat.x, flat.z);
      if (s.duration) p.invulnUntil = Math.max(p.invulnUntil, now + s.duration);
      break;
    }
  }
}

/** The direction that sends a projectile with gravity through the aim point (the flatter of the two arcs), or null when out of range. */
function lobDirection(from: Vec3, to: Vec3, speed: number, g: number): Vec3 | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  if (d < 1e-6) return null;
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return null;
  const tan = (v2 - Math.sqrt(disc)) / (g * d);
  const c = 1 / Math.sqrt(1 + tan * tan);
  return { x: (dx / d) * c, y: tan * c, z: (dz / d) * c };
}

/** The enemies a cone, stream line or zone circle reaches from origin along dir, in enemy id order (so reactions resolve in a stable order). */
export function hitEnemies(sim: Sim, shape: ShapeDef, origin: Vec3, dir: Vec3): EnemyHit[] {
  const out: EnemyHit[] = [];
  for (const e of sim.enemies) {
    let best: EnemyHit | null = null;
    for (const h of enemyHurtboxes(e)) {
      const centre = v3.lerp(h.a, h.b, 0.5);
      const to = v3.sub(centre, origin);
      const dist = v3.len(to);
      let hit = false;
      let t = dist;
      if (shape.type === 'cone') {
        if (dist > (shape.range ?? 5) + h.r) continue;
        const cos = dist < 1e-9 ? 1 : v3.dot(v3.scale(to, 1 / dist), dir);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
        const slack = dist > h.r ? Math.asin(Math.min(1, h.r / dist)) : Math.PI;
        hit = angle <= (((shape.angle ?? 45) * Math.PI) / 180) / 2 + slack * 0.5;
      } else if (shape.type === 'stream') {
        const range = shape.range ?? 8;
        const tt = rayVsCapsule(origin, dir, h.a, h.b, h.r + (shape.width ?? 0.5) / 2);
        if (tt !== null && tt <= range) {
          hit = true;
          t = tt;
        }
      } else if (shape.type === 'zone') {
        const dx = Math.hypot(centre.x - origin.x, centre.z - origin.z);
        hit = dx <= (shape.radius ?? 2) + h.r;
      }
      if (hit && (!best || t < best.t)) best = { enemy: e, point: centre, t };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.enemy.id - b.enemy.id);
}
