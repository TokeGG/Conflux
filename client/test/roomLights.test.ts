import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { LightDef } from '@conflux/shared';
import { flicker, pickLights, RoomLights } from '../src/renderer/roomLights.ts';

const light = (x: number, z: number): LightDef => ({ x, y: 1, z, color: '#ff9a3c', intensity: 10, dist: 10 });
const twenty = Array.from({ length: 20 }, (_, i) => light(i * 3, 0));

test('pickLights returns the nearest eight of twenty, nearest first, and never more than the cap', () => {
  const near = pickLights(twenty, { x: 0, y: 0, z: 0 }, 8);
  assert.equal(near.length, 8);
  assert.deepEqual(near.map((l) => l.x), [0, 3, 6, 9, 12, 15, 18, 21]);
  assert.equal(pickLights(twenty, { x: 0, y: 0, z: 0 }, 0).length, 0);
});

test('pickLights with fewer lights than the cap returns them all', () => {
  assert.equal(pickLights(twenty.slice(0, 3), { x: 50, y: 0, z: 0 }, 8).length, 3);
  assert.deepEqual(pickLights([], { x: 0, y: 0, z: 0 }, 8), []);
});

test('flicker stays within 75% to 100% of the base for a thousand times and phases', () => {
  for (let i = 0; i < 1000; i++) {
    const f = flicker(10, i * 0.137, i * 1.9);
    assert.ok(f >= 7.5 - 1e-9 && f <= 10 + 1e-9, `${f}`);
  }
});

test('the live lights never exceed the cap, the torch is always there and follows the player', () => {
  const scene = new THREE.Scene();
  const lights = new RoomLights(scene, 8);
  lights.setRoom(twenty);
  lights.update(1, { x: 30, y: 0, z: 0 });
  const point = scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
  assert.equal(point.length, 8, 'six room lights, the torch and the boss slot: eight in all');
  assert.ok(point.filter((p) => p.intensity > 0).length <= 8);
  assert.equal(lights.torch.position.x, 30);
  assert.ok(lights.torch.visible && point.filter((p) => p !== lights.aura).every((p) => p.visible), 'a lit room uses the whole pool and the torch');
  assert.equal(lights.aura.visible, false, 'the boss slot is dark with no boss');
  lights.setAura({ x: 1, y: 2, z: 3, color: '#c8641a', intensity: 5, radius: 8 });
  assert.equal(point.filter((p) => p.visible).length, 8, 'a boss lights the reserved slot and the count stays at eight');
  assert.equal(lights.aura.position.y, 2);
  lights.setAura(null);
  assert.equal(lights.aura.visible, false);
  lights.setRoom([]);
  lights.update(2, { x: 0, y: 0, z: 5 });
  assert.equal(point.filter((p) => p.visible).length, 0, 'a room with no lights (the bright sandbox) adds no lights to the scene, so it costs nothing');
});
