import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStatus, statusModifiers, tickStatuses } from '../src/sim/statuses.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { idle, makeSim, run } from './helpers.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });

test('burning lasts 5 s and deals its tick damage every 0.5 s', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  applyStatus(sim, e, 'burning', sim.time);
  run(sim, 151);
  assert.equal(1000 - e.hp, 15, 'five ticks of 3 in 2.5 s');
  run(sim, 150);
  assert.equal(1000 - e.hp, 30, 'ten ticks in 5 s');
  assert.equal(e.statuses.burning, undefined, 'gone after 5 s');
  run(sim, 120);
  assert.equal(1000 - e.hp, 30, 'no damage once it is gone');
});

test('soaked slows by 15% for 8 s', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  applyStatus(sim, e, 'soaked', sim.time);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).speedMul, 0.85);
  run(sim, 475);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).speedMul, 0.85, 'still soaked at 7.9 s');
  run(sim, 10);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).speedMul, 1);
});

test('rocked makes the target take 15% more damage', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).damageTakenMul, 1);
  applyStatus(sim, e, 'rocked', sim.time);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).damageTakenMul, 1.15);
});

test('gusted for 1.2 s means it cannot act, then it can again', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  applyStatus(sim, e, 'gusted', sim.time);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).canAct, false);
  run(sim, 66);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).canAct, false, 'still held at 1.1 s');
  run(sim, 7);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).canAct, true);
});

test('reapplying a status resets its timer to full and does not stack', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  applyStatus(sim, e, 'soaked', sim.time);
  run(sim, 180);
  applyStatus(sim, e, 'soaked', sim.time);
  assert.ok(Math.abs(e.statuses.soaked!.until - 11) < 1e-9, `until ${e.statuses.soaked!.until}`);
  assert.equal(statusModifiers(e, sim.time, sim.data.statuses).speedMul, 0.85);
});

test('burning spreads to a neighbour inside the spread radius and not to one outside it', () => {
  const sim = makeSim();
  const a = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  const near = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  applyStatus(sim, a, 'burning', sim.time);
  run(sim, 40);
  assert.ok(near.statuses.burning, 'the neighbour caught it');
  assert.equal(far.statuses.burning, undefined);
});

test('spreading never keeps a fire alive past the first one: two neighbours burn out together', () => {
  const sim = makeSim();
  const a = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  const b = spawnEnemy(sim, 'enemy.dummy', at(1, 8));
  applyStatus(sim, a, 'burning', sim.time);
  run(sim, 301);
  assert.equal(a.statuses.burning, undefined);
  assert.equal(b.statuses.burning, undefined);
});

test('an immune enemy never catches a status', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  const imm = { ...e.def, immune: ['burning' as const] };
  e.def = imm;
  applyStatus(sim, e, 'burning', sim.time);
  assert.deepEqual(e.statuses, {});
});

test('expired statuses are left out of the snapshot', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  applyStatus(sim, e, 'gusted', sim.time);
  assert.equal(sim.snapshot().enemies[0].statuses.length, 1);
  run(sim, 80);
  assert.equal(sim.snapshot().enemies[0].statuses.length, 0);
  assert.equal(e.statuses.gusted, undefined);
});

test('a burning player takes the tick damage and a gusted player cannot move', () => {
  const sim = makeSim();
  applyStatus(sim, sim.player, 'burning', sim.time);
  run(sim, 31);
  assert.ok(sim.player.hp < 100);
  applyStatus(sim, sim.player, 'gusted', sim.time);
  const z = sim.player.pos.z;
  run(sim, 30, { ...idle(), moveZ: 1 });
  assert.equal(sim.player.pos.z, z);
});

test('tickStatuses on its own advances nothing when there are no statuses', () => {
  const sim = makeSim();
  const before = sim.hash();
  tickStatuses(sim, sim.player, 1 / 60);
  assert.equal(sim.hash(), before);
});
