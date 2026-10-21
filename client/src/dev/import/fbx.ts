// FBX to GLB in the browser, so the rest of the import only deals with glTF.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** An FBX with embedded textures decodes them asynchronously; exporting before they are ready would leave the model untextured. */
async function waitForImages(root: THREE.Object3D): Promise<void> {
  const waits: Promise<void>[] = [];
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const v of Object.values(m)) {
        const img = v instanceof THREE.Texture ? (v.image as unknown) : null;
        if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && !img.complete) {
          waits.push(new Promise((resolve) => (img.addEventListener('load', () => resolve()), img.addEventListener('error', () => resolve()))));
        }
      }
    }
  });
  await Promise.all(waits);
}

export async function fbxToGlb(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const group = new FBXLoader().parse(buf, '');
  await waitForImages(group);
  const out = await new GLTFExporter().parseAsync(group, { binary: true, animations: group.animations });
  if (!(out instanceof ArrayBuffer)) throw new Error('The FBX could not be converted.');
  return out;
}
