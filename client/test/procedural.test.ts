import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultParams, PRESETS } from '../src/anim/procedural.ts';

const NAMES = ['hop', 'stomp_sway', 'hover', 'ribbon_spin', 'part_sway', 'lunge'] as const;

test('hop stays within its amplitude bounds and repeats every period', () => {
  const p = { ...defaultParams(), amplitude: 0.3, speed: 2 };
  for (let i = 0; i < 400; i++) {
    const t = i * 0.013;
    const a = PRESETS.hop(t, p);
    assert.ok(a.pos.y >= -1e-9 && a.pos.y <= 0.3 + 1e-9, `height ${a.pos.y}`);
    const b = PRESETS.hop(t + 1 / 2, p);
    assert.ok(Math.abs(a.pos.y - b.pos.y) < 1e-9 && Math.abs(a.rotY - b.rotY) < 1e-9, 'periodic');
  }
  let top = 0;
  for (let i = 0; i < 1000; i++) top = Math.max(top, PRESETS.hop(i * 0.001, p).pos.y);
  assert.ok(top > 0.29, `it does reach the top (${top})`);
});

test('every preset gives finite, positive-scale transforms and repeats every period', () => {
  const p = { ...defaultParams(), speed: 1.5 };
  for (const name of NAMES) {
    for (let i = 0; i < 200; i++) {
      const t = i * 0.037;
      const a = PRESETS[name](t, p);
      for (const v of [a.pos.x, a.pos.y, a.pos.z, a.rotY, a.scale.x, a.scale.y, a.scale.z]) assert.ok(Number.isFinite(v), `${name} finite`);
      assert.ok(a.scale.x > 0 && a.scale.y > 0 && a.scale.z > 0, `${name} scale`);
      const b = PRESETS[name](t + 1 / 1.5, p);
      assert.ok(Math.abs(a.pos.y - b.pos.y) < 1e-9 && Math.abs(a.pos.z - b.pos.z) < 1e-9 && Math.abs(Math.sin(a.rotY) - Math.sin(b.rotY)) < 1e-9, `${name} periodic`);
    }
  }
});

test('hover bobs about its resting height and ribbon_spin turns all the way round', () => {
  const p = { ...defaultParams(), amplitude: 0.2, speed: 1 };
  const ys = Array.from({ length: 100 }, (_, i) => PRESETS.hover(i * 0.01, p).pos.y);
  assert.ok(Math.min(...ys) >= -0.2 - 1e-9 && Math.max(...ys) <= 0.2 + 1e-9);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3, 'it moves');
  const turn = PRESETS.ribbon_spin(1, { ...p, speed: 1 }).rotY - PRESETS.ribbon_spin(0, { ...p, speed: 1 }).rotY;
  assert.ok(Math.abs(Math.abs(turn) - Math.PI * 2) < 1e-6, `a full turn per period (${turn})`);
});

test('lunge thrusts forward and comes back, and a phase shifts a preset in time', () => {
  const p = { ...defaultParams(), amplitude: 0.5, speed: 1 };
  const zs = Array.from({ length: 100 }, (_, i) => PRESETS.lunge(i * 0.01, p).pos.z);
  assert.ok(Math.max(...zs) > 0.45 && Math.min(...zs) >= -1e-9);
  const a = PRESETS.stomp_sway(0.3, p);
  const b = PRESETS.stomp_sway(0.3, { ...p, phase: 0.4 });
  assert.notDeepEqual(a, b);
  assert.deepEqual(PRESETS.stomp_sway(0.3 + 0.4, p), b);
});
