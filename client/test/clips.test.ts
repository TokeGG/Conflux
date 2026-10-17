import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composePose, decodeClip, sampleClip, sampleHips, UPPER_BODY, type ClipFile } from '../src/anim/clips.ts';
import { castClipFor, locoClipName, pickLocomotion } from '../src/anim/locomotion.ts';

const load = (rig: string, name: string): ClipFile => JSON.parse(readFileSync(new URL(`../public/assets/clips/${rig}/${name}.json`, import.meta.url), 'utf8'));
const idleFile = load('wizardpack', 'loco_standing_idle');
const castFile = load('wizardpack', 'cast_1h_magic_attack_02');
const runFile = load('wizardpack', 'loco_standing_run_forward');

test('decodeClip returns the file\'s frame count and unit quaternions within 1e-3', () => {
  const c = decodeClip(castFile);
  assert.equal(c.frames, castFile.frames);
  assert.equal(c.q.length, c.frames * c.bones.length * 4);
  assert.equal(c.hips.length, c.frames * 3);
  for (let i = 0; i < c.frames * c.bones.length; i++) {
    const n = Math.hypot(c.q[i * 4], c.q[i * 4 + 1], c.q[i * 4 + 2], c.q[i * 4 + 3]);
    assert.ok(Math.abs(n - 1) < 1e-3, `quaternion ${i} has length ${n}`);
  }
});

test('sampleClip at t = 0 equals frame 0', () => {
  const c = decodeClip(runFile);
  const out = new Float32Array(c.bones.length * 4);
  sampleClip(c, 0, out);
  for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - c.q[i]) < 1e-6);
});

test('a looping clip wraps at t = duration, a one-shot clip holds its last frame', () => {
  const loop = decodeClip(runFile);
  assert.equal(loop.loop, true);
  const a = new Float32Array(loop.bones.length * 4);
  sampleClip(loop, loop.duration, a);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - loop.q[i]) < 1e-5, 'back at frame 0');
  const shot = decodeClip(castFile);
  assert.equal(shot.loop, false);
  const b = new Float32Array(shot.bones.length * 4);
  sampleClip(shot, shot.duration * 3, b);
  const last = (shot.frames - 1) * shot.bones.length * 4;
  for (let i = 0; i < b.length; i++) assert.ok(Math.abs(b[i] - shot.q[last + i]) < 1e-5);
});

test('sampleClip halfway between two frames is a unit quaternion between them', () => {
  const c = decodeClip(runFile);
  const out = new Float32Array(c.bones.length * 4);
  sampleClip(c, 0.5 / c.fps, out);
  for (let b = 0; b < c.bones.length; b++) {
    assert.ok(Math.abs(Math.hypot(out[b * 4], out[b * 4 + 1], out[b * 4 + 2], out[b * 4 + 3]) - 1) < 1e-4);
  }
  const hips = new Float32Array(3);
  sampleHips(c, 0, hips);
  assert.ok(hips.every(Number.isFinite), 'the hips position is a real number');
  const h0 = new Float32Array(3);
  const h1 = new Float32Array(3);
  sampleHips(c, 0, h0);
  sampleHips(c, c.duration / 2, h1);
  assert.ok(h0.some((v, i) => Math.abs(v - h1[i]) > 1e-4), 'the hips move during a run');
});

test('with the cast at full weight the legs are exactly the locomotion pose and the upper body is exactly the cast pose', () => {
  const loco = decodeClip(runFile);
  const cast = decodeClip(castFile);
  assert.deepEqual(loco.bones, cast.bones);
  const a = new Float32Array(loco.bones.length * 4);
  const b = new Float32Array(loco.bones.length * 4);
  const out = new Float32Array(loco.bones.length * 4);
  sampleClip(loco, 0.3, a);
  sampleClip(cast, 0.3, b);
  composePose(loco.bones, a, b, 1, UPPER_BODY, out);
  let upper = 0;
  let lower = 0;
  loco.bones.forEach((bone, i) => {
    const from = UPPER_BODY.has(bone) ? b : a;
    UPPER_BODY.has(bone) ? upper++ : lower++;
    for (let k = 0; k < 4; k++) assert.equal(out[i * 4 + k], from[i * 4 + k], `${bone} component ${k}`);
  });
  assert.ok(upper >= 8 && lower >= 4, `${upper} upper and ${lower} lower bones`);
  composePose(loco.bones, a, b, 0, UPPER_BODY, out);
  assert.deepEqual(Array.from(out), Array.from(a), 'zero weight is all locomotion');
});

