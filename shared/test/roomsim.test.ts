import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { defaultData } from '../src/files.ts';
import { castSkill } from '../src/sim/skills.ts';
import { idle, input, run } from './helpers.ts';

test('a room sim starts the player at the room\'s spawn inside the room\'s walls', () => {
  const data = defaultData();
  const room = data.rooms.forest_clearing;
  const sim = createRoomSim(data, 3, 'forest_clearing');
  assert.deepEqual(sim.player.pos, { ...room.spawns.player, y: 0 });
  assert.ok(sim.world.colliders.length >= room.colliders.length + 4, 'room colliders plus four boundary walls');
  run(sim, 600, input({ moveZ: 1 }));
  const [w, d] = room.size;
  assert.ok(Math.abs(sim.player.pos.x) <= w / 2 && Math.abs(sim.player.pos.z) <= d / 2, `the boundary held (${sim.player.pos.x}, ${sim.player.pos.z})`);
});

test('a room sim keeps the seed, and the walls stop a fireball', () => {
  const data = defaultData();
  const sim = createRoomSim(data, 9, 'forest_clearing');
  assert.equal(sim.seed, 9);
  castSkill(sim, sim.player, 'fire.fireball', { x: sim.player.pos.x, y: 1.4, z: sim.player.pos.z + 500 });
  run(sim, 200, idle());
  assert.equal(sim.projectiles.length, 0);
});

test('an unknown room is refused with its name', () => {
  assert.throws(() => createRoomSim(defaultData(), 1, 'nope'), /nope/);
});
