import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeCopies, skinFor, tintMaterials } from '../src/renderer/skins.ts';

test('skinFor resolves the room look to texture ids and a tint colour', () => {
  const s = skinFor({ floorTex: 'tex.sbs256.stone.stone_03_256x256', wallTex: 'tex.sbs256.brick.brick_05_256x256', tint: '#8e9bb8' })!;
  assert.equal(s.floorTex, 'tex.sbs256.stone.stone_03_256x256');
  assert.equal(s.wallTex, 'tex.sbs256.brick.brick_05_256x256');
  assert.equal(s.tint.getHexString(), '8e9bb8');
  assert.equal(skinFor(undefined), null);
});

test('tintMaterials works on copies: the shared material is left as it was', () => {
  const shared = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
  tintMaterials(root, new THREE.Color('#808080'), new Map());
  const m = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  assert.notEqual(m, shared);
  assert.equal(shared.color.getHexString(), 'ffffff');
  assert.ok(m.color.r < 1);
});

test('the copies a room made are disposed when it is left, and the shared materials are not', () => {
  const shared = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
  tintMaterials(root, new THREE.Color('#808080'), new Map());
  let copyDisposed = 0;
  let sharedDisposed = 0;
  ((root.children[0] as THREE.Mesh).material as THREE.Material).addEventListener('dispose', () => copyDisposed++);
  shared.addEventListener('dispose', () => sharedDisposed++);
  disposeCopies(root);
  assert.equal(copyDisposed, 1);
  assert.equal(sharedDisposed, 0);
});
