// Projectiles in flight and the timed zones (ground effects, walls) that stay in the room.
import { rayVsBox, rayVsCapsule, v3, type Vec3 } from '../math.ts';
import { damageEnemy, hitEnemies, skillHit } from './skills.ts';
import { enemyHurtboxes, type Bonus, type EnemyState, type Projectile, type Zone } from './state.ts';
import type { SkillDef } from '../types.ts';
import { applyStatus } from './statuses.ts';
import { outgoing, projectileVsPlayer } from './attacks.ts';
import { dealDamage } from './damage.ts';
import type { Sim } from './sim.ts';

/** What share of a skill's damage its explosion deals. */
const EXPLOSION_DAMAGE = 0.6;

/** A ray from a to b against a wall zone's box (turned by its yaw); the distance of the hit or null. */
function rayVsWall(z: Zone, o: Vec3, d: Vec3): number | null {
  const c = Math.cos(z.yaw);
  const s = Math.sin(z.yaw);
  const local = (p: Vec3): Vec3 => {
    const x = p.x - z.pos.x;
    const dz = p.z - z.pos.z;
    return { x: x * c - dz * s, y: p.y - z.pos.y, z: x * s + dz * c };
  };
  const lo = local(o);
  const ld = { x: d.x * c - d.z * s, y: d.y, z: d.x * s + d.z * c };
  return rayVsBox(lo, ld, { x: -z.width / 2, y: 0, z: -0.25 }, { x: z.width / 2, y: z.height, z: 0.25 });
}

const outgoingOf = (sim: Sim, ownerId: number): number => {
  const e = sim.enemies.find((o) => o.id === ownerId);
  return e ? outgoing(sim, e) : 1;
};

export function stepProjectiles(sim: Sim, dt: number): void {
  const now = sim.time;
  const boxes = sim.enemies.flatMap((e) => enemyHurtboxes(e));
  const alive: typeof sim.projectiles = [];
  for (const q of sim.projectiles) {
    if (now >= q.diesAt) continue;
    const from = { ...q.pos };
    if (q.ownerId > 0) reflectShot(sim, q);
    // a shot in a time rift crawls
    const rate = q.ownerId > 0 ? slowRate(sim, q.pos) : 1;
    q.vel.y -= q.gravity * dt;
    const to = v3.add(from, v3.scale(q.vel, dt * rate));
    const length = v3.len(v3.sub(to, from));
    const dir = length > 1e-9 ? v3.scale(v3.sub(to, from), 1 / length) : { x: 0, y: 0, z: 1 };
    let best = sim.world.sweepSphere(from, to, q.r);
    let enemyId: number | null = null;
    let hitsPlayer = false;
    if (q.ownerId > 0) {
      // an enemy's shot goes for the player and passes the other enemies
      const t = projectileVsPlayer(sim, from, dir, length, q.r);
      if (t !== null && (best === null || t < best)) {
        best = t;
        hitsPlayer = true;
      }
    }
    for (const h of q.ownerId > 0 ? [] : boxes) {
      if (q.hit?.includes(h.enemyId)) continue; // already passed through this one
      const t = rayVsCapsule(from, dir, h.a, h.b, h.r + q.r);
      if (t !== null && t <= length && (best === null || t < best)) {
        best = t;
        enemyId = h.enemyId;
      }
    }
    for (const z of sim.zones) {
      if (z.kind !== 'wall') continue;
      const t = rayVsWall(z, from, dir);
      if (t !== null && t <= length && (best === null || t < best)) {
        best = t;
        enemyId = null;
        hitsPlayer = false;
      }
    }
    if (best === null) {
      q.pos = to;
      alive.push(q);
      continue;
    }
    const point = v3.add(from, v3.scale(dir, best));
    const target = enemyId === null ? null : sim.enemies.find((e) => e.id === enemyId);
    const skill = sim.skill(q.skillId);
    const attack = sim.data.attacks[q.skillId];
    if (hitsPlayer && attack) dealDamage(sim, sim.player, attack.damage * outgoingOf(sim, q.ownerId), 'none', { applies: attack.applies ?? null });
    else if (target && q.reflectDamage) dealDamage(sim, target, q.reflectDamage, 'none', { skillId: `reflect.${q.skillId}`, point });
    else if (target && skill) skillHit(sim, target, skill, skill.damage, point, q.bonus);
    else sim.emit('hit', { target: 'world', skillId: q.skillId, x: point.x, y: point.y, z: point.z });
    if (target && skill && (q.pierce ?? 0) > 0) {
      // a piercing shot carries on past the enemy it hit
      q.pierce = (q.pierce ?? 0) - 1;
      q.hit = [...(q.hit ?? []), target.id];
      q.pos = to;
      alive.push(q);
      continue;
    }
    if (q.explode && skill) explode(sim, skill, point, q.explode, [...(q.hit ?? []), ...(target ? [target.id] : [])], q.bonus);
  }
  sim.projectiles = alive;
}

