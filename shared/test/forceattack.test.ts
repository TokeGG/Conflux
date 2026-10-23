import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDevCommand } from '../src/sim/devcmd.ts';
import { makeSim } from './helpers.ts';

test('forceAttack starts a named attack on an enemy ignoring its cooldown, marks the run tuned, and refuses nonsense', () => {
  const sim = makeSim();
  sim.player.pos = { x: 0, y: 0, z: 0 };
  applyDevCommand(sim, { op: 'spawn', enemy: 'boss.maw', count: 1, at: { x: 0, y: 0, z: 6 } });
  const maw = sim.enemies[0];
  sim.tuned = false;
  maw.cooldowns['atk.maw_charge'] = sim.time + 100;
  assert.equal(applyDevCommand(sim, { op: 'forceAttack', enemy: maw.id, attack: 'atk.maw_charge' }), null);
  assert.equal(maw.attack?.attackId, 'atk.maw_charge');
  assert.equal(sim.tuned, true);
  assert.match(applyDevCommand(sim, { op: 'forceAttack', enemy: maw.id, attack: 'atk.nope' })!, /atk\.nope/);
  assert.match(applyDevCommand(sim, { op: 'forceAttack', enemy: 9999, attack: 'atk.maw_claw' })!, /9999/);
  // a busy enemy is refused rather than interrupted
  assert.match(applyDevCommand(sim, { op: 'forceAttack', enemy: maw.id, attack: 'atk.maw_claw' })!, /busy/);
});

test('forceAttack with no enemy id uses the first enemy', () => {
  const sim = makeSim();
  applyDevCommand(sim, { op: 'spawn', enemy: 'boss.reaper', count: 1, at: { x: 0, y: 0, z: 8 } });
  assert.equal(applyDevCommand(sim, { op: 'forceAttack', attack: 'atk.reaper_wave' }), null);
  assert.equal(sim.enemies[0].attack?.attackId, 'atk.reaper_wave');
});
