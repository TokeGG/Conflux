import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNKY, clampScale, applyProfile, textureFilterConst } from '../src/renderer/profile.ts';
import { lightingRig } from '../src/renderer/lighting.ts';
import { detectCapabilities, fatalMessage } from '../src/capabilities.ts';

test('clampScale keeps the render scale between 0.75 and 1', () => {
  assert.equal(clampScale(0.5), 0.75);
  assert.equal(clampScale(2), 1);
  assert.equal(clampScale(0.9), 0.9);
  assert.equal(clampScale(NaN), 1);
});

test('the chunky profile smooths sprites and keeps textures blocky', () => {
  assert.equal(CHUNKY.id, 'chunky');
  assert.equal(CHUNKY.spriteFilter, 'linear');
  assert.equal(CHUNKY.textureFilter, 'nearest');
  assert.equal(CHUNKY.renderScale, 1);
  assert.equal(CHUNKY.antialias, true);
  assert.equal(CHUNKY.shadows, false);
  assert.equal(CHUNKY.maxTexture, 1024);
});

test('textureFilterConst maps the profile words to Three.js filters', () => {
  assert.equal(textureFilterConst('nearest'), THREE.NearestFilter);
  assert.equal(textureFilterConst('linear'), THREE.LinearFilter);
});

test('applyProfile sets the pixel ratio from the device ratio (capped at 2) times the render scale, and shadows', () => {
  const calls: number[] = [];
  const r = { setPixelRatio: (n: number) => calls.push(n), shadowMap: { enabled: true } };
  applyProfile(r, { ...CHUNKY, renderScale: 0.75 }, 2);
  applyProfile(r, { ...CHUNKY, renderScale: 1 }, 3);
  applyProfile(r, CHUNKY, 1);
  assert.deepEqual(calls, [1.5, 2, 1]);
  assert.equal(r.shadowMap.enabled, false);
});

test('a lighting preset becomes fog, a background and two lights', () => {
  const preset = { ambient: '#cfe8ff', light: '#fff1cc', intensity: 2.2, fogColor: '#6fa8d6', fogNear: 14, fogFar: 34 };
  const rig = lightingRig(preset);
  assert.equal(rig.fog.near, 14);
  assert.equal(rig.fog.far, 34);
  assert.equal(rig.fog.color.getHexString(), '6fa8d6');
  assert.equal(rig.background.getHexString(), '6fa8d6');
  assert.equal(rig.lights.length, 2);
  const sun = rig.lights.find((l): l is THREE.DirectionalLight => l instanceof THREE.DirectionalLight)!;
  assert.equal(sun.intensity, 2.2);
  assert.equal(sun.color.getHexString(), 'fff1cc');
  const sky = rig.lights.find((l): l is THREE.HemisphereLight => l instanceof THREE.HemisphereLight)!;
  assert.equal(sky.color.getHexString(), 'cfe8ff');
});

test('detectCapabilities reads the probe, and a probe that throws counts as unavailable', () => {
  assert.deepEqual(detectCapabilities({ webgl2: () => true, workers: () => true, indexedDb: () => true }), { webgl2: true, workers: true, indexedDb: true });
  const c = detectCapabilities({ webgl2: () => { throw new Error('no gl'); }, workers: () => false, indexedDb: () => { throw new Error('blocked'); } });
  assert.deepEqual(c, { webgl2: false, workers: false, indexedDb: false });
});

test('fatalMessage names what is missing; missing storage alone is not fatal', () => {
  assert.match(fatalMessage({ webgl2: false, workers: true, indexedDb: true })!, /WebGL 2/);
  assert.match(fatalMessage({ webgl2: true, workers: false, indexedDb: true })!, /Web Workers/);
  assert.equal(fatalMessage({ webgl2: true, workers: true, indexedDb: false }), null);
  assert.equal(fatalMessage({ webgl2: true, workers: true, indexedDb: true }), null);
});
