import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BTN } from '../src/types.ts';
import { castSkill } from '../src/sim/skills.ts';
import { World } from '../src/world.ts';
import { idle, input, makeSim } from './helpers.ts';

const AHEAD = { x: 0, y: 1.4, z: 30 };

test('Shift is the held element\'s dash skill: one dash, with its cooldown, carried along over time (no blink)', () => {
  const sim = makeSim();
  sim.step([input({ buttons: BTN.DODGE })]);
  assert.ok(sim.player.cooldowns['fire.flame_dash'] > 0, 'it cast the fire dash skill');
  assert.ok(sim.player.pos.z < 0.5, `after one tick the player has moved ${sim.player.pos.z.toFixed(2)} m`);
  for (let i = 0; i < 4; i++) sim.step([idle()]); // the skill's short windup
  assert.ok(sim.player.dash, 'it is carried along');
  for (let i = 0; i < 40; i++) sim.step([idle()]);
  assert.ok(Math.abs(sim.player.pos.z - sim.data.skills['fire.flame_dash'].shape.distance!) < 0.5, `covered ${sim.player.pos.z.toFixed(2)} m`);
  const cd = sim.player.cooldowns['fire.flame_dash'];
  for (let i = 0; i < 30; i++) sim.step([input({ buttons: BTN.DODGE })]);
  assert.equal(sim.player.cooldowns['fire.flame_dash'], cd, 'pressing Shift on its cooldown does nothing');
});

test('Shift dashes the way the movement keys point, and straight ahead when none is held', () => {
  const side = makeSim();
  side.step([input({ buttons: BTN.DODGE, moveX: 1 })]);
  for (let i = 0; i < 40; i++) side.step([idle()]);
  assert.ok(side.player.pos.x > 4 && Math.abs(side.player.pos.z) < 0.5, `ended at ${side.player.pos.x.toFixed(1)}, ${side.player.pos.z.toFixed(1)}`);
});

test('an element whose utility is not a dash gets the same dash without a skill: carried over time, with its own cooldown', () => {
  const sim = makeSim();
  sim.player.element = 2; // earth: its utility is a shield
  assert.notEqual(sim.data.skills[sim.player.loadout.earth.utility].shape.type, 'dash');
  sim.step([input({ buttons: BTN.DODGE })]);
  assert.ok(sim.player.dash, 'carried along like a dash skill');
  assert.ok(sim.player.pos.z < 0.6, `not a blink: ${sim.player.pos.z.toFixed(2)} m after one tick`);
  assert.equal(sim.snapshot().players[0].dodging, true);
  for (let i = 0; i < 40; i++) sim.step([idle()]);
  const d = sim.data.player.dodge;
  assert.ok(Math.abs(sim.player.pos.z - d.speed * d.duration) < 0.5, `covered ${sim.player.pos.z.toFixed(2)} m`);
  assert.equal(sim.snapshot().players[0].dodging, false);
});

test('a dash skill and the plain dash both show the dash pose while they carry the player', () => {
  const sim = makeSim();
  sim.step([input({ buttons: BTN.DODGE })]);
  for (let i = 0; i < 6; i++) sim.step([idle()]);
  assert.equal(sim.snapshot().players[0].dodging, true);
});

test('a dash skill carries the player along over a fraction of a second: no single tick moves more than half a metre', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.flame_dash', AHEAD);
  let last = 0;
  let biggest = 0;
  for (let i = 0; i < 60; i++) {
    sim.step([idle()]);
    biggest = Math.max(biggest, sim.player.pos.z - last);
    last = sim.player.pos.z;
  }
  assert.ok(biggest < 0.5, `the biggest step was ${biggest.toFixed(2)} m`);
  assert.ok(Math.abs(last - sim.data.skills['fire.flame_dash'].shape.distance!) < 0.5, `arrived ${last.toFixed(2)} m`);
});

test('a dash stops at a wall instead of going through it', () => {
  const sim = makeSim(1, { world: new World([{ kind: 'box', min: { x: -5, y: 0, z: 3 }, max: { x: 5, y: 4, z: 4 } }], 0) });
  castSkill(sim, sim.player, 'fire.flame_dash', AHEAD);
  for (let i = 0; i < 40; i++) sim.step([idle()]);
  assert.ok(sim.player.pos.z < 3 - 0.3, `stopped at ${sim.player.pos.z.toFixed(2)}`);
});

test('the trail of a dash skill still lands along the path', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.flame_dash', AHEAD);
  for (let i = 0; i < 30; i++) sim.step([idle()]);
  assert.ok(sim.zones.length >= 3);
});
