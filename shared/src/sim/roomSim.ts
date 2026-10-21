// A simulation set up for one room: its walls and colliders, and the player standing at its spawn.
import type { GameData } from '../types.ts';
import { buildWorld } from '../room.ts';
import { Sim } from './sim.ts';

export function createRoomSim(data: GameData, seed: number, roomId: string): Sim {
  const room = data.rooms[roomId];
  if (!room) throw new Error(`unknown room ${roomId}`);
  const sim = new Sim(data, seed, buildWorld(room));
  sim.player.pos = { x: room.spawns.player.x, y: 0, z: room.spawns.player.z };
  return sim;
}
