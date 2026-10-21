import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultData, type EnemySnap } from '@conflux/shared';
import { EnemyView } from '../src/renderer/enemyView.ts';

const data = defaultData();

function model() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), mat));
  return { root, mat };
}
const snap = (over: Partial<EnemySnap> = {}): EnemySnap => ({ id: 1, defId: 'enemy.stump', pos: { x: 2, y: 0, z: 3 }, facing: 0.5, hp: 10, maxHp: 10, statuses: [], aiState: 'idle', guardOn: false, marks: [], attack: null, ...over });
const material = (v: EnemyView) => ((v.root.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshStandardMaterial);

test('the view follows the snapshot\'s position and facing', () => {
  const { root } = model();
  const v = new EnemyView(data.enemies['enemy.stump'], root);
  v.update(snap(), 1 / 60);
  assert.deepEqual([v.root.position.x, v.root.position.y, v.root.position.z], [2, 0, 3]);
  assert.equal(v.root.rotation.y, 0.5);
});

test('a tint multiplies the colour on the enemy\'s own copy of the material, not on the shared one', () => {
  const { root, mat } = model();
  const v = new EnemyView(data.enemies['enemy.golem_fire'], root);
  assert.equal(mat.color.getHex(), 0xffffff, 'the shared material is untouched');
  assert.ok(material(v).color.r > material(v).color.b, 'tinted orange');
  assert.ok(material(v).emissive.r > 0, 'and it glows a little');
});

test('two enemies from one model do not share materials', () => {
  const { root } = model();
  const a = new EnemyView(data.enemies['enemy.stump'], root.clone(true));
  const b = new EnemyView(data.enemies['enemy.stump'], root.clone(true));
  assert.notEqual(material(a), material(b));
  a.hurt();
  a.update(snap(), 1 / 60);
  b.update(snap(), 1 / 60);
  assert.ok(material(a).emissive.r > 0.5 && material(b).emissive.r < 0.1, 'only the one that was hit flashes');
});

test('a hit flashes red and the flash ends', () => {
  const { root } = model();
  const v = new EnemyView(data.enemies['enemy.stump'], root);
  v.hurt();
  v.update(snap(), 1 / 60);
  assert.ok(material(v).emissive.r > 0.5);
  for (let i = 0; i < 20; i++) v.update(snap(), 1 / 60);
  assert.ok(material(v).emissive.r < 0.1);
});

test('dying shrinks and sinks the enemy and then reports it finished', () => {
  const { root } = model();
  const v = new EnemyView(data.enemies['enemy.stump'], root);
  v.update(snap(), 1 / 60);
  assert.equal(v.finished, false);
  v.advanceDeath(0.1);
  assert.equal(v.root.scale.x, 1, 'nothing happens before dying starts');
  v.die();
  const y0 = v.root.position.y;
  v.advanceDeath(0.2);
  assert.ok(v.root.scale.x < 1 && v.root.position.y < y0);
  v.advanceDeath(1);
  assert.equal(v.finished, true);
  assert.ok(v.root.scale.x < 0.01);
});

test('a procedural enemy moves its body each frame and a lunge pushes it forward while it attacks', () => {
  const { root } = model();
  const v = new EnemyView(data.enemies['enemy.stump'], root);
  const body = v.root.children[0];
  const ys = new Set<number>();
  for (let i = 0; i < 40; i++) {
    v.update(snap(), 1 / 30);
    ys.add(Math.round(body.position.y * 1e4));
  }
  assert.ok(ys.size > 5, 'it hops');
  const w = new EnemyView(data.enemies['enemy.stump'], model().root);
  w.update(snap({ attack: 'atk.stump_bite' }), 0.3);
  w.update(snap({ attack: 'atk.stump_bite' }), 0.3);
  assert.ok(w.root.children[0].position.z > 0.01, 'it lunges');
});

test('own clips are used for a golem when the model has them, and a model without them does not break', () => {
  const clip = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[y]', [0, 1], [0, 0.1])]);
  const { root } = model();
  const v = new EnemyView(data.enemies['enemy.golem_fire'], root, ['Idle', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Defence1'].map(clip));
  assert.doesNotThrow(() => {
    v.update(snap({ defId: 'enemy.golem_fire' }), 1 / 60);
    v.update(snap({ defId: 'enemy.golem_fire', guardOn: true }), 1 / 60);
    v.update(snap({ defId: 'enemy.golem_fire', attack: 'atk.golem_slam' }), 1 / 60);
  });
  const bare = new EnemyView(data.enemies['enemy.golem_fire'], model().root, []);
  assert.doesNotThrow(() => bare.update(snap({ defId: 'enemy.golem_fire' }), 1 / 60));
});
