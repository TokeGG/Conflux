import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardReduction, stepGuard } from '../src/sim/guard.ts';
import { dealDamage } from '../src/sim/damage.ts';
import { triggerReaction } from '../src/sim/reactions.ts';
import { applyStatus } from '../src/sim/statuses.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { makeSim, run } from './helpers.ts';

const GUARD = { reduction: 0.8, onFor: 3, offFor: 5, staggerOnWeak: 2 };

function guarded() {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  e.def = { ...e.def, element: 'earth', weak: ['wind'], resist: ['water'], guard: GUARD };
  e.guard = { on: true, until: 3, staggeredUntil: 0 };
  return { sim, e };
}
const lost = (e: { hp: number }) => 1000 - e.hp;

test('the guard is on for 3 s then off for 5 s, repeating', () => {
  const { sim, e } = guarded();
  e.guard = { on: false, until: 0, staggeredUntil: 0 };
  const log: boolean[] = [];
  for (let i = 0; i < 17 * 60; i++) {
    stepGuard(e, sim.time);
    log.push(e.guard.on);
    sim.step([]);
  }
  const secsOn = (from: number, to: number) => log.slice(from * 60, to * 60).filter(Boolean).length / 60;
  assert.ok(Math.abs(secsOn(0, 3) - 3) < 0.1, 'up for the first 3 s');
  assert.ok(secsOn(3.2, 7.8) < 0.1, 'down for the next 5 s');
  assert.ok(Math.abs(secsOn(8, 11) - 3) < 0.1, 'up again for 3 s');
  assert.ok(secsOn(11.2, 15.8) < 0.1, 'down again for 5 s');
});

test('a non-weakness hit during guard does 20% of normal', () => {
  const { sim, e } = guarded();
  assert.ok(Math.abs(dealDamage(sim, e, 10, 'fire') - 2) < 1e-9);
  const open = guarded();
  open.e.guard!.on = false;
  assert.equal(dealDamage(open.sim, open.e, 10, 'fire'), 10);
});

test('a weakness hit deals 1.5x with no reduction and knocks the guard down for 2 s', () => {
  const { sim, e } = guarded();
  assert.equal(dealDamage(sim, e, 10, 'wind'), 15);
  assert.equal(e.guard!.on, false);
  assert.ok(Math.abs(e.guard!.staggeredUntil - 2) < 1e-9);
  const events = sim.step([]);
  assert.equal(events.filter((x) => x.type === 'guard_broken').length, 1);
  for (let i = 0; i < 100; i++) {
    stepGuard(e, sim.time);
    assert.equal(e.guard!.on, false, `still down at ${sim.time}`);
    if (sim.time > 1.9) break;
    sim.step([]);
  }
});

test('the guard can come back after the stagger ends', () => {
  const { sim, e } = guarded();
  dealDamage(sim, e, 10, 'wind');
  run(sim, 130);
  stepGuard(e, sim.time);
  assert.equal(e.guard!.on, true);
});

test('a resisted hit during guard stacks both reductions, and a guard that is already down is not staggered again', () => {
  const { sim, e } = guarded();
  assert.ok(Math.abs(dealDamage(sim, e, 10, 'water') - 1) < 1e-9, '0.5 resist times 0.2 guard');
  const down = guarded();
  down.e.guard!.on = false;
  dealDamage(down.sim, down.e, 10, 'wind');
  assert.equal(down.e.guard!.staggeredUntil, 0);
});

test('a reaction ignores the guard', () => {
  const { sim, e } = guarded();
  applyStatus(sim, e, 'soaked', sim.time);
  const res = triggerReaction(sim, e, 'fire', 10, sim.time)!;
  assert.equal(res.damage, 10, 'steam burst at full strength');
  assert.equal(lost(e), 10);
});

test('guardReduction reports the multiplier and whether the hit staggers', () => {
  const { e } = guarded();
  const g = guardReduction(e, 'fire', false);
  assert.ok(Math.abs(g.mul - 0.2) < 1e-9 && !g.stagger);
  assert.deepEqual(guardReduction(e, 'wind', false), { mul: 1, stagger: true });
  assert.deepEqual(guardReduction(e, 'fire', true), { mul: 1, stagger: false });
  e.guard!.on = false;
  assert.deepEqual(guardReduction(e, 'fire', false), { mul: 1, stagger: false });
});

test('an enemy with no guard block is unaffected', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  assert.equal(e.guard, null);
  assert.equal(dealDamage(sim, e, 10, 'fire'), 10);
  assert.deepEqual(guardReduction(e, 'fire', false), { mul: 1, stagger: false });
  assert.doesNotThrow(() => stepGuard(e, 5));
});
