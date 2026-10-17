import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, type Collider } from '../src/world.ts';
import { BTN, input, idle, makeSim, run } from './helpers.ts';

const box = (x0: number, z0: number, x1: number, z1: number): Collider => ({ kind: 'box', min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 3, z: z1 } });

test('holding forward for 60 ticks moves 6 m along the aim direction', () => {
  const sim = makeSim();
  run(sim, 60, input({ moveZ: 1 }));
  assert.ok(Math.abs(sim.player.pos.z - 6) < 0.05, `z ${sim.player.pos.z}`);
  assert.ok(Math.abs(sim.player.pos.x) < 0.01);
});

test('movement follows the aim yaw', () => {
  const sim = makeSim();
  run(sim, 60, input({ moveZ: 1, aimYaw: Math.PI / 2 }));
  assert.ok(Math.abs(sim.player.pos.x - 6) < 0.05, `x ${sim.player.pos.x}`);
});

test('diagonal input is not faster than 6 m/s', () => {
  const sim = makeSim();
  run(sim, 60, input({ moveX: 1, moveZ: 1 }));
  const d = Math.hypot(sim.player.pos.x, sim.player.pos.z);
  assert.ok(d <= 6.05, `distance ${d}`);
  assert.ok(d >= 5.9);
});

test('the player cannot walk through a collider', () => {
  const sim = makeSim(1, { world: new World([box(-5, 3, 5, 4)]) });
  run(sim, 120, input({ moveZ: 1 }));
  assert.ok(sim.player.pos.z < 3, `z ${sim.player.pos.z}`);
});

test('the player slides along a wall instead of stopping dead', () => {
  const sim = makeSim(1, { world: new World([box(-5, 3, 5, 4)]) });
  run(sim, 60, input({ moveX: 1, moveZ: 1 }));
  assert.ok(sim.player.pos.x > 2, `x ${sim.player.pos.x}`);
});

test('a dodge is invulnerable for the first 0.25 s only', () => {
  const sim = makeSim();
  run(sim, 1, input({ buttons: BTN.DODGE }));
  run(sim, 13, idle());
  assert.equal(sim.tick, 14);
  assert.equal(sim.hurtPlayer(10), false);
  assert.equal(sim.player.hp, 100);
  run(sim, 2, idle());
  assert.equal(sim.tick, 16);
  assert.equal(sim.hurtPlayer(10), true);
  assert.equal(sim.player.hp, 90);
});

test('a dodge rolls for 0.4 s then ends', () => {
  const sim = makeSim();
  run(sim, 1, input({ buttons: BTN.DODGE }));
  assert.equal(sim.snapshot().players[0].dodging, true);
  run(sim, 30, idle());
  assert.equal(sim.snapshot().players[0].dodging, false);
  assert.ok(sim.player.pos.z > 2, 'the roll covers ground');
});

test('a second dodge before 1.2 s is ignored, and one after is accepted', () => {
  const sim = makeSim();
  run(sim, 1, input({ buttons: BTN.DODGE }));
  const until = sim.player.dodgeUntil;
  run(sim, 40, input({ buttons: BTN.DODGE }));
  assert.equal(sim.player.dodgeUntil, until);
  run(sim, 40, input({ buttons: BTN.DODGE }));
  assert.ok(sim.player.dodgeUntil > until);
});

test('a dodge cancels an in-progress cast', () => {
  const sim = makeSim();
  sim.player.castState = { skillId: 'fire.fireball', until: 5, move: 0.7 };
  run(sim, 1, input({ buttons: BTN.DODGE }));
  assert.equal(sim.player.castState, null);
});

test('a cast slows movement by its move multiplier until it ends', () => {
  const sim = makeSim();
  sim.player.castState = { skillId: 'fire.fireball', until: 10, move: 0.5 };
  run(sim, 60, input({ moveZ: 1 }));
  assert.ok(Math.abs(sim.player.pos.z - 3) < 0.05, `z ${sim.player.pos.z}`);
});
