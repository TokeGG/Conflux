import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeStatic } from '../src/renderer/staticMerge.ts';
import { mergeSkinnedMeshes } from '../src/anim/mergeSkinned.ts';
import { disposeCopies } from '../src/renderer/skins.ts';

const box = () => new THREE.BoxGeometry(1, 1, 1);

test('static meshes that look the same and sit in the same patch become one mesh at the same place', () => {
  const root = new THREE.Group();
  const a = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const b = new THREE.MeshStandardMaterial({ color: 0x808080 }); // another object, the same look
  const c = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const inner = new THREE.Group();
  inner.position.set(3, 0, 0);
  root.add(inner);
  const m1 = new THREE.Mesh(box(), a);
  m1.position.set(1, 0, 1);
  const m2 = new THREE.Mesh(box(), b);
  m2.position.set(1, 0, 0);
  inner.add(m1, m2);
  const m3 = new THREE.Mesh(box(), c);
  root.add(m3);
  const far = new THREE.Mesh(box(), a);
  far.position.set(200, 0, 0); // another patch
  root.add(far);
  const r = mergeStatic(root);
  assert.equal(r.before, 4);
  assert.equal(r.after, 3);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => ((o as THREE.Mesh).isMesh ? meshes.push(o as THREE.Mesh) : 0));
  const joined = meshes.find((m) => m.geometry.getAttribute('position').count === 48)!;
  joined.geometry.computeBoundingBox();
  const bb = joined.geometry.boundingBox!;
  assert.deepEqual([bb.min.x, bb.max.x, bb.min.z, bb.max.z], [3.5, 4.5, -0.5, 1.5], 'the parent transform is baked in');
  assert.ok(!root.children.includes(inner), 'the emptied group is gone');
});

test('a merged room frees its own geometry and leaves the shared materials alone', () => {
  const root = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(box(), shared), new THREE.Mesh(box(), shared));
  mergeStatic(root);
  const merged = root.children[0] as THREE.Mesh;
  let geo = 0;
  let mat = 0;
  merged.geometry.addEventListener('dispose', () => geo++);
  shared.addEventListener('dispose', () => mat++);
  disposeCopies(root);
  assert.equal(geo, 1);
  assert.equal(mat, 0);
});

test('lights, skinned and instanced meshes are left out of the merge', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  root.add(new THREE.PointLight(), new THREE.InstancedMesh(box(), mat, 2), new THREE.Mesh(box(), mat));
  const r = mergeStatic(root);
  assert.equal(r.before, 1);
  assert.ok(root.children.some((o) => (o as THREE.Light).isLight));
  assert.ok(root.children.some((o) => (o as THREE.InstancedMesh).isInstancedMesh));
});

function skinnedPart(skeleton: THREE.Skeleton, material: THREE.Material, x: number): THREE.SkinnedMesh {
  const g = box();
  const n = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  g.translate(x, 0, 0);
  const m = new THREE.SkinnedMesh(g, material);
  m.bind(skeleton);
  return m;
}

test('skinned primitives of one material and skeleton are joined, others are not', () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  root.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  const skin = new THREE.MeshStandardMaterial();
  const cloth = new THREE.MeshStandardMaterial();
  const parts = [skinnedPart(skeleton, skin, 0), skinnedPart(skeleton, skin, 2), skinnedPart(skeleton, skin, 4), skinnedPart(skeleton, cloth, 6)];
  root.add(...parts);
  const removed = mergeSkinnedMeshes(root);
  assert.equal(removed, 2);
  const left: THREE.SkinnedMesh[] = [];
  root.traverse((o) => ((o as THREE.SkinnedMesh).isSkinnedMesh ? left.push(o as THREE.SkinnedMesh) : 0));
  assert.equal(left.length, 2);
  const joined = left.find((m) => m.material === skin)!;
  assert.equal(joined.geometry.getAttribute('position').count, 72);
  assert.equal(joined.geometry.getAttribute('skinWeight').count, 72);
  assert.equal(joined.skeleton, skeleton, 'the bones are the same');
  assert.equal(mergeSkinnedMeshes(root), 0, 'merging twice changes nothing');
});
