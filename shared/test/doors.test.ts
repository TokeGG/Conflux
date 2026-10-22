import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { applyDevCommand } from '../src/sim/devcmd.ts';
import { generateRoom } from '../src/gen/generate.ts';
import { defaultData } from '../src/files.ts';
import { idleInput } from '../src/types.ts';
import type { Sim } from '../src/sim/sim.ts';

const data = defaultData();
const room = generateRoom(data, 5, 1, 0, 'crypt').room;

/** A sim of the generated room with one enemy, run until the room is cleared. */
function cleared(): { sim: Sim; events: string[] } {
  const sim = createRoomSim(data, 1, room);
  spawnEnemy(sim, 'enemy.dummy', { x: room.spawns.enemies[0].x, y: 0, z: room.spawns.enemies[0].z });
  const events: string[] = [];
  const step = () => sim.step([idleInput()]).forEach((e) => events.push(e.type + (e.type === 'door_entered' ? `:${e.door}` : '')));
  step();
  applyDevCommand(sim, { op: 'killAll' });
  for (let i = 0; i < 5; i++) step();
  assert.ok(events.includes('room_cleared'));
  (sim as any).stepFor = step;
  return { sim, events };
}
const stepOf = (sim: Sim) => (sim as any).stepFor as () => void;
const stand = (sim: Sim, p: { x: number; z: number }) => (sim.player.pos = { x: p.x, y: 0, z: p.z });

test('the sim knows where the gates are', () => {
  const sim = createRoomSim(data, 1, room);
  assert.deepEqual(sim.doors.map((d) => [d.x, d.z]), room.spawns.doors.map((d) => [d.x, d.z]));
});

test('no door_entered before the room is cleared, even standing in a gate', () => {
  const sim = createRoomSim(data, 1, room);
  spawnEnemy(sim, 'enemy.dummy', { x: room.spawns.enemies[0].x, y: 0, z: room.spawns.enemies[0].z });
  stand(sim, room.spawns.doors[0]);
  const types = Array.from({ length: 5 }, () => sim.step([idleInput()]).map((e) => e.type)).flat();
  assert.ok(!types.includes('door_entered'));
});

test('walking into a gate after the clear emits door_entered once, with that gate\'s index', () => {
  const { sim, events } = cleared();
  stand(sim, room.spawns.player);
  stepOf(sim)();
  const second = room.spawns.doors.length - 1;
  stand(sim, room.spawns.doors[second]);
  for (let i = 0; i < 10; i++) stepOf(sim)();
  assert.equal(events.filter((e) => e.startsWith('door_entered')).length, 1, 'staying in the gate does not repeat it');
  assert.ok(events.includes(`door_entered:${second}`));
});

test('standing in a gate when the room clears does nothing until the player leaves and comes back', () => {
  const sim = createRoomSim(data, 1, room);
  spawnEnemy(sim, 'enemy.dummy', { x: room.spawns.enemies[0].x, y: 0, z: room.spawns.enemies[0].z });
  stand(sim, room.spawns.doors[0]);
  const types: string[] = [];
  const step = () => sim.step([idleInput()]).forEach((e) => types.push(e.type));
  step();
  applyDevCommand(sim, { op: 'killAll' });
  for (let i = 0; i < 20; i++) step();
  assert.ok(types.includes('room_cleared') && !types.includes('door_entered'));
  stand(sim, room.spawns.player);
  step();
  stand(sim, room.spawns.doors[0]);
  step();
  assert.ok(types.includes('door_entered'));
});
