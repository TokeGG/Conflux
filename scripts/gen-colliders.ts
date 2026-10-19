// Recomputes every room's colliders from its pieces and the env index, and writes shared/data/rooms.json back.
// Usage: npx tsx scripts/gen-colliders.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { genColliders, type EnvIndex } from '../shared/src/room.ts';
import type { RoomDef } from '../shared/src/types.ts';

const root = new URL('../', import.meta.url);
const roomsFile = fileURLToPath(new URL('shared/data/rooms.json', root));
const index: EnvIndex = JSON.parse(readFileSync(new URL('client/public/assets/env/index.json', root), 'utf8'));
const rooms: Record<string, RoomDef> = JSON.parse(readFileSync(roomsFile, 'utf8'));

for (const [name, room] of Object.entries(rooms)) {
  room.colliders = genColliders(room.pieces, index);
  console.log(`${name}: ${room.pieces.length} pieces, ${room.colliders.length} colliders`);
}

/** One array element per line for the long lists, so diffs stay readable. */
const list = (a: unknown[], indent: string) => (a.length ? `[\n${a.map((x) => `${indent}  ${JSON.stringify(x)}`).join(',\n')}\n${indent}]` : '[]');
const text = Object.entries(rooms)
  .map(([name, r]) => {
    const { pieces, colliders, ...rest } = r;
    const head = JSON.stringify(rest, null, 2).slice(2, -2).replace(/\n/g, '\n  ').replace(/^/, '  ');
    return `  ${JSON.stringify(name)}: {\n  ${head.trimStart()},\n    "pieces": ${list(pieces, '    ')},\n    "colliders": ${list(colliders, '    ')}\n  }`;
  })
  .join(',\n');
writeFileSync(roomsFile, `{\n${text}\n}\n`);
