import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetLoader } from '../src/assets/loader.ts';

function loaderWithStub(): { loader: AssetLoader; loads: string[] } {
  const loader = new AssetLoader([{ id: 'tex.a', files: { chunky: 'a.webp' } } as never, { id: 'tex.b', files: { chunky: 'b.webp' } } as never], 'chunky', '/assets/');
  const loads: string[] = [];
  (loader as unknown as { textures: { loadAsync(url: string): Promise<THREE.Texture> } }).textures = {
    loadAsync: async (url: string) => (loads.push(url), new THREE.Texture()),
  };
  return { loader, loads };
}

test('a texture is loaded once per id and filter, so a new room does not upload (and leak) another copy', async () => {
  const { loader, loads } = loaderWithStub();
  const [a1, a2, b, aNearest] = await Promise.all([loader.loadTexture('tex.a', 'linear'), loader.loadTexture('tex.a', 'linear'), loader.loadTexture('tex.b', 'linear'), loader.loadTexture('tex.a', 'nearest')]);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.notEqual(a1, aNearest, 'a different filter is a different texture');
  assert.equal(loads.length, 3);
  assert.equal(a1.minFilter, THREE.LinearFilter);
  assert.equal(aNearest.minFilter, THREE.NearestFilter);
  assert.equal(a1.colorSpace, THREE.SRGBColorSpace);
  assert.equal(await loader.loadTexture('tex.a', 'linear'), a1);
  assert.equal(loads.length, 3);
});
