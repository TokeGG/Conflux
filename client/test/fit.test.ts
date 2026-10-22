(globalThis as any).self = globalThis; // the glTF loader expects a browser
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitHeight } from '../src/renderer/scene.ts';

async function load(name: string): Promise<THREE.Object3D> {
  const b = readFileSync(new URL(`../public/assets/models/enemies/${name}.glb`, import.meta.url));
  const gltf: any = await new Promise((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '', res, rej));
  return clone(gltf.scene); // the game clones every enemy's model, which is what used to throw the fit off for rigged models
}

test('rigged models are fitted to the height asked for, even after being cloned for a second enemy', async () => {
  for (const name of ['fire_elemental', 'water_elemental', 'wraith']) {
    const model = await load(name);
    fitHeight(model, 2);
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - 2) < 0.1, `${name} is ${size.y.toFixed(2)} m tall, not 2`);
  }
});
