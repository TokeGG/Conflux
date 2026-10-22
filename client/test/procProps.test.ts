import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PROC_KIT, PROC_PIECES, type RoomPiece } from '@conflux/shared';
import { buildProcGroup, disposeProc, pieceMatrix, procGeometries } from '../src/renderer/procProps.ts';
import { disposeCopies } from '../src/renderer/skins.ts';

test('every box face is wound to face outward and its normal agrees', () => {
  for (const [id, def] of Object.entries(PROC_PIECES)) {
    const g = procGeometries(def);
    for (const geo of [g.wood, g.plain]) {
      if (!geo) continue;
      const pos = geo.getAttribute('position');
      const nor = geo.getAttribute('normal');
      const idx = geo.getIndex()!;
      for (let t = 0; t < idx.count; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + k)));
        const face = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
        const n = new THREE.Vector3().fromBufferAttribute(nor, idx.getX(t));
        assert.ok(face.dot(n) > 0.99, `${id}: a face points inward`);
      }
    }
  }
});

test('a prop merges into one wood and one plain geometry whose bounds match its boxes', () => {
  const def = PROC_PIECES.bookshelf;
  const g = procGeometries(def);
  assert.ok(g.wood && g.plain, 'a bookshelf has wood and coloured books');
  assert.equal(g.wood!.getAttribute('position').count + g.plain!.getAttribute('position').count, def.boxes.length * 24);
  const box = new THREE.Box3().union(g.wood!.boundingBox!).union(g.plain!.boundingBox!);
  assert.ok(Math.abs(box.max.x - 2.44) < 1e-3 && box.max.y > 2.5);
  for (const v of g.plain!.getAttribute('position').array) assert.ok(Number.isFinite(v));
});

test('placements become instances at the piece transform, and other kits are ignored', () => {
  const at = (x: number, rotY: number): RoomPiece => ({ kit: PROC_KIT, id: 'crate', pos: { x, y: 0, z: 3 }, rotY, scale: 2 });
  const group = buildProcGroup([at(1, 0), at(5, Math.PI / 2), { kit: 'graveyard', id: 'coffin', pos: { x: 0, y: 0, z: 0 }, rotY: 0, scale: 1 }], null, new THREE.Color('#808080'));
  const meshes = group.children as THREE.InstancedMesh[];
  assert.ok(meshes.length >= 1);
  for (const m of meshes) assert.equal(m.count, 2);
  const m = new THREE.Matrix4();
  meshes[0].getMatrixAt(1, m);
  assert.ok(m.equals(pieceMatrix(at(5, Math.PI / 2))));
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(m).toArray(), [5, 0, 3]);
  assert.equal(buildProcGroup([], null, null).children.length, 0);
});

test('disposing a room frees the geometries, instance buffers and materials the props made, not the shared texture', () => {
  const tex = new THREE.Texture();
  let texDisposed = 0;
  tex.addEventListener('dispose', () => texDisposed++);
  const group = buildProcGroup([{ kit: PROC_KIT, id: 'lectern', pos: { x: 0, y: 0, z: 0 }, rotY: 0, scale: 1 }], tex, null);
  let geo = 0;
  let mat = 0;
  for (const m of group.children as THREE.InstancedMesh[]) {
    m.geometry.addEventListener('dispose', () => geo++);
    (m.material as THREE.Material).addEventListener('dispose', () => mat++);
  }
  const root = new THREE.Group();
  root.add(group);
  disposeCopies(root);
  assert.ok(geo >= 1 && mat >= 1);
  assert.equal(texDisposed, 0);
  disposeProc(root); // freeing twice is harmless
});
