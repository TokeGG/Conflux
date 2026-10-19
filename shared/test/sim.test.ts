import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, TICK } from '../src/sim/sim.ts';
import { spawnEnemy, enemyHurtboxes } from '../src/sim/state.ts';
import { EVENT_TYPES } from '../src/events.ts';
import { Rng } from '../src/rng.ts';
import { defaultData } from '../src/files.ts';
import * as shared from '../src/index.ts';
import { idle, input, makeSim } from './helpers.ts';

const script = (n: number) => {
  const r = new Rng(99);
  return Array.from({ length: n }, () => input({ moveX: r.next() * 2 - 1, moveZ: r.next() * 2 - 1, aimYaw: r.next() * 6, buttons: r.int(32) }));
};

test('two sims with the same seed and the same 600-tick script have equal hashes at every 100th tick', () => {
  const a = makeSim(5);
  const b = makeSim(5);
  spawnEnemy(a, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  spawnEnemy(b, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  const inputs = script(600);
  assert.equal(a.hash(), b.hash());
  inputs.forEach((i, k) => {
    a.step([i]);
    b.step([i]);
    if ((k + 1) % 100 === 0) assert.equal(a.hash(), b.hash(), `diverged at tick ${k + 1}`);
  });
});

test('a different seed gives a different hash at tick 0 and after 60 ticks', () => {
  const a = makeSim(1);
  const b = makeSim(2);
  assert.notEqual(a.hash(), b.hash());
  for (let i = 0; i < 60; i++) {
    a.step([idle()]);
    b.step([idle()]);
  }
  assert.notEqual(a.hash(), b.hash());
});

test('using the combat stream changes the hash (the generator state is part of it)', () => {
  const a = makeSim(7);
  const b = makeSim(7);
  a.streams.combat.next();
  assert.notEqual(a.hash(), b.hash());
  b.streams.combat.next();
  assert.equal(a.hash(), b.hash());
});

test('the hash covers enemy health and player position', () => {
  const a = makeSim(3);
  const e = spawnEnemy(a, 'enemy.dummy', { x: 1, y: 0, z: 1 });
  const before = a.hash();
  e.hp -= 1;
  assert.notEqual(a.hash(), before);
  const mid = a.hash();
  a.player.pos.x += 0.5;
  assert.notEqual(a.hash(), mid);
});

test('step advances tick by 1 and time by TICK', () => {
  const sim = makeSim();
  assert.equal(sim.tick, 0);
  for (let i = 0; i < 3; i++) sim.step([idle()]);
  assert.equal(sim.tick, 3);
  assert.ok(Math.abs(sim.time - 3 * TICK) < 1e-12);
  assert.ok(Math.abs(TICK - 1 / 60) < 1e-15);
});

test('an empty input array does not throw and keeps the player in place', () => {
  const sim = makeSim();
  const { x, y, z } = sim.player.pos;
  assert.doesNotThrow(() => sim.step([]));
  assert.deepEqual(sim.player.pos, { x, y, z });
});

test('spawnEnemy gives the def hp and a unique id, and refuses an unknown enemy', () => {
  const sim = makeSim();
  const a = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 5 });
  const b = spawnEnemy(sim, 'enemy.dummy', { x: 2, y: 0, z: 5 });
  assert.equal(a.hp, sim.data.enemies['enemy.dummy'].hp);
  assert.notEqual(a.id, b.id);
  assert.equal(sim.enemies.length, 2);
  assert.throws(() => spawnEnemy(sim, 'enemy.nope', { x: 0, y: 0, z: 0 }), /enemy\.nope/);
});

test('enemyHurtboxes follow the position and turn with the facing', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 10, y: 0, z: 20 });
  const [h] = enemyHurtboxes(e);
  assert.deepEqual([h.a.x, h.a.y, h.a.z], [10, 0.4, 20]);
  assert.deepEqual([h.b.x, h.b.y, h.b.z], [10, 1.4, 20]);
  assert.equal(h.r, 0.5);
  assert.equal(h.enemyId, e.id);
  e.pos.x = 11;
  assert.equal(enemyHurtboxes(e)[0].a.x, 11);
  e.def = { ...e.def, hurtboxes: [{ a: [1, 0, 0], b: [1, 2, 0], r: 0.3 }] };
  e.pos = { x: 0, y: 0, z: 0 };
  e.facing = Math.PI / 2; // yaw 90 degrees turns +X offsets toward -Z
  const turned = enemyHurtboxes(e)[0];
  assert.ok(Math.abs(turned.a.x) < 1e-9 && Math.abs(turned.a.z - -1) < 1e-9, JSON.stringify(turned.a));
});

test('emit accepts only the declared event types and stamps the time', () => {
  const sim = makeSim();
  assert.throws(() => sim.emit('explode' as never, {}), /explode/);
  sim.step([idle()]);
  sim.emit('cast', { skill: 'fire.fireball' });
  const events = sim.step([idle()]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cast');
  assert.ok(Math.abs(events[0].t - TICK) < 1e-12);
  assert.equal(sim.step([idle()]).length, 0, 'events are delivered once');
});

test('EVENT_TYPES lists the types the plan names', () => {
  for (const t of ['cast', 'hit', 'status_applied', 'reaction', 'guard_broken', 'telegraph', 'enemy_died', 'room_cleared', 'reward_offered', 'swap', 'dodge']) assert.ok((EVENT_TYPES as readonly string[]).includes(t), t);
});

test('snapshot reports entities with the remaining time of each status', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 3, y: 0, z: 4 });
  e.statuses.burning = { until: sim.time + 5 };
  sim.step([idle()]);
  const snap = sim.snapshot();
  assert.equal(snap.tick, 1);
  assert.equal(snap.players.length, 1);
  assert.equal(snap.players[0].hp, sim.data.player.health);
  assert.equal(snap.enemies.length, 1);
  assert.equal(snap.enemies[0].defId, 'enemy.dummy');
  assert.deepEqual(snap.enemies[0].pos, { x: 3, y: 0, z: 4 });
  const burning = snap.enemies[0].statuses.find((s) => s.id === 'burning')!;
  assert.ok(Math.abs(burning.remaining - (5 - TICK)) < 1e-9);
  assert.deepEqual(snap.projectiles, []);
  assert.deepEqual(snap.zones, []);
});

test('the snapshot is a copy: changing it never changes the sim', () => {
  const sim = makeSim();
  spawnEnemy(sim, 'enemy.dummy', { x: 3, y: 0, z: 4 });
  const before = sim.hash();
  const snap = sim.snapshot();
  snap.enemies[0].pos.x = 99;
  snap.players[0].pos.z = 99;
  assert.equal(sim.hash(), before);
});

test('the package index exports the public surface', () => {
  for (const name of ['Sim', 'TICK', 'Rng', 'World', 'defaultData', 'loadData', 'validateData', 'spawnEnemy', 'EVENT_TYPES', 'BTN']) assert.ok(name in shared, `missing export ${name}`);
});

test('data is not shared between sims', () => {
  const a = new Sim(defaultData(), 1);
  const b = new Sim(defaultData(), 1);
  a.data.player.health = 1;
  assert.notEqual(b.data.player.health, 1);
});
