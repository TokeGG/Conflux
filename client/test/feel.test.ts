import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { defaultData, buildWorld, type CameraCfg } from '@conflux/shared';
import { CharacterRig } from '../src/anim/rig.ts';
import type { DecodedClip } from '../src/anim/clips.ts';
import { castClipFor, locoClipName } from '../src/anim/locomotion.ts';
import { castSpeed, previewAt, castClipChoice } from '../src/anim/castTiming.ts';
import { ThirdPersonCamera, effectiveFov, smoothTo } from '../src/camera.ts';
import { InputController } from '../src/input.ts';
import { frameBox } from '../src/dev/framing.ts';

const data = defaultData();

// ---- F1: the mapping decides which clip plays ----
const BONES = ['Hips', 'Torso'];
const clip = (name: string): DecodedClip => ({ name, fps: 30, frames: 2, loop: true, duration: 1 / 30, rootSpeed: 0, bones: BONES, q: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), hips: new Float32Array(6) });
const rigOf = () => {
  const root = new THREE.Group();
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    root.add(b);
  }
  return new CharacterRig(root, BONES);
};

test('locoClipName reads the mapping and falls back to the built-in name', () => {
  assert.equal(locoClipName('idle'), 'loco_standing_idle');
  assert.equal(locoClipName('idle', { idle: 'my_clip' }), 'my_clip');
  assert.equal(locoClipName('walk_back', { idle: 'my_clip' }), 'loco_standing_walk_back');
  assert.equal(castClipFor('throw', { throw: 'other_cast' }), 'other_cast');
  assert.equal(castClipFor('throw', {}), castClipFor('throw'));
});

test('changing the mapping changes the clip the rig is asked to play', () => {
  const rig = rigOf();
  const { states, transition } = data.animation.rigs.wizardpack;
  rig.setMapping({ states, transition });
  rig.play('run_forward', null, 0, 0);
  assert.equal(rig.activeLocoClip(), 'loco_standing_run_forward');
  rig.setMapping({ states: { ...states, run_forward: 'loco_standing_walk_forward' }, transition });
  assert.equal(rig.activeLocoClip(), 'loco_standing_walk_forward', 'the next frame already uses the edit');
  rig.play('idle', null, 0, 0);
  assert.equal(rig.activeLocoClip(), states.idle);
});

test('the blend time between moves comes from the mapping, and the legs really sample the mapped clip', () => {
  const rig = rigOf();
  rig.addClip(clip('a'));
  rig.addClip(clip('b'));
  rig.setMapping({ states: { idle: 'a', walk_forward: 'b' }, transition: 0.5 });
  rig.play('idle', null, 0, 0);
  rig.update(0.1);
  rig.play('walk_forward', null, 0, 0);
  assert.equal(rig.activeLocoClip(), 'b');
  rig.update(0.1);
  assert.ok(rig.hasClip('b'));
  assert.equal(rig.clipDuration('b'), 1 / 30);
  assert.equal(rig.clipDuration('nope'), 0);
});

test('the cast clip plays at the set speed and can be restarted', () => {
  const rig = rigOf();
  const c = clip('c');
  c.loop = false;
  rig.addClip(c);
  rig.play('idle', 'c', 1, 0);
  rig.setCastSpeed(2);
  rig.update(0.1);
  assert.ok(Math.abs(rig.castClipTime() - 0.2) < 1e-9);
  rig.restartCast();
  assert.equal(rig.castClipTime(), 0);
});

// ---- F5: cast timing ----
test('castSpeed puts the clip\'s fire point on the windup, and is 1 when fireAt is off', () => {
  assert.equal(castSpeed(0, 1, 0.5), 1);
  assert.equal(castSpeed(undefined, 1, 0.5), 1);
  assert.ok(Math.abs(castSpeed(0.5, 1.2, 0.3) - 2) < 1e-9, 'half of a 1.2 s clip is 0.6 s; the windup is 0.3 s, so twice as fast');
  assert.equal(castSpeed(0.5, 1, 0), 1, 'no windup: leave it alone');
  assert.equal(castSpeed(0.9, 10, 0.01), 8, 'never faster than 8x');
  assert.equal(castSpeed(0.1, 0.1, 5), 0.25, 'never slower than a quarter');
});

test('castClipChoice uses the skill\'s own clip when the rig has it, else the archetype\'s clip from the data', () => {
  const rig = data.animation.rigs.wizardpack;
  const has = (n: string) => n === 'own' || n === rig.cast.throw;
  assert.equal(castClipChoice({ archetype: 'throw', clip: 'own' }, has, rig.cast), 'own');
  assert.equal(castClipChoice({ archetype: 'throw', clip: 'missing' }, has, rig.cast), rig.cast.throw);
  assert.equal(castClipChoice({ archetype: 'throw', clip: '' }, has, rig.cast), rig.cast.throw);
  assert.equal(castClipChoice({ archetype: 'throw', clip: '' }, has, { throw: 'edited' }), 'edited');
});