/** A burst where a shot landed: enemies near it that the shot did not hit itself take part of its damage. */
function explode(sim: Sim, skill: SkillDef, point: Vec3, radius: number, spare: number[], bonus?: Bonus): void {
  for (const h of hitEnemies(sim, { type: 'zone', radius }, point, { x: 0, y: 0, z: 1 })) {
    if (!spare.includes(h.enemy.id)) skillHit(sim, h.enemy, skill, skill.damage * EXPLOSION_DAMAGE, h.point, bonus);
  }
}

export function stepZones(sim: Sim): void {
  const now = sim.time;
  for (const z of sim.zones) {
    if (z.drift && now < z.until) driftToward(sim, z);
    stepZoneEffects(sim, z, 1 / 60);
    if (z.tick > 0 && (z.damage > 0 || z.effects) && now >= z.nextTick && now < z.until) {
      z.nextTick += z.tick;
      if (z.ownerId > 0) {
        // an enemy's ground fire hurts the player standing in it
        const p = sim.player;
        if (Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z) <= z.radius) dealDamage(sim, p, z.damage, 'none', { applies: z.effects?.burn ? 'burning' : null });
        continue;
      }
      for (const h of hitEnemies(sim, { type: 'zone', radius: z.radius }, z.pos, { x: 0, y: 0, z: 1 })) {
        const skill = sim.skill(z.skillId);
        if (z.damage > 0 && skill) skillHit(sim, h.enemy, skill, z.damage, h.point, z.bonus);
        else if (z.damage > 0) damageEnemy(sim, h.enemy, z.damage, z.skillId, h.point);
        zoneEffects(sim, z, h.enemy);
      }
      healInZone(sim, z);
    }
  }
  sim.zones = sim.zones.filter((z) => now < z.until);
}

/** A drifting zone moves toward the nearest living enemy other than the one it began on, and stops on top of it. */
function driftToward(sim: Sim, z: Zone): void {
  let best: EnemyState | null = null;
  let bestD = Infinity;
  for (const e of sim.enemies) {
    if (e.hp <= 0 || e.id === z.driftFrom) continue;
    const d = Math.hypot(e.pos.x - z.pos.x, e.pos.z - z.pos.z);
    if (d > 0.6 && d < bestD) (best = e), (bestD = d);
  }
  if (!best) return;
  const step = Math.min(bestD, (z.drift ?? 0) / 60);
  z.pos.x += ((best.pos.x - z.pos.x) / bestD) * step;
  z.pos.z += ((best.pos.z - z.pos.z) / bestD) * step;
}

function zoneEffects(sim: Sim, z: Zone, e: EnemyState): void {
  const fx = z.effects;
  if (!fx || e.hp <= 0) return;
  if (fx.blindSeconds) e.marks.blind = { until: sim.time + fx.blindSeconds };
  if (fx.soak) applyStatus(sim, e, 'soaked', sim.time);
  if (fx.burn) applyStatus(sim, e, 'burning', sim.time);
  if (fx.status) applyStatus(sim, e, fx.status, sim.time);
}

