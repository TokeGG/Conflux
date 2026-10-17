import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, genColliders, colliderKindFor, pieceAssetId, type EnvIndex } from '../src/room.ts';
import { defaultData } from '../src/files.ts';
import { aimDir, v3, type Vec3 } from '../src/math.ts';
import type { RoomPiece } from '../src/types.ts';

const envIndex: EnvIndex = JSON.parse(readFileSync(new URL('../../client/public/assets/env/index.json', import.meta.url), 'utf8'));
const room = defaultData().rooms.forest_clearing;
const world = buildWorld(room);

test('no spawn point (player, enemies, doors) is blocked for a body of radius 0.5', () => {
  const all: Vec3[] = [room.spawns.player, ...room.spawns.enemies, ...room.spawns.doors];
  assert.ok(room.spawns.enemies.length >= 3);
  for (const p of all) assert.equal(world.blocked(p, 0.5), false, `blocked at ${JSON.stringify(p)}`);
});

test('every spawn point is inside the room', () => {
  const [w, d] = room.size;
  for (const p of [room.spawns.player, ...room.spawns.enemies, ...room.spawns.doors]) assert.ok(Math.abs(p.x) < w / 2 && Math.abs(p.z) < d / 2, JSON.stringify(p));
});

test('a ray from the player spawn toward the nearest collider returns that collider', () => {
  const o = { ...room.spawns.player, y: 1 };
  const centre = (c: { min: Vec3; max: Vec3 }) => ({ x: (c.min.x + c.max.x) / 2, y: 1, z: (c.min.z + c.max.z) / 2 });
  const nearest = [...room.colliders].sort((a, b) => v3.len(v3.sub(centre(a), o)) - v3.len(v3.sub(centre(b), o)))[0];
  const target = centre(nearest);
  const hit = world.raycast(o, v3.norm(v3.sub(target, o)), 100)!;
  assert.equal(hit.collider, nearest);
});

test('the room is closed: walking off in any direction hits a boundary wall', () => {
  const o = { ...room.spawns.player, y: 1 };
  const [w, d] = room.size;
  for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const hit = world.raycast(o, aimDir(yaw, 0), 200);
    assert.ok(hit && hit.collider, `no wall at yaw ${yaw}`);
    assert.ok(Math.abs(hit.point.x) <= w / 2 + 1 && Math.abs(hit.point.z) <= d / 2 + 1);
  }
});

test('genColliders: one collider per solid piece, none for decor, none with zero volume', () => {
  const solid = room.pieces.filter((p) => colliderKindFor(p.id) !== null);
  const cols = genColliders(room.pieces, envIndex);
  assert.equal(cols.length, solid.length);
  for (const c of cols) assert.ok(c.max.x > c.min.x && c.max.y > c.min.y && c.max.z > c.min.z, JSON.stringify(c));
});

test('the colliders stored in rooms.json are up to date with the pieces', () => {
  assert.deepEqual(genColliders(room.pieces, envIndex), room.colliders);
});

test('every piece names a real kit piece and has a positive scale', () => {
  for (const p of room.pieces) {
    assert.ok(envIndex[p.kit]?.items.some((i) => i.id === p.id), `${p.kit}/${p.id} is not in the env index`);
    assert.ok(p.scale > 0);
  }
});

test('pieceAssetId follows the manifest naming', () => {
  assert.equal(pieceAssetId({ kit: 'forest', id: 'tree-high' }), 'env.forest.tree_high');
});

test('a tree gets a trunk-sized cylinder, a rock a box, a grass patch nothing', () => {
  assert.equal(colliderKindFor('tree-high'), 'cyl');
  assert.equal(colliderKindFor('rocks-low'), 'box');
  assert.equal(colliderKindFor('patch-grass'), null);
  const tree: RoomPiece = { kit: 'forest', id: 'tree-high', pos: { x: 10, y: 0, z: 10 }, rotY: 0, scale: 2 };
  const [c] = genColliders([tree], envIndex);
  const width = c.max.x - c.min.x;
  assert.ok(width < 0.927 * 2 * 0.5, `trunk collider ${width} should be much narrower than the canopy`);
  assert.equal(c.kind, 'cyl');
  assert.ok(Math.abs(c.max.y - 2.284 * 2) < 1e-6 && c.min.y === 0);
});

test('a rotated piece swaps its footprint', () => {
  const index: EnvIndex = { k: { title: 't', license: 'x', items: [{ id: 'fence', size: [2, 1, 1], min: [-1, 0, -0.5], tris: 1 }] } };
  const flat: RoomPiece = { kit: 'k', id: 'fence', pos: { x: 0, y: 0, z: 0 }, rotY: 0, scale: 1 };
  const [a] = genColliders([flat], index);
  assert.deepEqual([a.max.x - a.min.x, a.max.z - a.min.z], [2, 1]);
  const [b] = genColliders([{ ...flat, rotY: Math.PI / 2 }], index);
  assert.ok(Math.abs(b.max.x - b.min.x - 1) < 1e-9 && Math.abs(b.max.z - b.min.z - 2) < 1e-9);
});

test('a piece whose origin is its centre (rocks-high) sits on the ground when placed at y = half its height', () => {
  const p: RoomPiece = { kit: 'forest', id: 'rocks-high', pos: { x: 0, y: 1, z: 0 }, rotY: 0, scale: 2 };
  const [c] = genColliders([p], envIndex);
  assert.ok(Math.abs(c.min.y - 0) < 1e-9 && Math.abs(c.max.y - 2) < 1e-9, JSON.stringify(c));
});

test('the floor description names pieces that exist', () => {
  const f = room.floor;
  for (const id of [f.tile, f.path].filter(Boolean) as string[]) assert.ok(envIndex[f.kit].items.some((i) => i.id === id), id);
  assert.ok(f.tileSize > 0);
});