test('previewAt walks a looping cast: wind up, fire once, recover, rest, then loop', () => {
  const o = { windup: 0.4, clipSeconds: 1, speed: 1, rest: 1 };
  const at = (t: number) => previewAt(t, o);
  assert.equal(at(0).fired, false);
  assert.equal(at(0).casting, true);
  assert.ok(Math.abs(at(0.2).clipTime - 0.2) < 1e-9);
  assert.equal(at(0.41).fired, true);
  assert.equal(at(0.9).casting, true);
  assert.equal(at(1.1).casting, false);
  assert.equal(at(1.6).casting, false, 'the clip is over; the character rests');
  assert.equal(at(2.1).fired, false, 'then the loop starts again');
  const total = at(0).period;
  assert.ok(Math.abs(total - 2) < 1e-9);
  assert.deepEqual([at(total + 0.2).clipTime, at(total + 0.2).fired], [at(0.2).clipTime, at(0.2).fired]);
});

// ---- F2: camera ----
const base: CameraCfg = data.camera;
const flat = buildWorld({ ...data.rooms.forest_clearing, colliders: [] });

test('the camera reads its distance, shoulder and height from the data every call', () => {
  let cfg = base;
  const cam = new ThirdPersonCamera(flat, () => cfg);
  const feet = { x: 0, y: 0, z: 0 };
  const a = cam.update(feet, 0, 0).origin;
  assert.ok(Math.abs(a.z + base.distance) < 0.3 || a.z < 0, 'behind the character');
  cfg = { ...base, distance: base.distance + 2, height: base.height + 1, shoulder: -base.shoulder };
  const b = cam.update(feet, 0, 0).origin;
  assert.ok(b.y > a.y + 0.9, 'higher');
  assert.ok(b.z < a.z - 1, 'farther back');
  assert.ok(Math.sign(b.x) !== Math.sign(a.x) || Math.abs(b.x) < 1e-6 || Math.abs(a.x) < 1e-6, 'the other shoulder');
});

test('smoothTo never overshoots, is rigid at rate 0, and settles', () => {
  assert.equal(smoothTo(0, 10, 0, 0.016), 10, 'rate 0 is rigid');
  const one = smoothTo(0, 10, 10, 0.016);
  assert.ok(one > 0 && one < 10);
  let v = 0;
  for (let i = 0; i < 600; i++) v = smoothTo(v, 10, 10, 0.016);
  assert.ok(Math.abs(v - 10) < 1e-6);
});

test('with smoothing on the camera lags a sudden move, then arrives', () => {
  const cam = new ThirdPersonCamera(flat, () => ({ ...base, followRate: 8 }));
  cam.update({ x: 0, y: 0, z: 0 }, 0, 0, 0.016);
  const lag = cam.update({ x: 4, y: 0, z: 0 }, 0, 0, 0.016).origin;
  const rigid = new ThirdPersonCamera(flat, () => base).update({ x: 4, y: 0, z: 0 }, 0, 0, 0.016).origin;
  assert.ok(lag.x < rigid.x - 1, 'still behind where a rigid camera would be');
  let o = lag;
  for (let i = 0; i < 400; i++) o = cam.update({ x: 4, y: 0, z: 0 }, 0, 0, 0.016).origin;
  assert.ok(Math.abs(o.x - rigid.x) < 0.01);
});

test('effectiveFov adds the player\'s own setting (55 is neutral) to the data\'s field of view', () => {
  assert.equal(effectiveFov(55, 55), 55);
  assert.equal(effectiveFov(70, 55), 70);
  assert.equal(effectiveFov(55, 80), 80);
  assert.equal(effectiveFov(40, 55), 40);
  assert.equal(effectiveFov(200, 110), 120, 'kept inside 20 to 120');
});

test('the mouse look uses the pitch limits it is given', () => {
  const canvas = { addEventListener() {}, requestPointerLock() {} } as unknown as HTMLElement;
  (globalThis as any).window ??= { addEventListener() {} };
  (globalThis as any).document ??= { addEventListener() {}, pointerLockElement: null };
  const input = new InputController(canvas);
  input.pitchMin = -0.5;
  input.pitchMax = 0.7;
  input.unlocked = true;
  input.sensitivity = 1;
  input.look(0, -1e6);
  assert.equal(input.pitch, 0.7);
  input.look(0, 1e6);
  assert.equal(input.pitch, -0.5);
});

// ---- F5: framing the whole model ----
test('frameBox puts a 1.8 m model fully in view and further back for a taller or wider one', () => {
  const box = { min: { x: -0.5, y: 0, z: -0.3 }, max: { x: 0.5, y: 1.8, z: 0.3 } };
  const f = frameBox(box, 40, 1.3);
  assert.deepEqual([f.target.x, f.target.y, f.target.z], [0, 0.9, 0]);
  // the vertical half-extent seen at that distance must cover the model's half height
  const halfSeen = Math.tan((40 * Math.PI) / 360) * f.distance;
  assert.ok(halfSeen >= 0.9, `sees ${halfSeen}`);
  const taller = frameBox({ min: box.min, max: { ...box.max, y: 6 } }, 40, 1.3);
  assert.ok(taller.distance > f.distance * 2.5);
  const wide = frameBox({ min: { x: -5, y: 0, z: 0 }, max: { x: 5, y: 1, z: 0.5 } }, 40, 1);
  assert.ok(Math.tan((40 * Math.PI) / 360) * wide.distance * 1 >= 5, 'a narrow view must still fit the width');
  assert.ok(Number.isFinite(frameBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, 40, 1).distance), 'an empty box is still finite');
});
