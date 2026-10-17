// Render profiles: data the client reads to decide how the game looks. `chunky` is the first; better ones can be added later
// without touching gameplay data.
import * as THREE from 'three';

export interface RenderProfile {
  id: string;
  /** 0.75 to 1: the share of the native resolution the game is drawn at. */
  renderScale: number;
  antialias: boolean;
  textureFilter: 'nearest' | 'linear';
  spriteFilter: 'nearest' | 'linear';
  shadows: boolean;
  maxTexture: number;
  effects: { sprites: boolean; particles: boolean; shaders: boolean };
}

export const CHUNKY: RenderProfile = {
  id: 'chunky',
  renderScale: 1,
  antialias: true,
  textureFilter: 'nearest',
  spriteFilter: 'linear',
  shadows: false,
  maxTexture: 1024,
  effects: { sprites: true, particles: true, shaders: true },
};

export const clampScale = (s: number): number => Math.min(1, Math.max(0.75, Number.isFinite(s) ? s : 1));

export const textureFilterConst = (f: 'nearest' | 'linear') => (f === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter);

/** The few renderer members a profile changes (lets tests pass a stand-in). */
export interface RendererLike {
  setPixelRatio(n: number): void;
  shadowMap: { enabled: boolean };
}

export function applyProfile(r: RendererLike, p: RenderProfile, devicePixelRatio: number = globalThis.devicePixelRatio ?? 1): void {
  r.setPixelRatio(Math.min(devicePixelRatio, 2) * clampScale(p.renderScale));
  r.shadowMap.enabled = p.shadows;
}

export function createRenderer(p: RenderProfile): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ antialias: p.antialias, powerPreference: 'high-performance' });
  applyProfile(r, p);
  r.setSize(window.innerWidth, window.innerHeight);
  return r;
}

/** Sets the profile's texture filtering on every texture of a loaded model (blocky, no mipmaps for 'nearest'). */
export function applyTextureFilters(root: THREE.Object3D, p: RenderProfile): void {
  const filter = textureFilterConst(p.textureFilter);
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
        const t = (m as THREE.MeshStandardMaterial)[key];
        if (!t) continue;
        t.magFilter = filter;
        t.minFilter = filter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
      }
    }
  });
}
