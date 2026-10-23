import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROC_PIECES, procBounds } from '../src/gen/proc.ts';
import { defaultData } from '../src/files.ts';
import { generateRoom } from '../src/gen/generate.ts';

const data = defaultData();

/** Height range (metres) a prop of each kind must have, so a bookshelf stands over the 1.8 m player and a pew reaches a seated height. */
const HEIGHT: Record<string, [number, number]> = {
  bookshelf: [2.0, 2.6],
  'bookshelf-low': [0.9, 1.6],
  'reading-table': [0.65, 1.2],
  lectern: [0.9, 1.5],
  pew: [0.8, 1.0],
  cot: [0.4, 0.9],
  crate: [0.6, 1.2],
  'cell-bars': [2.0, 3.2],
  'book-stack': [0.1, 0.6],
};

test('every procedural prop rests on the floor and has a sane size', () => {
  for (const [id, def] of Object.entries(PROC_PIECES)) {
    const b = procBounds(def);
    assert.ok(Math.abs(b.min[1]) < 0.02, `${id} floats or sinks (lowest point ${b.min[1]})`);
    for (const s of b.size) assert.ok(s > 0.1 && s < 5, `${id} has a side of ${s} m`);
    const h = HEIGHT[id];
    if (h) assert.ok(b.size[1] >= h[0] && b.size[1] <= h[1], `${id} is ${b.size[1]} m high, expected ${h[0]} to ${h[1]}`);
  }
});

test('procedural boxes of one prop never share a whole face (z-fighting)', () => {
  for (const [id, def] of Object.entries(PROC_PIECES)) {
    const seen = new Set<string>();
    for (const b of def.boxes) {
      const key = b.slice(0, 6).join(',');
      assert.ok(!seen.has(key), `${id} has a duplicated box ${key}`);
      seen.add(key);
    }
  }
});

test('no piece stands on the player\'s start, and procedural props keep their scale in rooms', () => {
  for (const theme of Object.keys(data.themes)) {
    for (let seed = 1; seed <= 6; seed++) {
      const { room } = generateRoom(data, seed, 1, 0, theme);
      const s = room.spawns.player;
      for (const c of room.colliders) {
        const inside = s.x > c.min.x - 0.5 && s.x < c.max.x + 0.5 && s.z > c.min.z - 0.5 && s.z < c.max.z + 0.5 && c.max.y > 0.4;
        assert.ok(!inside, `${theme} seed ${seed}: a collider overlaps the player start`);
      }
      for (const p of room.pieces) if (p.kit === 'proc') assert.ok(p.scale >= 0.4 && p.scale <= 2, `${theme}: ${p.id} is scaled ${p.scale}`);
    }
  }
});

test('procedural props keep their height once a theme scales them', () => {
  for (const [name, theme] of Object.entries(data.themes)) {
    for (const p of Object.values(theme.pools).flat()) {
      const h = HEIGHT[p.id];
      if (p.kit !== 'proc' || !h) continue;
      const height = procBounds(PROC_PIECES[p.id]).size[1] * (p.scale ?? 1);
      assert.ok(height >= h[0] * 0.95 && height <= h[1] * 1.1, `${name}: ${p.id} stands ${height.toFixed(2)} m high`);
    }
  }
});

test('every theme is lit well enough to see enemies across the room and the gate signs', () => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  for (const [name, t] of Object.entries(data.themes)) {
    const l = t.lighting;
    assert.ok(l.fogNear >= 8 && l.fogFar >= 30, `${name}: fog ${l.fogNear}-${l.fogFar} hides enemies at mid range`);
    assert.ok(lum(l.ambient) >= 0.15, `${name}: ambient ${l.ambient} is too dark (${lum(l.ambient).toFixed(2)})`);
    assert.ok(lum(l.ambient) <= 0.5, `${name}: ambient ${l.ambient} is too bright for a gloomy dungeon`);
  }
});

test('a themed room almost always shows its signature props', () => {
  const sig: Record<string, string> = { library: 'bookshelf', chapel: 'pew', bonepit: 'skull-heap', prison: 'cell-bars' };
  for (const [theme, id] of Object.entries(sig)) {
    let have = 0;
    const seeds = 20;
    for (let seed = 1; seed <= seeds; seed++) {
      const { room } = generateRoom(data, seed, 1, 0, theme);
      if (room.pieces.some((p) => p.kit === 'proc' && p.id === id)) have++;
    }
    assert.ok(have >= seeds * 0.9, `${theme}: only ${have} of ${seeds} rooms have a ${id}`);
  }
});
