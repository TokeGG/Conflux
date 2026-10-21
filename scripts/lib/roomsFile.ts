// Reading and writing shared/data/rooms.json in the layout the project keeps it in (long lists one element per line).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvIndex } from '../../shared/src/room.ts';
import type { RoomDef } from '../../shared/src/types.ts';

const root = new URL('../../', import.meta.url);
export const roomsFile = fileURLToPath(new URL('shared/data/rooms.json', root));
export const loadEnvIndex = (): EnvIndex => JSON.parse(readFileSync(new URL('client/public/assets/env/index.json', root), 'utf8'));
export const readRooms = (): Record<string, RoomDef> => JSON.parse(readFileSync(roomsFile, 'utf8'));

const list = (a: unknown[], indent: string) => (a.length ? `[\n${a.map((x) => `${indent}  ${JSON.stringify(x)}`).join(',\n')}\n${indent}]` : '[]');

export function writeRooms(rooms: Record<string, RoomDef>): void {
  const text = Object.entries(rooms)
    .map(([name, r]) => {
      const { pieces, colliders, ...rest } = r;
      const head = JSON.stringify(rest, null, 2).slice(2, -2).replace(/\n/g, '\n  ').replace(/^/, '  ');
      return `  ${JSON.stringify(name)}: {\n  ${head.trimStart()},\n    "pieces": ${list(pieces, '    ')},\n    "colliders": ${list(colliders, '    ')}\n  }`;
    })
    .join(',\n');
  writeFileSync(roomsFile, `{\n${text}\n}\n`);
}
