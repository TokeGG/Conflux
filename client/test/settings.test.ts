import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, defaultSettings } from '../src/settings.ts';
import { CHUNKY } from '../src/renderer/profile.ts';

const fake = (init?: string) => {
  const m = new Map<string, string>(init === undefined ? [] : [['conflux.settings', init]]);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('defaults come from the chunky profile', () => {
  const d = defaultSettings();
  assert.deepEqual([d.renderScale, d.antialias, d.shadows], [CHUNKY.renderScale, CHUNKY.antialias, CHUNKY.shadows]);
  assert.deepEqual(d.effects, CHUNKY.effects);
  assert.equal(d.maxEnemies, 0);
});

test('settings round-trip through storage', () => {
  const s = fake();
  saveSettings(s, { ...defaultSettings(), renderScale: 0.8, shadows: true, maxEnemies: 12 });
  const back = loadSettings(s);
  assert.equal(back.renderScale, 0.8);
  assert.equal(back.shadows, true);
  assert.equal(back.maxEnemies, 12);
});

test('the render scale is clamped and junk values fall back to defaults', () => {
  assert.equal(loadSettings(fake(JSON.stringify({ renderScale: 0.1 }))).renderScale, 0.75);
  assert.equal(loadSettings(fake(JSON.stringify({ renderScale: 'big', antialias: 'yes', maxEnemies: -4 }))).renderScale, 1);
  assert.equal(loadSettings(fake(JSON.stringify({ antialias: 'yes' }))).antialias, true);
  assert.equal(loadSettings(fake(JSON.stringify({ maxEnemies: -4 }))).maxEnemies, 0);
});

test('corrupt storage or no storage gives the defaults', () => {
  assert.deepEqual(loadSettings(fake('{oops')), defaultSettings());
  assert.deepEqual(loadSettings(null), defaultSettings());
  assert.doesNotThrow(() => saveSettings(null, defaultSettings()));
  const throws = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.deepEqual(loadSettings(throws), defaultSettings());
  assert.doesNotThrow(() => saveSettings(throws, defaultSettings()));
});

test('profileFromSettings applies the settings on top of the chunky profile', async () => {
  const { profileFromSettings } = await import('../src/settings.ts');
  const p = profileFromSettings({ ...defaultSettings(), renderScale: 0.8, antialias: false, shadows: true, effects: { sprites: false, particles: true, shaders: true } });
  assert.equal(p.id, 'chunky');
  assert.deepEqual([p.renderScale, p.antialias, p.shadows, p.effects.sprites], [0.8, false, true, false]);
  assert.equal(p.textureFilter, CHUNKY.textureFilter);
  assert.equal(p.spriteFilter, CHUNKY.spriteFilter);
});

test('invertY defaults to off, loads when saved, and ignores a value that is not a boolean', () => {
  assert.equal(defaultSettings().invertY, false);
  assert.equal(loadSettings({ getItem: () => JSON.stringify({ invertY: true }) }).invertY, true);
  assert.equal(loadSettings({ getItem: () => JSON.stringify({ invertY: 'yes' }) }).invertY, false);
});

test('mouse sensitivity and field of view default sensibly, load when saved, and are kept inside their ranges', () => {
  const d = defaultSettings();
  assert.equal(d.sensitivity, 1);
  assert.equal(d.fov, 55);
  const l = loadSettings({ getItem: () => JSON.stringify({ sensitivity: 2.5, fov: 80 }) });
  assert.deepEqual([l.sensitivity, l.fov], [2.5, 80]);
  const wild = loadSettings({ getItem: () => JSON.stringify({ sensitivity: 99, fov: 5 }) });
  assert.deepEqual([wild.sensitivity, wild.fov], [4, 40]);
  const junk = loadSettings({ getItem: () => JSON.stringify({ sensitivity: 'fast', fov: null }) });
  assert.deepEqual([junk.sensitivity, junk.fov], [1, 55]);
});
