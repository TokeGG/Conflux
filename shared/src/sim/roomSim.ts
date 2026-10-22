// A simulation set up for one room: its walls and colliders, and the player standing at its spawn.
import type { GameData, RoomDef } from '../types.ts';
import { buildWorld } from '../room.ts';
import { Sim } from './sim.ts';

/** A room by id from the data, or a room definition itself (a generated room is not in the data). */
export function createRoomSim(data: GameData, seed: number, roomOrId: string | RoomDef): Sim {
  const room = typeof roomOrId === 'string' ? data.rooms[roomOrId] : roomOrId;
  if (!room) throw new Error(`unknown room ${String(roomOrId)}`);
  const sim = new Sim(data, seed, buildWorld(room));
  sim.doors = room.spawns.doors.map((d) => ({ x: d.x, y: 0, z: d.z }));
  sim.player.pos = { x: room.spawns.player.x, y: 0, z: room.spawns.player.z };
  return sim;
}
