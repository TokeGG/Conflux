import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalBridge, MAX_TICKS_PER_ADVANCE, type DevCommand } from '../src/bridge.ts';
import { TICK } from '../src/sim/sim.ts';
import type { Snapshot } from '../src/sim/state.ts';
import type { Input, SimEvent } from '../src/types.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { idle, input, makeSim } from './helpers.ts';

test('advance(1/60) runs exactly one tick', () => {
  const sim = makeSim();
  new LocalBridge(sim).advance(TICK);
  assert.equal(sim.tick, 1);
});

test('small advances accumulate: three 1/180 s advances make one tick', () => {
  const sim = makeSim();
  const b = new LocalBridge(sim);
  for (let i = 0; i < 3; i++) b.advance(TICK / 3);
  assert.equal(sim.tick, 1);
});

test('a backgrounded tab (advance(1)) runs at most 5 ticks and drops the backlog', () => {
  const sim = makeSim();
  const b = new LocalBridge(sim);
  b.advance(1);
  assert.equal(sim.tick, MAX_TICKS_PER_ADVANCE);
  assert.equal(MAX_TICKS_PER_ADVANCE, 5);
  b.advance(0);
  assert.equal(sim.tick, 5, 'the remainder was dropped, not saved for later');
  b.advance(TICK);
  assert.equal(sim.tick, 6);
  new LocalBridge(makeSim()).advance(30);
});

test('a negative or NaN step is ignored without throwing', () => {
  const sim = makeSim();
  const b = new LocalBridge(sim);
  assert.doesNotThrow(() => {
    b.advance(-1);
    b.advance(NaN);
    b.advance(Infinity);
  });
  assert.equal(sim.tick, 0);
});

test('frames deliver snapshots whose tick never goes backwards', () => {
  const b = new LocalBridge(makeSim());
  const ticks: number[] = [];
  b.onFrame((s: Snapshot) => ticks.push(s.tick));
  for (let i = 0; i < 40; i++) b.advance(0.02 + (i % 3) * 0.01);
  assert.ok(ticks.length > 0);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1], `tick ${ticks[i]} after ${ticks[i - 1]}`);
});

test('no frame is sent when no tick ran', () => {
  const b = new LocalBridge(makeSim());
  let frames = 0;
  b.onFrame(() => frames++);
  b.advance(TICK / 10);
  assert.equal(frames, 0);
  b.advance(TICK);
  assert.equal(frames, 1);
});

test('the latest sent input is consumed on the next tick', () => {
  const sim = makeSim();
  const seen: Input[][] = [];
  const real = sim.step.bind(sim);
  sim.step = (i) => (seen.push(i), real(i));
  const b = new LocalBridge(sim);
  b.send(input({ moveZ: 1 }));
  b.advance(TICK);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0].moveZ, 1);
  b.send(input({ moveZ: -1 }));
  b.send(input({ moveX: 1 }));
  b.advance(TICK);
  assert.deepEqual([seen[1][0].moveZ, seen[1][0].moveX], [0, 1], 'only the newest input counts');
});

test('before any input is sent the sim receives an idle input', () => {
  const sim = makeSim();
  const seen: Input[][] = [];
  const real = sim.step.bind(sim);
  sim.step = (i) => (seen.push(i), real(i));
  new LocalBridge(sim).advance(TICK);
  assert.deepEqual(seen[0], [idle()]);
});

test('a LocalBridge and a raw Sim fed the same inputs have equal hashes', () => {
  const a = makeSim(11);
  const b = makeSim(11);
  spawnEnemy(a, 'enemy.dummy', { x: 0, y: 0, z: 6 });
  spawnEnemy(b, 'enemy.dummy', { x: 0, y: 0, z: 6 });
  const bridge = new LocalBridge(a);
  for (let k = 0; k < 120; k++) {
    const i = input({ moveX: Math.sin(k), moveZ: Math.cos(k), buttons: k % 7 });
    bridge.send(i);
    bridge.advance(TICK);
    b.step([i]);
  }
  assert.equal(a.tick, 120);
  assert.equal(a.hash(), b.hash());
});

test('events emitted during the ticks of one advance arrive once, in the frame', () => {
  const sim = makeSim();
  const b = new LocalBridge(sim);
  const got: SimEvent[] = [];
  b.onFrame((_s, events) => got.push(...events));
  sim.emit('cast', { skill: 'x' });
  b.advance(TICK * 2);
  b.advance(TICK);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, 'cast');
});

test('dev commands reach the handler before the next tick runs', () => {
  const sim = makeSim();
  const order: string[] = [];
  const real = sim.step.bind(sim);
  sim.step = (i) => (order.push('tick'), real(i));
  const b = new LocalBridge(sim);
  b.setCommandHandler((c: DevCommand) => order.push(`cmd:${c.op}`));
  b.command({ op: 'probe' });
  b.advance(TICK);
  assert.deepEqual(order, ['cmd:probe', 'tick']);
});

test('dispose stops ticks and frames', () => {
  const sim = makeSim();
  const b = new LocalBridge(sim);
  let frames = 0;
  b.onFrame(() => frames++);
  b.advance(TICK);
  b.dispose();
  b.advance(1);
  assert.equal(sim.tick, 1);
  assert.equal(frames, 1);
});
