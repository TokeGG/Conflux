import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDevCommand } from '../src/sim/devcmd.ts';
import { ELEMENTS } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

test('tryReaction spawns a dummy beside the player, applies the first element and hits with the second', () => {
  const sim = makeSim();
  assert.equal(applyDevCommand(sim, { op: 'tryReaction', a: 'fire', b: 'water' }), null);
  assert.equal(sim.enemies.length, 1);
  const d = sim.enemies[0];
  assert.ok(Math.hypot(d.pos.x - sim.player.pos.x, d.pos.z - sim.player.pos.z) < 6, 'beside the player');
  run(sim, 2);
  assert.ok(d.cooldowns['reaction.steam'] > 0, 'the steam reaction fired');
  assert.equal(sim.tuned, true);
});

test('tryReaction refuses a bad pair', () => {
  const sim = makeSim();
  assert.match(applyDevCommand(sim, { op: 'tryReaction', a: 'fire', b: 'fire' })!, /two different/);
  assert.match(applyDevCommand(sim, { op: 'tryReaction', a: 'ice', b: 'fire' })!, /ice/);
  assert.equal(sim.enemies.length, 0);
});

test('tryReaction fires every one of the 45 pairs, in both orders', () => {
  for (const a of ELEMENTS) {
    for (const b of ELEMENTS) {
      if (a === b) continue;
      const sim = makeSim();
      assert.equal(applyDevCommand(sim, { op: 'tryReaction', a, b }), null);
      const d = sim.enemies[0];
      assert.ok(Object.keys(d.cooldowns).some((k) => k.startsWith('reaction.')), `${a}+${b} fired`);
    }
  }
});
