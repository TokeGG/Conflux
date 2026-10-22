import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData } from '../src/files.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { createRunRoomSim } from '../src/run/director.ts';
import { ENDLESS, planRoomAt } from '../src/run/endless.ts';
import { makeSim, run } from './helpers.ts';

const data = defaultData();

test('the scaling numbers are 0.10 health and 0.02 damage per room (tuned by the balance report)', () => {
  assert.equal(data.rewards.scaling.hpPerRoom, 0.1);
  assert.equal(data.rewards.scaling.damagePerRoom, 0.02);
});

test('the same enemy at room 10 has twice the health of room 0, and the snapshot carries its level and max health', () => {
  const sim = makeSim();
  const a = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  const b = spawnEnemy(sim, 'enemy.dummy', { x: 3, y: 0, z: 8 }, 10);
  assert.equal(a.maxHp, 1000);
  assert.equal(b.maxHp, 2000);
  assert.equal(b.hp, 2000);
  const snaps = sim.snapshot().enemies;
  assert.deepEqual(snaps.map((s) => [s.level, s.maxHp]), [[0, 1000], [10, 2000]]);
});

test('the same enemy hits harder at room 10: the damage the player takes is multiplied', () => {
  const lost = (level: number) => {
    const sim = makeSim();
    sim.player.hp = 1e6;
    const e = spawnEnemy(sim, 'enemy.skeleton', { x: sim.player.pos.x, y: 0, z: sim.player.pos.z + 1.5 }, level);
    e.cooldowns = {};
    run(sim, 60 * 6);
    return 1e6 - sim.player.hp;
  };
  const base = lost(0);
  assert.ok(base > 0, 'the golem hurt the player at level 0');
  const later = lost(10);
  assert.ok(Math.abs(later / base - (1 + 10 * data.rewards.scaling.damagePerRoom)) < 0.01, `ratio ${later / base}`);
});

test('a room built by the run gives its enemies the room number as their level, and elites keep their modifier', () => {
  const state = ENDLESS.start(5, data);
  const plan = planRoomAt(data, 5, 1, 8);
  assert.ok(plan.enemies.some((e) => e.elite));
  const sim = createRunRoomSim({ ...state, current: plan }, data);
  assert.ok(sim.enemies.length > 0);
  for (const e of sim.enemies) assert.equal(e.level, 8);
  assert.equal(sim.enemies.filter((e) => e.elite).length, 1);
});

test('the budget and the number of enemies rise with the room, up to 40', () => {
  const counts = [0, 2, 5, 8, 12].map((i) => planRoomAt(data, 9, 1, i).enemies.length);
  assert.equal(planRoomAt(data, 9, 1, 4).budget, data.rewards.budget.base + data.rewards.budget.perRoom * 4);
  // later rooms also buy costlier mobs, so the count need not rise every step, but it does rise overall
  assert.ok(counts[4] >= counts[0] * 1.5, `counts ${counts}`);
  assert.ok(counts[2] > counts[0], `counts ${counts}`);
  for (let i = 0; i < 40; i++) assert.ok(planRoomAt(data, 3, 1 + Math.floor(i / 8), i).enemies.length <= 40);
});

test('40 enemies tick a room for 10 s at under 4 ms per tick', () => {
  const sim = makeSim();
  sim.god = true;
  for (let i = 0; i < 40; i++) spawnEnemy(sim, 'enemy.skeleton', { x: -10 + (i % 8) * 2.5, y: 0, z: 6 + Math.floor(i / 8) * 2.5 });
  const t = performance.now();
  run(sim, 600);
  const per = (performance.now() - t) / 600;
  assert.ok(per < 4, `${per.toFixed(2)} ms per tick`);
});
