import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auraError, defaultData } from '@conflux/shared';
import { AURA_PULSE, DEFAULT_AURA, auraOf, pulseHz, pulseLevel } from '../src/anim/bossAura.ts';

const data = defaultData();

test('the Maw and the Reaper have their own aura colours, valid', () => {
  const maw = data.enemies['boss.maw'].aura!;
  const reaper = data.enemies['boss.reaper'].aura!;
  assert.ok(maw && reaper);
  assert.notEqual(maw.color, reaper.color);
  assert.equal(auraError(maw), null);
  assert.equal(auraError(reaper), null);
});

test('auraError rejects bad colours, loud lights and absurd reaches', () => {
  assert.ok(auraError({ color: 'red', intensity: 5, radius: 8 }));
  assert.ok(auraError({ color: '#aabbcc', intensity: 99, radius: 8 }));
  assert.ok(auraError({ color: '#aabbcc', intensity: 5, radius: 0 }));
  assert.ok(auraError({ color: '#aabbcc', intensity: NaN, radius: 8 }));
  assert.equal(auraError({ color: '#aabbcc', intensity: 5, radius: 8 }), null);
});

test('a boss without its own aura gets the default; a mob gets none; a broken one falls back', () => {
  assert.deepEqual(auraOf({ id: 'boss.later' }), DEFAULT_AURA);
  assert.equal(auraOf({ id: 'enemy.skeleton' }), null);
  assert.deepEqual(auraOf({ id: 'boss.x', aura: { color: 'nope', intensity: 1, radius: 1 } }), DEFAULT_AURA);
  assert.equal(auraError(DEFAULT_AURA), null);
});

test('the pulse quickens as health drops and in a wind-up, and stays finite', () => {
  assert.ok(pulseHz(0.2, 0) > pulseHz(1, 0));
  assert.ok(pulseHz(1, 1) > pulseHz(1, 0));
  assert.equal(pulseHz(1, 0), AURA_PULSE.baseHz);
  for (const v of [NaN, -3, 7]) assert.ok(Number.isFinite(pulseHz(v, v)));
});

test('the pulse level swings within its depth and brightens with attack energy', () => {
  for (let i = 0; i <= 100; i++) {
    const l = pulseLevel(i / 100);
    assert.ok(l >= 1 - AURA_PULSE.depth - 1e-9 && l <= 1 + 1e-9);
  }
  assert.ok(pulseLevel(0.25, 1) > pulseLevel(0.25, 0));
  assert.ok(Number.isFinite(pulseLevel(NaN, NaN)));
});
