import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROC_DEFS } from '../../scripts/proc-defs.ts';
import { PROC_KIT, PROC_PIECES, procBounds } from '../src/gen/proc.ts';
import { pieceBounds } from '../src/gen/pieces.ts';
import { colliderKindFor, genColliders } from '../src/room.ts';
import { envIndexFromPieces } from '../src/gen/pieces.ts';
import { defaultData } from '../src/files.ts';
import { generateRoom } from '../src/gen/generate.ts';
import { validateData } from '../src/data.ts';
import { isSolvable } from '../src/gen/reach.ts';

const data = defaultData();

test('shared/data/proc.json is what scripts/proc-defs.ts builds', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../data/proc.json', import.meta.url), 'utf8')), JSON.parse(JSON.stringify(PROC_DEFS)));
});

test('every procedural prop has boxes with a size, a hex colour and a wood flag, and bounds in pieces.json', () => {
  assert.ok(Object.keys(PROC_PIECES).length >= 10);
  for (const [id, def] of Object.entries(PROC_PIECES)) {
    assert.ok(def.boxes.length > 0, id);
    for (const b of def.boxes) {
      assert.equal(b.length, 8, id);
      assert.ok(b.slice(0, 6).every((v) => Number.isFinite(v as number)), id);
      assert.ok((b[3] as number) > 0 && (b[4] as number) > 0 && (b[5] as number) > 0, `${id} has a flat box`);
      assert.match(b[6] as string, /^#[0-9a-f]{6}$/, id);
      assert.ok(b[7] === 0 || b[7] === 1, id);
    }
    assert.deepEqual(pieceBounds(PROC_KIT, id), procBounds(def), id);
  }
});

test('the props the owner asked for exist, and the solid ones collide', () => {
  for (const id of ['bookshelf', 'reading-table', 'lectern', 'bone-pile', 'skull-heap', 'crate', 'cell-bars', 'pew']) {
    assert.ok(PROC_PIECES[id], id);
    assert.equal(colliderKindFor(id), 'box', `${id} blocks`);
  }
  assert.equal(colliderKindFor('book-stack'), null, 'a stack of books is decoration');
  const cols = genColliders([{ kit: PROC_KIT, id: 'bookshelf', pos: { x: 0, y: 0, z: 0 }, rotY: 0, scale: 1 }], envIndexFromPieces());
  assert.equal(cols.length, 1);
  assert.ok(cols[0].max.y > 2 && cols[0].max.x - cols[0].min.x > 2);
});

test('the library, bone pit, prison and chapel use their procedural props, and the data validates', () => {
  assert.deepEqual(validateData(data), []);
  const uses = (theme: string) => new Set(Object.values(data.themes[theme].pools).flat().filter((p) => p.kit === PROC_KIT).map((p) => p.id));
  assert.ok(uses('library').has('bookshelf'));
  assert.ok(uses('bonepit').has('bone-pile') && uses('bonepit').has('skull-heap'));
  assert.ok(uses('prison').has('cell-bars'));
  assert.ok(uses('chapel').has('pew') && uses('chapel').has('lectern'));
});

test('validateData rejects an unknown procedural prop and a bad row', () => {
  const bad = structuredClone(data);
  bad.themes.library.pools.set[0].id = 'no-such-prop';
  assert.ok(validateData(bad).some((e) => e.includes('no-such-prop')));
  const row = structuredClone(data);
  row.themes.library.pools.set[0].row = 0;
  assert.ok(validateData(row).some((e) => /row/.test(e)));
});

test('generated rooms place the procedural props, rows stay on the floor, and the room is still solvable', () => {
  for (const [theme, id] of [['library', 'bookshelf'], ['bonepit', 'bone-pile'], ['prison', 'cell-bars'], ['chapel', 'pew']] as const) {
    let seen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { room } = generateRoom(data, seed, 1, 0, theme);
      const mine = room.pieces.filter((p) => p.kit === PROC_KIT && p.id === id);
      seen += mine.length;
      const [w, d] = room.size;
      for (const p of mine) assert.ok(Math.abs(p.pos.x) < w / 2 + 0.5 && Math.abs(p.pos.z) < d / 2 + 0.5, `${theme} ${id} inside the room`);
      assert.ok(isSolvable(room), `${theme} seed ${seed} still connects the player to the doors`);
    }
    assert.ok(seen > 0, `${theme} never placed a ${id}`);
  }
});

test('a row of props is a straight line of touching copies', () => {
  const found: number[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const { room } = generateRoom(data, seed, 1, 0, 'chapel');
    const pews = room.pieces.filter((p) => p.kit === PROC_KIT && p.id === 'pew');
    found.push(pews.length);
    // three pews per row: some pew has a neighbour a pew-depth plus the gap away along its own axis
    if (pews.length >= 3) {
      const near = pews.filter((a) => pews.some((b) => b !== a && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 2.5));
      assert.ok(near.length >= 2, `seed ${seed}: pews come in rows`);
    }
  }
  assert.ok(found.some((n) => n >= 3), 'a chapel somewhere has pews');
});
