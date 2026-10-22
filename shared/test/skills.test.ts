import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSkill, hitEnemies } from '../src/sim/skills.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import { World, type Collider } from '../src/world.ts';
import { aimDir, type Vec3 } from '../src/math.ts';
import type { GameData, ShapeDef, SkillDef } from '../src/types.ts';
import { idle, makeSim, run } from './helpers.ts';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const AHEAD = V(0, 1.4, 30);

function skill(id: string, shape: ShapeDef, extra: Partial<SkillDef> = {}): SkillDef {
  return { id, element: 'fire', slot: 'secondary', shape, damage: 10, cooldown: 1, applies: null, cast: { archetype: 'throw', windup: 0, clip: 'x', move: 0.7 }, fx: {}, tags: [], ...extra };
}
function dataWith(...skills: SkillDef[]): GameData {
  const d = defaultData();
  for (const s of skills) d.skills[s.id] = s;
  return d;
}
const wallBox = (z: number): Collider => ({ kind: 'box', min: V(-5, 0, z), max: V(5, 4, z + 0.5) });

test('a fireball fired at a dummy 10 m ahead hits it about 0.42 s after it leaves', () => {
  const sim = makeSim();
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 10));
  assert.deepEqual(castSkill(sim, sim.player, 'fire.fireball', AHEAD), { ok: true });
  let fired = -1;
  let hit = -1;
  for (let i = 0; i < 90 && hit < 0; i++) {
    sim.step([idle()]);
    if (fired < 0 && sim.projectiles.length) fired = sim.time;
    if (dummy.hp < 1000) hit = sim.time;
  }
  assert.ok(fired >= 0.17 && fired <= 0.22, `leaves after the windup (${fired})`);
  assert.ok(hit > 0 && hit - fired > 0.35 && hit - fired < 0.5, `flight ${hit - fired}`);
  assert.equal(dummy.hp, 1000 - 14);
  assert.equal(sim.projectiles.length, 0, 'the fireball is gone after the hit');
});

test('a fireball that hits nothing dies at the end of its lifetime', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  run(sim, 12);
  assert.equal(sim.projectiles.length, 1);
  run(sim, 90);
  assert.equal(sim.projectiles.length, 0);
});

test('a boulder with gravity arcs up, comes down and lands before 20 m', () => {
  const data = dataWith(skill('earth.boulder', { type: 'projectile', speed: 16, radius: 0.4, gravity: 9, lifetime: 6 }, { element: 'earth' }));
  const sim = makeSim(1, { data });
  castSkill(sim, sim.player, 'earth.boulder', V(0, 10, 30));
  let maxY = 0;
  let last = V(0, 0, 0);
  for (let i = 0; i < 400; i++) {
    sim.step([idle()]);
    const q = sim.projectiles[0];
    if (q) {
      maxY = Math.max(maxY, q.pos.y);
      last = { ...q.pos };
    } else if (i > 20) break;
  }
  assert.equal(sim.projectiles.length, 0, 'it landed');
  assert.ok(maxY > 2.2, `it rose (peak ${maxY})`);
  assert.ok(last.y < 1, `it came back down (${last.y})`);
  assert.ok(last.z > 5 && last.z < 20, `it landed at ${last.z} m`);
});

test('a projectile with gravity is lobbed so that it passes through the aim point', () => {
  const data = dataWith(skill('earth.boulder', { type: 'projectile', speed: 16, radius: 0.4, gravity: 9, lifetime: 4 }, { element: 'earth' }));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 12));
  castSkill(sim, sim.player, 'earth.boulder', V(0, 0.9, 12));
  run(sim, 120);
  assert.equal(dummy.hp, 1000 - 10, 'dead centre on the crosshair');
});

test('a projectile is destroyed by a collider and does not reach an enemy behind it', () => {
  const sim = makeSim(1, { world: new World([wallBox(6)]) });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 10));
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  run(sim, 80);
  assert.equal(dummy.hp, 1000);
  assert.equal(sim.projectiles.length, 0);
});

test('a cone hits an enemy 5 m ahead 20 degrees off-axis and misses at 7 m or 30 degrees', () => {
  const data = dataWith(skill('fire.cone', { type: 'cone', angle: 45, range: 6 }));
  const place = (dist: number, deg: number) => {
    const sim = makeSim(1, { data });
    const a = (deg * Math.PI) / 180;
    const e = spawnEnemy(sim, 'enemy.dummy', V(Math.sin(a) * dist, 0, Math.cos(a) * dist));
    castSkill(sim, sim.player, 'fire.cone', AHEAD);
    run(sim, 3);
    return e.hp < 1000;
  };
  assert.equal(place(5, 20), true);
  assert.equal(place(7, 0), false);
  assert.equal(place(5, 30), false);
});

test('hitEnemies for a cone returns the enemies inside it', () => {
  const sim = makeSim();
  spawnEnemy(sim, 'enemy.dummy', V(0, 0, 4));
  spawnEnemy(sim, 'enemy.dummy', V(0, 0, 40));
  const shape: ShapeDef = { type: 'cone', angle: 45, range: 6 };
  assert.equal(hitEnemies(sim, shape, V(0, 1.4, 0), aimDir(0, 0)).length, 1);
});