test('the upper-body set covers both rigs and excludes legs and hips', () => {
  for (const name of ['Abdomen', 'Torso', 'Neck', 'Head', 'ShoulderL', 'UpperArmR', 'LowerArmL', 'FistR', 'Bip01_Spine1_05', 'Bip01_L_Hand_031']) assert.ok(UPPER_BODY.has(name), name);
  for (const name of ['Hips', 'UpperLegL', 'LowerLegR', 'Bip01_Pelvis_02', 'Bip01_L_Calf_024']) assert.equal(UPPER_BODY.has(name), false, name);
});

test('the old wizard\'s clips decode too, with its own bone names', () => {
  const c = decodeClip(load('oldwizard', 'loco_standing_idle'));
  assert.ok(c.bones.includes('Bip01_Pelvis_02'));
  assert.ok(c.frames > 1);
  assert.ok(idleFile.frames > 1);
});

test('pickLocomotion: running forward, left, back and right relative to the facing; standing is idle', () => {
  assert.equal(pickLocomotion({ x: 0, y: 0, z: 6 }, 0, 6), 'run_forward');
  assert.equal(pickLocomotion({ x: -6, y: 0, z: 0 }, 0, 6), 'run_left');
  assert.equal(pickLocomotion({ x: 6, y: 0, z: 0 }, 0, 6), 'run_right');
  assert.equal(pickLocomotion({ x: 0, y: 0, z: -6 }, 0, 6), 'run_back');
  assert.equal(pickLocomotion({ x: 0, y: 0, z: 0 }, 0, 0), 'idle');
  assert.equal(pickLocomotion({ x: 6, y: 0, z: 0 }, Math.PI / 2, 6), 'run_forward', 'facing +x, moving +x');
});

test('pickLocomotion: walking is slower than running, sprinting is faster, a big vertical speed is a jump, a dodge picks its own clip', () => {
  assert.equal(pickLocomotion({ x: 0, y: 0, z: 2 }, 0, 2), 'walk_forward');
  assert.equal(pickLocomotion({ x: 0, y: 0, z: 9 }, 0, 9), 'sprint_forward');
  assert.equal(pickLocomotion({ x: 0, y: 4, z: 3 }, 0, 3), 'jump');
  assert.equal(pickLocomotion({ x: 0, y: 0, z: 10 }, 0, 10, true), 'dodge_forward');
  assert.equal(pickLocomotion({ x: -10, y: 0, z: 0 }, 0, 10, true), 'dodge_left');
});

test('every locomotion state names a clip that exists in both rigs', () => {
  const states = ['idle', 'walk_forward', 'walk_back', 'walk_left', 'walk_right', 'run_forward', 'run_back', 'run_left', 'run_right', 'sprint_forward', 'jump', 'dodge_forward', 'dodge_back', 'dodge_left', 'dodge_right'] as const;
  for (const rig of ['wizardpack', 'oldwizard']) {
    const index = JSON.parse(readFileSync(new URL(`../public/assets/clips/${rig}/index.json`, import.meta.url), 'utf8')) as { clips: { name: string }[] };
    const names = new Set(index.clips.map((c) => c.name));
    for (const s of states) assert.ok(names.has(locoClipName(s)), `${rig}: ${locoClipName(s)}`);
  }
});

test('castClipFor maps each cast archetype to a clip that exists', () => {
  const index = JSON.parse(readFileSync(new URL('../public/assets/clips/wizardpack/index.json', import.meta.url), 'utf8')) as { clips: { name: string }[] };
  const names = new Set(index.clips.map((c) => c.name));
  for (const a of ['throw', 'sweep', 'push', 'slam', 'channel', 'self']) assert.ok(names.has(castClipFor(a)), a);
  assert.throws(() => castClipFor('nonsense'), /nonsense/);
});