/** A turned-back shot flies at whoever fired it and hurts enemies instead of the player. */
function reflectShot(sim: Sim, q: Projectile): void {
  const zone = sim.zones.find((z) => z.effects?.reflect && sim.time < z.until && Math.hypot(q.pos.x - z.pos.x, q.pos.z - z.pos.z) <= z.radius);
  if (!zone) return;
  const shooter = sim.enemies.find((o) => o.id === q.ownerId);
  const speed = Math.max(1, v3.len(q.vel));
  const aim = shooter ? v3.norm({ x: shooter.pos.x - q.pos.x, y: shooter.pos.y + 1 - q.pos.y, z: shooter.pos.z - q.pos.z }) : v3.norm(v3.scale(q.vel, -1));
  q.vel = v3.scale(aim, speed);
  q.reflectDamage = (sim.data.attacks[q.skillId]?.damage ?? 5) * (shooter?.damageMul ?? 1);
  q.ownerId = 0;
  q.diesAt = Math.max(q.diesAt, sim.time + 1);
  sim.emit('hit', { target: 'world', skillId: 'reflect', x: q.pos.x, y: q.pos.y, z: q.pos.z });
}

/** How fast a shot at this point moves: slowed inside a time rift. */
function slowRate(sim: Sim, at: Vec3): number {
  let rate = 1;
  for (const z of sim.zones) if (z.effects?.slowMul && sim.time < z.until && Math.hypot(at.x - z.pos.x, at.z - z.pos.z) <= z.radius) rate = Math.min(rate, z.effects.slowMul);
  return rate;
}

/** The effects a zone has every tick rather than every damage tick: growing, pulling, holding, slowing and the storm's bolts. */
function stepZoneEffects(sim: Sim, z: Zone, dt: number): void {
  const fx = z.effects;
  if (!fx || z.ownerId > 0 || sim.time >= z.until) return;
  if (fx.growPerSecond) z.radius = Math.min(MAX_ZONE_RADIUS, z.radius + fx.growPerSecond * dt);
  if (fx.pull || fx.hold || fx.slowMul) {
    for (const h of hitEnemies(sim, { type: 'zone', radius: z.radius }, z.pos, { x: 0, y: 0, z: 1 })) {
      if (fx.pull) pullToward(sim, h.enemy, z.pos, fx.pull * dt);
      if (fx.hold) h.enemy.marks.rooted = { until: sim.time + 0.3, speedMul: 0 };
      if (fx.slowMul) h.enemy.marks.slowed = { until: sim.time + 0.3, speedMul: fx.slowMul };
    }
  }
  if (fx.strikeEvery && fx.strikeNext !== undefined && sim.time >= fx.strikeNext) {
    fx.strikeNext += fx.strikeEvery;
    const inside = hitEnemies(sim, { type: 'zone', radius: z.radius }, z.pos, { x: 0, y: 0, z: 1 }).map((h) => h.enemy);
    if (inside.length > 0) {
      const target = inside[Math.floor(sim.streams.combat.next() * inside.length) % inside.length];
      sim.emit('hit', { target: 'world', skillId: 'reaction.thunderstorm', x: target.pos.x, y: target.pos.y, z: target.pos.z });
      dealDamage(sim, target, fx.strikeDamage ?? 8, 'lightning', { applies: 'shocked', skillId: 'reaction.thunderstorm', point: target.pos });
    }
  }
}

/** Slides an enemy toward a point by `step` metres, unless a wall is in the way. */
function pullToward(sim: Sim, e: EnemyState, to: Vec3, step: number): void {
  const d = Math.hypot(to.x - e.pos.x, to.z - e.pos.z);
  if (d < 0.5) return;
  const s = Math.min(step, d - 0.4);
  const x = e.pos.x + ((to.x - e.pos.x) / d) * s;
  const zz = e.pos.z + ((to.z - e.pos.z) / d) * s;
  if (!sim.world.blocked({ x, y: e.pos.y, z: zz }, Math.max(0.4, ...e.def.hurtboxes.map((h) => h.r)))) {
    e.pos.x = x;
    e.pos.z = zz;
  }
}

const MAX_ZONE_RADIUS = 8;

function healInZone(sim: Sim, z: Zone): void {
  const pct = z.effects?.healPercentPerSecond;
  if (!pct) return;
  const p = sim.player;
  if (Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z) > z.radius) return;
  p.hp = Math.min(sim.data.player.health, p.hp + (sim.data.player.health * pct * z.tick) / 100);
}
