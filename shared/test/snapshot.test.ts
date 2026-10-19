import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSkill } from '../src/sim/skills.ts';
import { trySwap } from '../src/sim/swap.ts';
import { BTN, idle, input, makeSim, run } from './helpers.ts';

test('the snapshot lists the held element\'s three skill slots with their cooldowns', () => {
  const sim = makeSim();
  const p = sim.snapshot().players[0];
  assert.deepEqual(p.slots.map((s) => s.slot), ['basic', 'secondary', 'utility']);
  assert.deepEqual(p.slots.map((s) => s.skillId), ['fire.fireball', 'fire.flame_cone', 'fire.flame_dash']);
  assert.ok(p.slots.every((s) => s.remaining === 0 && s.total > 0));
  castSkill(sim, sim.player, 'fire.fireball', { x: 0, y: 1.4, z: 20 });
  const after = sim.snapshot().players[0].slots[0];
  assert.ok(Math.abs(after.remaining - 0.45) < 1e-9 && after.total === 0.45);
  run(sim, 20);
  assert.ok(sim.snapshot().players[0].slots[0].remaining < 0.2);
});

test('the slots follow the element after a swap', () => {
  const sim = makeSim();
  run(sim, 1, input({ swapTo: 1 }));
  assert.deepEqual(sim.snapshot().players[0].slots.map((s) => s.skillId), ['water.water_bolt', 'water.tidal_stream', 'water.bubble_shield']);
});

test('the snapshot shows the swap cooldown and the swap-in bonus counting down', () => {
  const sim = makeSim();
  trySwap(sim, sim.player, 2);
  let p = sim.snapshot().players[0];
  assert.ok(Math.abs(p.swapRemaining - 0.4) < 1e-9);
  assert.ok(Math.abs(p.bonusRemaining - 3) < 1e-9);
  run(sim, 30, idle());
  p = sim.snapshot().players[0];
  assert.equal(p.swapRemaining, 0);
  assert.ok(p.bonusRemaining > 2 && p.bonusRemaining < 2.6);
});

test('a used swap bonus leaves the snapshot', () => {
  const sim = makeSim();
  trySwap(sim, sim.player, 1);
  run(sim, 1, input({ buttons: BTN.LMB }));
  assert.equal(sim.snapshot().players[0].bonusRemaining, 0);
});
