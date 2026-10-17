import * as THREE from 'three';
import { defaultData, DEFAULT_PROFILE } from '@conflux/shared';
import { detectCapabilities, fatalMessage, showFatal } from './capabilities.ts';
import { applyTextureFilters, createRenderer, CHUNKY } from './renderer/profile.ts';
import { createScene, fitHeight } from './renderer/scene.ts';
import { AssetLoader, fetchManifest } from './assets/loader.ts';
import { WorkerBridge } from './worker/workerBridge.ts';

declare global {
  interface Window {
    /** Read by the browser smoke tests. */
    __conflux?: { ready: boolean; tick: number; distinctColours(): number };
  }
}

async function boot(): Promise<void> {
  const data = defaultData();
  const renderer = createRenderer(CHUNKY);
  document.body.append(renderer.domElement);
  const game = createScene(data.biomes.forest.lighting);

  const loader = new AssetLoader(await fetchManifest(), DEFAULT_PROFILE);
  const gltf = await loader.loadModel('model.wizardpack');
  const player = gltf.scene;
  fitHeight(player, 1.8);
  applyTextureFilters(player, CHUNKY);
  game.scene.add(player);

  const bridge = new WorkerBridge(1, data);
  await bridge.ready;
  const state = { ready: false, tick: 0 };
  bridge.onFrame((snapshot) => {
    state.tick = snapshot.tick;
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    game.resize(window.innerWidth, window.innerHeight);
  });

  window.__conflux = {
    get ready() {
      return state.ready;
    },
    get tick() {
      return state.tick;
    },
    /** Draws a frame and counts the distinct colours on a coarse grid of it. */
    distinctColours() {
      renderer.render(game.scene, game.camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const seen = new Set<number>();
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) seen.add((px[(y * w + x) * 4] << 16) | (px[(y * w + x) * 4 + 1] << 8) | px[(y * w + x) * 4 + 2]);
      return seen.size;
    },
  };
  state.ready = true;

  const clock = new THREE.Clock();
  const frame = () => {
    bridge.advance(Math.min(clock.getDelta(), 0.25));
    renderer.render(game.scene, game.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const fatal = fatalMessage(detectCapabilities());
if (fatal) showFatal(fatal);
else boot().catch((e) => showFatal(`Conflux could not start: ${e instanceof Error ? e.message : String(e)}`));
