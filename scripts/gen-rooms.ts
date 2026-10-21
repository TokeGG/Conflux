// Builds the room templates (three forest, three dungeon) from the Kenney kits and writes them to shared/data/rooms.json with their
// colliders. The forest clearing is kept as it is. Every layout is drawn from a fixed seed, so running this again gives the same rooms.
// Usage: npx tsx scripts/gen-rooms.ts
import { Rng } from '../shared/src/rng.ts';
import { genColliders, type EnvIndex } from '../shared/src/room.ts';
import type { LightingPreset, RoomDef, RoomPiece } from '../shared/src/types.ts';
import { loadEnvIndex, readRooms, writeRooms } from './lib/roomsFile.ts';

const index = loadEnvIndex();
const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;

/** A piece whose bounding box is centred on (cx, cz), whatever the model's own origin is. */
function piece(kit: string, id: string, cx: number, cz: number, rotY = 0, scale = 1): RoomPiece {
  const item = (index as EnvIndex)[kit].items.find((i) => i.id === id);
  if (!item) throw new Error(`unknown piece ${kit}/${id}`);
  const lx = (item.min[0] + item.size[0] / 2) * scale;
  const lz = (item.min[2] + item.size[2] / 2) * scale;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { kit, id, pos: { x: r3(cx - (lx * c + lz * s)), y: 0, z: r3(cz - (-lx * s + lz * c)) }, rotY: r3(rotY), scale: r3(scale) };
}

type Spot = { x: number; z: number };
const FOREST_LIGHT: LightingPreset = { ambient: '#cfe8ff', light: '#fff1cc', intensity: 2.2, fogColor: '#6fa8d6', fogNear: 14, fogFar: 34 };
const DUNGEON_LIGHT: LightingPreset = { ambient: '#c0cbe8', light: '#ffe6bf', intensity: 1.9, fogColor: '#4a5a80', fogNear: 12, fogFar: 30 };

/** Random points inside a rectangle that keep their distance from each other and from places that must stay open. */
function scatter(rng: Rng, count: number, half: { x: number; z: number }, keepApart: number, avoid: { x: number; z: number; r: number }[], corridor?: { halfWidth: number }): Spot[] {
  const out: Spot[] = [];
  for (let tries = 0; out.length < count && tries < 4000; tries++) {
    const p = { x: (rng.next() * 2 - 1) * half.x, z: (rng.next() * 2 - 1) * half.z };
    if (corridor && Math.abs(p.x) < corridor.halfWidth) continue;
    if (avoid.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < a.r)) continue;
    if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < keepApart)) continue;
    out.push(p);
  }
  return out;
}

const SPAWN_CLEAR = 4.4;
const open = (spots: Spot[]) => spots.map((s) => ({ x: s.x, z: s.z, r: SPAWN_CLEAR }));

/** Trees all round the edge, a little irregular, so the room reads as a clearing. */
function treeRing(rng: Rng, w: number, d: number, gap: number): RoomPiece[] {
  const out: RoomPiece[] = [];
  const hx = w / 2 - 1.4;
  const hz = d / 2 - 1.4;
  const place = (x: number, z: number) => {
    const id = rng.next() < 0.55 ? 'tree-high' : 'tree';
    out.push(piece('forest', id, x + (rng.next() - 0.5) * 0.8, z + (rng.next() - 0.5) * 0.8, rng.next() * Math.PI * 2, 1.9 + rng.next() * 1.0));
  };
  for (let x = -hx; x <= hx + 1e-6; x += gap) (place(x, -hz), place(x, hz));
  for (let z = -hz + gap; z < hz - 1e-6; z += gap) (place(-hx, z), place(hx, z));
  return out;
}

function forestRoom(id: string, seed: number, size: [number, number], spawns: { player: Spot; enemies: Spot[]; door: Spot }, features: { trees: number; rocks: number; corridor: number }): RoomDef {
  const rng = new Rng(seed, id);
  const [w, d] = size;
  const keep = [spawns.player, ...spawns.enemies, spawns.door];
  const pieces = treeRing(rng, w, d, 1.7);
  const inner = { x: w / 2 - 3.6, z: d / 2 - 3.6 };
  const spots = scatter(rng, features.trees + features.rocks, inner, 2.8, open(keep), { halfWidth: features.corridor });
  spots.forEach((s, i) => {
    if (i < features.rocks) pieces.push(piece('forest', rng.next() < 0.5 ? 'rocks-low' : 'rocks-high', s.x, s.z, rng.next() * Math.PI * 2, 2.2 + rng.next() * 1.3));
    else pieces.push(piece('forest', rng.next() < 0.5 ? 'tree-high' : 'tree', s.x, s.z, rng.next() * Math.PI * 2, 1.9 + rng.next() * 0.9));
  });
  return {
    id,
    biome: 'forest',
    size,
    floor: { kit: 'forest', tile: 'patch-grass', path: 'patch-dirt', tileSize: 2 },
    pieces,
    colliders: [],
    spawns: { player: { ...spawns.player, y: 0 }, enemies: spawns.enemies.map((s) => ({ ...s, y: 0 })), doors: [{ ...spawns.door, y: 0 }] },
    lighting: FOREST_LIGHT,
  };
}

const WALL = 4;

