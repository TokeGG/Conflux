// Projectiles in flight and the timed zones (ground effects, walls) that stay in the room.
import { rayVsBox, rayVsCapsule, v3, type Vec3 } from '../math.ts';
import { damageEnemy, hitEnemies, skillHit } from './skills.ts';
import { enemyHurtboxes, type EnemyState, type Zone } from './state.ts';
import { applyStatus } from './statuses.ts';
import { projectileVsPlayer } from './attacks.ts';
import { dealDamage } from './damage.ts';
import type { Sim } from './sim.ts';

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

export function stepProjectiles(sim: Sim, dt: number): void {
  const now = sim.time;
  const boxes = sim.enemies.flatMap((e) => enemyHurtboxes(e));
  const alive: typeof sim.projectiles = [];
  for (const q of sim.projectiles) {
    if (now >= q.diesAt) continue;
    const from = { ...q.pos };
    q.vel.y -= q.gravity * dt;
    const to = v3.add(from, v3.scale(q.vel, dt));
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
    const skill = sim.data.skills[q.skillId];
    const attack = sim.data.attacks[q.skillId];
    if (hitsPlayer && attack) dealDamage(sim, sim.player, attack.damage, 'none', { applies: attack.applies ?? null });
    else if (target && skill) skillHit(sim, target, skill, skill.damage, point, q.bonus);
    else sim.emit('hit', { target: 'world', skillId: q.skillId, x: point.x, y: point.y, z: point.z });
  }
  sim.projectiles = alive;
}

export function stepZones(sim: Sim): void {
  const now = sim.time;
  for (const z of sim.zones) {
    if (z.tick > 0 && (z.damage > 0 || z.effects) && now >= z.nextTick && now < z.until) {
      z.nextTick += z.tick;
      for (const h of hitEnemies(sim, { type: 'zone', radius: z.radius }, z.pos, { x: 0, y: 0, z: 1 })) {
        const skill = sim.data.skills[z.skillId];
        if (z.damage > 0 && skill) skillHit(sim, h.enemy, skill, z.damage, h.point, z.bonus);
        else if (z.damage > 0) damageEnemy(sim, h.enemy, z.damage, z.skillId, h.point);
        zoneEffects(sim, z, h.enemy);
      }
      healInZone(sim, z);
    }
  }
  sim.zones = sim.zones.filter((z) => now < z.until);
}

function zoneEffects(sim: Sim, z: Zone, e: EnemyState): void {
  const fx = z.effects;
  if (!fx || e.hp <= 0) return;
  if (fx.blindSeconds) e.marks.blind = { until: sim.time + fx.blindSeconds };
  if (fx.soak) applyStatus(sim, e, 'soaked', sim.time);
  if (fx.burn) applyStatus(sim, e, 'burning', sim.time);
}

function healInZone(sim: Sim, z: Zone): void {
  const pct = z.effects?.healPercentPerSecond;
  if (!pct) return;
  const p = sim.player;
  if (Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z) > z.radius) return;
  p.hp = Math.min(sim.data.player.health, p.hp + (sim.data.player.health * pct * z.tick) / 100);
}
