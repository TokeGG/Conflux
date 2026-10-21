// Recomputes every room's colliders from its pieces and the env index, and writes shared/data/rooms.json back.
// Usage: npx tsx scripts/gen-colliders.ts
import { genColliders } from '../shared/src/room.ts';
import { loadEnvIndex, readRooms, writeRooms } from './lib/roomsFile.ts';

const index = loadEnvIndex();
const rooms = readRooms();
for (const [name, room] of Object.entries(rooms)) {
  room.colliders = genColliders(room.pieces, index);
  console.log(`${name}: ${room.pieces.length} pieces, ${room.colliders.length} colliders`);
}
writeRooms(rooms);