/** A stone room: floor tiles, wall pieces round the edge with a gate in the north, and props for cover. */
function dungeonRoom(id: string, seed: number, size: [number, number], spawns: { player: Spot; enemies: Spot[]; door: Spot }, props: (rng: Rng, w: number, d: number) => RoomPiece[]): RoomDef {
  const rng = new Rng(seed, id);
  const [w, d] = size;
  const pieces: RoomPiece[] = [];
  const hw = w / 2;
  const hd = d / 2;
  const centres = Array.from({ length: w / WALL }, (_, i) => -hw + WALL / 2 + i * WALL);
  const gateX = centres.reduce((best, x) => (Math.abs(x) < Math.abs(best) ? x : best), centres[0]);
  for (const x of centres) {
    pieces.push(piece('dungeon', 'template-wall', x, -hd - 1, Math.PI, 1));
    pieces.push(x === gateX ? piece('dungeon', 'gate', x, hd + 1, 0, 1) : piece('dungeon', 'template-wall', x, hd + 1, 0, 1));
  }
  for (let j = 0; j < d / WALL; j++) {
    const z = -hd + WALL / 2 + j * WALL;
    pieces.push(piece('dungeon', 'template-wall', -hw - 1, z, Math.PI / 2, 1));
    pieces.push(piece('dungeon', 'template-wall', hw + 1, z, -Math.PI / 2, 1));
  }
  for (const [x, z] of [[-hw + 1.5, -hd + 1.5], [hw - 1.5, -hd + 1.5], [-hw + 1.5, hd - 1.5], [hw - 1.5, hd - 1.5]]) pieces.push(piece('graveyard', 'fire-basket', x, z, 0, 2.6));
  pieces.push(...props(rng, w, d));
  return {
    id,
    biome: 'dungeon',
    size,
    floor: { kit: 'dungeon', tile: 'template-floor', tileSize: WALL },
    pieces,
    colliders: [],
    spawns: { player: { ...spawns.player, y: 0 }, enemies: spawns.enemies.map((s) => ({ ...s, y: 0 })), doors: [{ x: gateX, y: 0, z: spawns.door.z }] },
    lighting: DUNGEON_LIGHT,
  };
}

const rooms = readRooms();
const clearing = rooms.forest_clearing;
const out: Record<string, RoomDef> = { forest_clearing: clearing };

out.forest_grove = forestRoom('forest_grove', 11, [30, 30], { player: { x: 0, z: -10 }, enemies: [{ x: -7, z: 1 }, { x: 7, z: 1 }, { x: 0, z: 6 }, { x: -8, z: 8 }, { x: 8, z: 8 }], door: { x: 0, z: 10.8 } }, { trees: 12, rocks: 5, corridor: 2.6 });
out.forest_trail = forestRoom('forest_trail', 23, [26, 36], { player: { x: 0, z: -15 }, enemies: [{ x: -4, z: -3 }, { x: 4, z: -3 }, { x: 0, z: 5 }, { x: -5, z: 10 }, { x: 5, z: 10 }], door: { x: 0, z: 13.6 } }, { trees: 6, rocks: 9, corridor: 3.2 });

const at = (rng: Rng, spots: Spot[], kit: string, id: string, scale: number, turn = true): RoomPiece[] => spots.map((s) => piece(kit, id, s.x, s.z, turn ? rng.next() * Math.PI * 2 : 0, scale));

out.dungeon_hall = dungeonRoom('dungeon_hall', 31, [28, 28], { player: { x: 0, z: -10 }, enemies: [{ x: -7, z: 2 }, { x: 7, z: 2 }, { x: 0, z: 7 }, { x: -8, z: 9 }, { x: 8, z: 9 }], door: { x: 0, z: 12 } }, (rng) => [
  ...at(rng, [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: -5, z: 5 }, { x: 5, z: 5 }], 'graveyard', 'column-large', 2.6, false),
  ...at(rng, [{ x: -10.5, z: -1 }, { x: 10.5, z: 0 }], 'graveyard', 'rocks', 2.4),
]);
out.dungeon_crypt = dungeonRoom('dungeon_crypt', 37, [32, 28], { player: { x: 0, z: -10 }, enemies: [{ x: -8, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 7 }, { x: -11, z: 8 }, { x: 11, z: 8 }], door: { x: 0, z: 12 } }, (rng) => [
  ...at(rng, [{ x: -4.5, z: 1 }, { x: 4.5, z: 1 }, { x: 0, z: -4.5 }], 'graveyard', 'crypt-small', 1.9, false),
  ...at(rng, [{ x: -11.5, z: -4 }, { x: 11.5, z: -4 }, { x: -3, z: 8.5 }, { x: 3, z: 8.5 }], 'graveyard', 'coffin', 2.2),
]);
out.dungeon_ruins = dungeonRoom('dungeon_ruins', 41, [28, 32], { player: { x: 0, z: -12 }, enemies: [{ x: -7, z: -2 }, { x: 7, z: -2 }, { x: 0, z: 5 }, { x: -8, z: 10 }, { x: 8, z: 10 }], door: { x: 0, z: 14 } }, (rng) => [
  ...[[-4, -6, 0], [4, -6, 0], [-9, 3, Math.PI / 2], [9, 3, Math.PI / 2], [-3, 8, 0.4], [3, 8, -0.4]].map(([x, z, r]) => piece('graveyard', 'stone-wall', x, z, r, 3.2)),
  ...at(rng, [{ x: 0, z: 1 }], 'graveyard', 'pillar-obelisk', 3, false),
]);

for (const room of Object.values(out)) room.colliders = genColliders(room.pieces, index);
for (const [name, room] of Object.entries(out)) console.log(`${name}: ${room.size.join('x')}, ${room.pieces.length} pieces, ${room.colliders.length} colliders`);
writeRooms(out);
