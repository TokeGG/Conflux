import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, mobMotion, dampAngle, dampTo, type MobMotionIn } from '../src/anim/mobMotion.ts';

const base: MobMotionIn = { t: 1, speed: 0, attackT: -1, hurtT: -1, spawnT: 10, phase: 0 };

test('standing still, a mob breathes: its height changes a little and stays near 1', () => {
  const ys = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => mobMotion({ ...base, t }).scale.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.005, 'it moves');
  for (const y of ys) assert.ok(y > 0.9 && y < 1.1, `y ${y}`);
});

test('moving, a mob leans forward, more the faster it goes, up to a limit', () => {
  const lean = (speed: number) => mobMotion({ ...base, speed }).tilt;
  assert.ok(lean(0) < 0.01);
  assert.ok(lean(2) > lean(1));
  assert.ok(lean(1) > lean(0));
  assert.ok(lean(50) <= MOTION.maxLean + 1e-9);
});

test('moving, a mob bobs up and down at a pace that follows its speed', () => {
  const peak = (speed: number) => Math.max(...Array.from({ length: 60 }, (_, i) => mobMotion({ ...base, speed, t: i / 30 }).pos.y));
  assert.ok(peak(3) > peak(0));
});

test('an attack first draws the body back, then thrusts it forward, then settles', () => {
  const z = (attackT: number) => mobMotion({ ...base, attackT }).pos.z;
  assert.ok(z(0.12) < -0.02, `draws back ${z(0.12)}`);
  assert.ok(z(0.4) > 0.05, `thrusts ${z(0.4)}`);
  assert.ok(Math.abs(z(2)) < 1e-6, 'settled');
});

test('a hit knocks the body back and shrinks it for a moment, then it recovers', () => {
  const m = (hurtT: number) => mobMotion({ ...base, hurtT });
  assert.ok(m(0.03).pos.z < -0.03);
  assert.ok(m(0.03).scale.y < 0.97);
  assert.ok(Math.abs(m(1).pos.z) < 1e-6);
  assert.ok(Math.abs(m(1).scale.y - mobMotion(base).scale.y) < 1e-6);
});

test('a spawning mob pops up past its size and settles at 1', () => {
  const s = (spawnT: number) => mobMotion({ ...base, spawnT }).scale.y;
  assert.ok(s(0.01) < 0.5);
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => s(i / 40 * MOTION.popSeconds))) > 1.02, 'overshoots');
  assert.ok(Math.abs(s(5) - mobMotion(base).scale.y) < 1e-6);
});

test('dampTo closes on its target without overshooting, and dampAngle turns the short way round', () => {
  let v = 0;
  for (let i = 0; i < 20; i++) {
    const next = dampTo(v, 1, 20, 1 / 60);
    assert.ok(next >= v && next <= 1);
    v = next;
  }
  assert.ok(v > 0.9);
  const a = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 12, 1 / 60);
  assert.ok(a > Math.PI - 0.1, 'across the seam, not back the long way');
});
