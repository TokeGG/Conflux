import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN } from '../src/types.ts';
import { applyStatus } from '../src/sim/statuses.ts';
import { idle, input, makeSim } from './helpers.ts';

const jump = () => input({ buttons: BTN.JUMP });

/** Presses jump on the first tick only and returns the height reached and the time it took to land. */
function tap(sim = makeSim()): { peak: number; landedAt: number } {
  let peak = 0;
  let landedAt = -1;
  for (let i = 0; i < 120; i++) {
    sim.step([i === 0 ? jump() : idle()]);
    peak = Math.max(peak, sim.player.pos.y);
    if (i > 5 && sim.player.pos.y === 0 && landedAt < 0) landedAt = sim.time;
  }
  return { peak, landedAt };
}

test('a jump rises about 1.1 m, and lands again in under a second', () => {
  const { peak, landedAt } = tap();
  assert.ok(peak > 0.9 && peak < 1.4, `peak ${peak.toFixed(2)}`);
  assert.ok(landedAt > 0.4 && landedAt < 1.0, `landed at ${landedAt.toFixed(2)}`);
});

test('holding jump in the air does not jump again, and a held key jumps again only on landing', () => {
  const sim = makeSim();
  let peak = 0;
  let airborneTicks = 0;
  for (let i = 0; i < 60; i++) {
    sim.step([jump()]);
    peak = Math.max(peak, sim.player.pos.y);
    if (sim.player.pos.y > 0) airborneTicks++;
  }
  assert.ok(peak < 1.4, `no double jump (peak ${peak.toFixed(2)})`);
  assert.ok(airborneTicks > 45, 'the held key jumped again on landing');
});

test('a player who cannot act cannot jump', () => {
  const sim = makeSim();
  applyStatus(sim, sim.player, 'gusted', sim.time);
  for (let i = 0; i < 10; i++) sim.step([jump()]);
  assert.equal(sim.player.pos.y, 0);
});

test('the player can move while in the air, and the jump leaves the ground y at 0 afterwards', () => {
  const sim = makeSim();
  for (let i = 0; i < 20; i++) sim.step([input({ buttons: i === 0 ? BTN.JUMP : 0, moveZ: 1 })]);
  assert.ok(sim.player.pos.z > 1.5 && sim.player.pos.y > 0.2);
  for (let i = 0; i < 80; i++) sim.step([idle()]);
  assert.equal(sim.player.pos.y, 0);
});
