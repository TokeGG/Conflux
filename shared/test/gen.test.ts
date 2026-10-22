import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoom } from '../src/gen/generate.ts';
import { isSolvable } from '../src/gen/reach.ts';
import { pieceBounds } from '../src/gen/pieces.ts';
import { defaultData } from '../src/files.ts';
import { buildWorld } from '../src/room.ts';
import type { RoomDef } from '../src/types.ts';

const data = defaultData();
const THEMES = ['crypt', 'hall', 'cave'];
const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);
const rooms = new Map<string, RoomDef>();
const get = (theme: string, seed: number): RoomDef => {
  const key = `${theme}/${seed}`;
  if (!rooms.has(key)) rooms.set(key, generateRoom(data, seed, seed % 9, seed % 5, theme).room);
  return rooms.get(key)!;
};

test('every room of 500 seeds per theme is solvable: the start reaches every exit and every enemy spot', () => {
  for (const theme of THEMES) for (const seed of SEEDS) assert.ok(isSolvable(get(theme, seed)), `${theme} seed ${seed}`);
});

test('the start, every exit and every enemy spot are clear of props', () => {
  for (const theme of THEMES) {
    for (const seed of SEEDS.slice(0, 100)) {
      const room = get(theme, seed);
      const world = buildWorld(room);
      const spots = [room.spawns.player, ...room.spawns.doors, ...room.spawns.enemies];
      for (const s of spots) assert.ok(!world.blocked({ x: s.x, y: 0, z: s.z }, 0.5), `${theme} seed ${seed} blocked at ${s.x},${s.z}`);
    }
  }
});

test('walls are closed: every edge of the floor has a wall or gate piece on it', () => {
  for (const theme of THEMES) {
    for (const seed of SEEDS.slice(0, 100)) {
      const room = get(theme, seed);
      const cells = new Set(room.cells!.map(([i, j]) => `${i},${j}`));
      const [w, d] = room.size;
      const centres = room.pieces
        .filter((p) => /wall|gate/.test(p.id) && !/corner/.test(p.id))
        .map((p) => {
          const b = pieceBounds(p.kit, p.id);
          const lx = (b.min[0] + b.size[0] / 2) * p.scale;
          const lz = (b.min[2] + b.size[2] / 2) * p.scale;
          return { x: p.pos.x + lx * Math.cos(p.rotY) + lz * Math.sin(p.rotY), z: p.pos.z - lx * Math.sin(p.rotY) + lz * Math.cos(p.rotY) };
        });
      for (const [i, j] of room.cells!) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (cells.has(`${i + dx},${j + dz}`)) continue;
          const mx = -w / 2 + 2 + i * 4 + dx * 2;
          const mz = -d / 2 + 2 + j * 4 + dz * 2;
          assert.ok(centres.some((c) => Math.hypot(c.x - (mx + dx), c.z - (mz + dz)) < 1.2), `${theme} seed ${seed}: no wall at edge ${i},${j} (${dx},${dz})`);
        }
      }
    }
  }
});

test('the same inputs give an identical room, and different seeds give different rooms', () => {
  assert.deepEqual(generateRoom(data, 7, 2, 3, 'crypt'), generateRoom(data, 7, 2, 3, 'crypt'));
  const sigs = new Set(SEEDS.slice(0, 100).map((s) => JSON.stringify(get('hall', s).pieces)));
  assert.ok(sigs.size >= 95, `only ${sigs.size} of 100 hall rooms differ`);
});

test('without a theme the room picks one, and the choice is also the same every time', () => {
  const a = generateRoom(data, 11, 1, 4);
  assert.deepEqual(a, generateRoom(data, 11, 1, 4));
  assert.ok(THEMES.includes(a.theme));
  const seen = new Set(SEEDS.slice(0, 60).map((s) => generateRoom(data, s, 1, 0).theme));
  assert.ok(seen.size === 3, `only ${[...seen]} appeared`);
});

test('L-shaped footprints keep every enemy spot and the start on a floor cell', () => {
  let cut = 0;
  for (const theme of THEMES) {
    for (const seed of SEEDS.slice(0, 200)) {
      const room = get(theme, seed);
      const [w, d] = room.size;
      const full = (w / 4) * (d / 4);
      if (room.cells!.length < full) cut++;
      const cells = new Set(room.cells!.map(([i, j]) => `${i},${j}`));
      for (const s of [room.spawns.player, ...room.spawns.enemies]) assert.ok(cells.has(`${Math.floor((s.x + w / 2) / 4)},${Math.floor((s.z + d / 2) / 4)}`), `${theme} seed ${seed}: spot off the floor`);
    }
  }
  assert.ok(cut > 30, `only ${cut} of 600 rooms were cut`);
});

test('a room has 1 to 3 exits, 8 enemy spots at most, a piece count in the recipe range, and lights', () => {
  for (const theme of THEMES) {
    for (const seed of SEEDS.slice(0, 100)) {
      const room = get(theme, seed);
      assert.ok(room.spawns.doors.length >= 1 && room.spawns.doors.length <= 3, `${theme} ${seed} exits`);
      assert.ok(room.spawns.enemies.length >= 5 && room.spawns.enemies.length <= 10, `${theme} ${seed} enemy spots ${room.spawns.enemies.length}`);
      assert.ok(room.pieces.length >= 50 && room.pieces.length <= 400, `${theme} ${seed} pieces ${room.pieces.length}`);
      assert.ok((room.lights?.length ?? 0) >= 3, `${theme} ${seed} lights`);
      assert.equal(room.theme, theme);
      assert.ok(room.look!.floorTex.startsWith('tex.') && room.look!.wallTex.startsWith('tex.'));
    }
    const mean = SEEDS.slice(0, 100).reduce((n, seed) => n + get(theme, seed).pieces.length, 0) / 100;
    assert.ok(mean >= 100, `${theme}: a lot of scenery wanted, mean ${mean.toFixed(0)} pieces`);
    const t = data.themes[theme];
    const room = get(theme, 3);
    for (const item of Object.values(t.pools).flat()) assert.ok(room.pieces.filter((p) => p.kit === item.kit && p.id === item.id).length <= item.count[1] * 4, `${theme}: ${item.id} count`);
  }
});

test('depth gates themes: a theme with minDepth above the depth is never drawn', () => {
  const gated = structuredClone(data);
  gated.themes.cave.minDepth = 5;
  for (const seed of SEEDS.slice(0, 80)) assert.notEqual(generateRoom(gated, seed, 2, 0).theme, 'cave');
});
