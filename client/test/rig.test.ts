import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterRig } from '../src/anim/rig.ts';
import type { DecodedClip } from '../src/anim/clips.ts';

const BONES = ['Hips', 'UpperLegL', 'Abdomen', 'Torso', 'Neck', 'Head', 'UpperArmL'];

/** A tiny skeleton: Hips > (UpperLegL, Abdomen > Torso > Neck > Head, UpperArmL under Torso), all at rest. */
function skeleton() {
  const root = new THREE.Group();
  const by: Record<string, THREE.Bone> = {};
  for (const n of BONES) {
    by[n] = new THREE.Bone();
    by[n].name = n;
  }
  root.add(by.Hips);
  by.Hips.add(by.UpperLegL, by.Abdomen);
  by.Abdomen.add(by.Torso);
  by.Torso.add(by.Neck, by.UpperArmL);
  by.Neck.add(by.Head);
  for (const n of ['Abdomen', 'Torso', 'Neck']) by[n].position.y = 0.3;
  return { root, by };
}

function clip(name: string, frames = 2, loop = true, qFor: (bone: string) => number[] = () => [0, 0, 0, 1]): DecodedClip {
  const q = new Float32Array(frames * BONES.length * 4);
  for (let f = 0; f < frames; f++) BONES.forEach((b, i) => q.set(qFor(b), (f * BONES.length + i) * 4));
  return { name, fps: 30, frames, loop, duration: (frames - 1) / 30, rootSpeed: 0, bones: BONES, q, hips: new Float32Array(frames * 3) };
}

function rigWith(...clips: DecodedClip[]) {
  const { root, by } = skeleton();
  const rig = new CharacterRig(root, BONES);
  for (const c of clips) rig.addClip(c);
  return { root, by, rig };
}

const forward = (n: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion()));

test('aim pitch tilts the head up by the pitch, shared over spine, chest and neck', () => {
  const { root, by, rig } = rigWith(clip('loco_standing_idle'));
  rig.play('idle', null, 0, 0.5);
  rig.update(1 / 60);
  root.updateMatrixWorld(true);
  const f = forward(by.Head);
  assert.ok(Math.abs(f.y - Math.sin(0.5)) < 1e-3, `head forward y ${f.y}`);
  assert.ok(f.z > 0.85);
  const legs = forward(by.UpperLegL);
  assert.ok(Math.abs(legs.y) < 1e-6, 'the legs are not tilted');
});

test('aim pitch is clamped to 35 degrees up or down', () => {
  const { root, by, rig } = rigWith(clip('loco_standing_idle'));
  rig.play('idle', null, 0, 2);
  rig.update(1 / 60);
  root.updateMatrixWorld(true);
  assert.ok(Math.abs(Math.asin(forward(by.Head).y) - (35 * Math.PI) / 180) < 1e-3);
  rig.play('idle', null, 0, -2);
  rig.update(1 / 60);
  root.updateMatrixWorld(true);
  assert.ok(Math.abs(Math.asin(forward(by.Head).y) + (35 * Math.PI) / 180) < 1e-3);
});

test('aim pitch follows the character when it is turned', () => {
  const { root, by, rig } = rigWith(clip('loco_standing_idle'));
  root.rotation.y = Math.PI / 2;
  rig.play('idle', null, 0, 0.4);
  rig.update(1 / 60);
  root.updateMatrixWorld(true);
  const f = forward(by.Head);
  assert.ok(Math.abs(f.y - Math.sin(0.4)) < 1e-3, `y ${f.y}`);
  assert.ok(f.x > 0.85, 'still facing +x');
});

test('with the cast at full weight the upper bones take the cast pose and the legs keep the locomotion pose', () => {
  const turn = (a: number) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  const loco = clip('loco_standing_idle', 2, true, (b) => (b === 'UpperLegL' ? turn(0.4) : [0, 0, 0, 1]));
  const cast = clip('cast_test', 2, false, (b) => (b === 'UpperLegL' || b === 'UpperArmL' || b === 'Torso' ? turn(1.0) : [0, 0, 0, 1]));
  const { by, rig } = rigWith(loco, cast);
  rig.play('idle', 'cast_test', 1, 0);
  rig.update(1 / 60);
  const angle = (b: THREE.Bone) => 2 * Math.atan2(Math.abs(b.quaternion.y), b.quaternion.w);
  assert.ok(Math.abs(angle(by.UpperLegL) - 0.4) < 1e-3, 'the leg stayed with the locomotion clip');
  assert.ok(Math.abs(angle(by.UpperArmL) - 1.0) < 1e-3, 'the arm took the cast clip');
  assert.ok(Math.abs(angle(by.Torso) - 1.0) < 1e-3, 'the chest took the cast clip');
});

test('a changed locomotion state crossfades instead of snapping', () => {
  const turn = (a: number) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  const idle = clip('loco_standing_idle', 2, true, (b) => (b === 'UpperLegL' ? turn(0) : [0, 0, 0, 1]));
  const run = clip('loco_standing_run_forward', 2, true, (b) => (b === 'UpperLegL' ? turn(1) : [0, 0, 0, 1]));
  const { by, rig } = rigWith(idle, run);
  rig.play('idle', null, 0, 0);
  rig.update(1 / 60);
  rig.play('run_forward', null, 0, 0);
  rig.update(1 / 60);
  const mid = 2 * Math.atan2(Math.abs(by.UpperLegL.quaternion.y), by.UpperLegL.quaternion.w);
  assert.ok(mid > 0.02 && mid < 0.9, `blending (${mid})`);
  for (let i = 0; i < 20; i++) rig.update(1 / 60);
  const done = 2 * Math.atan2(Math.abs(by.UpperLegL.quaternion.y), by.UpperLegL.quaternion.w);
  assert.ok(Math.abs(done - 1) < 1e-3, `settled (${done})`);
});

test('a clip that is not loaded is skipped without throwing', () => {
  const { rig } = rigWith(clip('loco_standing_idle'));
  rig.play('run_forward', 'cast_missing', 1, 0);
  assert.doesNotThrow(() => rig.update(1 / 60));
});

test('showClip plays any named clip, and a scrub time pins the pose to that moment', () => {
  const turn = (a: number) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  const frames = 5;
  const q = new Float32Array(frames * BONES.length * 4);
  for (let f = 0; f < frames; f++) BONES.forEach((b, i) => q.set(b === 'UpperLegL' ? turn(f * 0.2) : [0, 0, 0, 1], (f * BONES.length + i) * 4));
  const sweep: DecodedClip = { name: 'sweep', fps: 30, frames, loop: false, duration: (frames - 1) / 30, rootSpeed: 0, bones: BONES, q, hips: new Float32Array(frames * 3) };
  const { by, rig } = rigWith(clip('loco_standing_idle'), sweep);
  rig.showClip('sweep', 2 / 30);
  rig.update(1 / 60);
  rig.update(1 / 60);
  const angle = 2 * Math.atan2(Math.abs(by.UpperLegL.quaternion.y), by.UpperLegL.quaternion.w);
  assert.ok(Math.abs(angle - 0.4) < 1e-3, `pinned at frame 2 (${angle})`);
  rig.showClip(null, null);
  rig.play('idle', null, 0, 0);
  for (let i = 0; i < 20; i++) rig.update(1 / 60);
  assert.ok(2 * Math.atan2(Math.abs(by.UpperLegL.quaternion.y), by.UpperLegL.quaternion.w) < 1e-3, 'back to the locomotion state');
});