test('a stream ticks at its interval for its duration', () => {
  const data = dataWith(skill('water.stream', { type: 'stream', range: 8, width: 0.6, tick: 0.25, duration: 1 }, { element: 'water', damage: 3 }));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 5));
  castSkill(sim, sim.player, 'water.stream', AHEAD);
  run(sim, 30);
  const half = 1000 - dummy.hp;
  assert.ok(half >= 6 && half <= 9, `after 0.5 s: ${half}`);
  run(sim, 90);
  assert.equal(1000 - dummy.hp, 12, 'four ticks of 3 over a 1 s channel, then it stops');
  assert.equal(sim.player.castState, null);
});

test('a stream follows the live aim', () => {
  const data = dataWith(skill('water.stream', { type: 'stream', range: 8, width: 0.6, tick: 0.25, duration: 1 }, { element: 'water', damage: 3 }));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(5, 0, 0));
  castSkill(sim, sim.player, 'water.stream', AHEAD);
  run(sim, 90, { ...idle(), aimYaw: Math.PI / 2 });
  assert.ok(dummy.hp < 1000, 'turning the camera swung the stream onto the dummy');
});

test('a zone persists for its duration and hurts what stands in it each tick', () => {
  const data = dataWith(skill('earth.spikes', { type: 'zone', radius: 3, duration: 2, tick: 0.5 }, { element: 'earth', damage: 5 }));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 8));
  castSkill(sim, sim.player, 'earth.spikes', V(0, 0, 8));
  run(sim, 6);
  assert.equal(sim.zones.length, 1);
  run(sim, 100);
  assert.equal(sim.zones.length, 1, 'still there at 1.8 s');
  run(sim, 30);
  assert.equal(sim.zones.length, 0, 'gone after 2 s');
  assert.ok(dummy.hp < 1000);
});

test('a wall blocks projectiles', () => {
  const data = dataWith(skill('earth.wall', { type: 'wall', width: 4, height: 3, duration: 5 }, { element: 'earth' }));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', V(0, 0, 10));
  castSkill(sim, sim.player, 'earth.wall', V(0, 0, 5));
  run(sim, 3);
  assert.equal(sim.zones.filter((z) => z.kind === 'wall').length, 1);
  sim.player.cooldowns = {};
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  run(sim, 80);
  assert.equal(dummy.hp, 1000);
});

test('a dash moves the caster its distance and a collider stops it short', () => {
  const data = dataWith(skill('wind.dash', { type: 'dash', distance: 6 }, { element: 'wind', slot: 'utility' }));
  const a = makeSim(1, { data });
  castSkill(a, a.player, 'wind.dash', AHEAD);
  run(a, 40);
  assert.ok(Math.abs(a.player.pos.z - 6) < 0.05, `z ${a.player.pos.z}`);
  const b = makeSim(1, { data, world: new World([wallBox(3)]) });
  castSkill(b, b.player, 'wind.dash', AHEAD);
  run(b, 40);
  assert.ok(b.player.pos.z < 3 && b.player.pos.z > 1.5, `z ${b.player.pos.z}`);
});

test('a self skill takes less damage while it lasts', () => {
  const data = dataWith(skill('earth.skin', { type: 'self', duration: 3, damageTakenMul: 0.5, speedMul: 0.8 }, { element: 'earth', slot: 'utility' }));
  const sim = makeSim(1, { data });
  castSkill(sim, sim.player, 'earth.skin', AHEAD);
  run(sim, 3);
  sim.hurtPlayer(10);
  assert.equal(sim.player.hp, 95);
  run(sim, 200);
  sim.hurtPlayer(10);
  assert.equal(sim.player.hp, 85, 'back to normal after 3 s');
});

test('casting inside the cooldown is refused, and so is casting while casting', () => {
  const sim = makeSim();
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, true);
  assert.deepEqual(castSkill(sim, sim.player, 'fire.fireball', AHEAD), { ok: false, reason: 'casting' });
  run(sim, 15);
  assert.deepEqual(castSkill(sim, sim.player, 'fire.fireball', AHEAD), { ok: false, reason: 'cooldown' });
  run(sim, 20);
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, true);
  assert.deepEqual(castSkill(sim, sim.player, 'fire.nope', AHEAD), { ok: false, reason: 'unknown' });
});

test('a windup holds the effect back and slows movement', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  assert.equal(sim.projectiles.length, 0);
  assert.equal(sim.player.castState?.skillId, 'fire.fireball');
  assert.equal(sim.player.castState?.move, 0.7);
});

test('two sims casting the same skills have the same hash', () => {
  const a = makeSim(3);
  const b = makeSim(3);
  for (const s of [a, b]) {
    spawnEnemy(s, 'enemy.dummy', V(0, 0, 10));
    castSkill(s, s.player, 'fire.fireball', AHEAD);
    run(s, 40);
  }
  assert.equal(a.hash(), b.hash());
});
