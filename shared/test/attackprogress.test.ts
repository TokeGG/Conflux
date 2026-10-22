import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnEnemy } from '../src/sim/state.ts';
import { runAttack } from '../src/sim/attacks.ts';
import { makeSim, run } from './helpers.ts';

function setup(attackId: string) {
  const sim = makeSim();
  sim.player.pos = { x: 0, y: 0, z: 2 };
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 0 });
  e.def = { ...e.def, ai: 'none', attacks: [] };
  assert.ok(runAttack(sim, e, attackId, sim.player.pos));
  return { sim, e };
}

test('an enemy with no attack reports none', () => {
  const sim = makeSim();
  spawnEnemy(sim, 'enemy.dummy', { x: 5, y: 0, z: 5 });
  const s = sim.snapshot().enemies[0];
  assert.equal(s.attack, null);
  assert.equal(s.attackPhase, null);
  assert.equal(s.attackProgress, 0);
});

test('the snapshot shows the windup filling from 0 to 1 and reaching 1 at the hit moment', () => {
  const { sim } = setup('atk.swipe_basic'); // windup 0.6 s
  let s = sim.snapshot().enemies[0];
  assert.equal(s.attack, 'atk.swipe_basic');
  assert.equal(s.attackPhase, 'windup');
  assert.ok((s.attackProgress ?? 1) < 0.05);
  run(sim, 18); // 0.3 s
  s = sim.snapshot().enemies[0];
  assert.ok(Math.abs((s.attackProgress ?? 0) - 0.5) < 0.05, `halfway, got ${s.attackProgress}`);
  run(sim, 17);
  s = sim.snapshot().enemies[0];
  assert.ok((s.attackProgress ?? 0) > 0.9 && s.attackPhase === 'windup');
  run(sim, 3);
  assert.equal(sim.snapshot().enemies[0].attack, null, 'a swipe is over once it lands');
});

test('a charge reports its active phase and how far it has run', () => {
  const { sim } = setup('atk.charge_basic'); // windup 0.9 s
  run(sim, 56);
  const s = sim.snapshot().enemies[0];
  assert.equal(s.attackPhase, 'active');
  assert.ok((s.attackProgress ?? -1) >= 0 && (s.attackProgress ?? 2) <= 1);
});
