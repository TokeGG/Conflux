// Loads assets by logical id through the manifest for the active render profile.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_PROFILE, resolveAsset, type AssetEntry } from '@conflux/shared';

export interface FxDef {
  id: string;
  name: string;
  file: string;
  sheet: [number, number];
  frame: [number, number];
  cols: number;
  frames: number;
  ms: number;
  loop: boolean;
  anchor: [number, number];
  blend: string;
  events: { frame: number; name: string }[];
}

export const assetBase = () => `${import.meta.env.BASE_URL}assets/`;

export async function fetchManifest(base = assetBase()): Promise<AssetEntry[]> {
  const res = await fetch(`${base}assets.json`);
  if (!res.ok) throw new Error(`could not load the asset manifest (${res.status})`);
  return res.json();
}

export class AssetLoader {
  private models = new Map<string, Promise<GLTF>>();
  private json = new Map<string, Promise<unknown>>();
  private gltf = new GLTFLoader();
  private custom = new Map<string, Uint8Array>();
  private textures = new THREE.TextureLoader();

  constructor(
    readonly manifest: AssetEntry[],
    readonly profile: string = DEFAULT_PROFILE,
    readonly base: string = assetBase(),
  ) {}

  url(id: string): string {
    return this.base + resolveAsset(this.manifest, id, this.profile);
  }

  has(id: string): boolean {
    return this.custom.has(id) || this.manifest.some((a) => a.id === id);
  }

  /** A model that lives in the browser (a mob uploaded in the dev panel) rather than in the manifest. */
  addCustomModel(id: string, glb: Uint8Array): void {
    this.custom.set(id, glb);
    this.models.delete(id);
  }

  removeCustomModel(id: string): void {
    this.custom.delete(id);
    this.models.delete(id);
  }

  loadModel(id: string): Promise<GLTF> {
    let p = this.models.get(id);
    if (!p) {
      const bytes = this.custom.get(id);
      p = bytes ? this.gltf.parseAsync(bytes.slice().buffer, '') : this.gltf.loadAsync(this.url(id));
      this.models.set(id, p);
    }
    return p;
  }

  async loadTexture(id: string, filter: 'nearest' | 'linear' = 'nearest'): Promise<THREE.Texture> {
    const t = await this.textures.loadAsync(this.url(id));
    t.magFilter = t.minFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  loadJson<T>(id: string): Promise<T> {
    let p = this.json.get(id);
    if (!p) this.json.set(id, (p = fetch(this.url(id)).then((r) => r.json())));
    return p as Promise<T>;
  }

  /** A Spellwoven effect sheet with its frame data (the sheet filter follows the render profile's sprite filter). */
  async loadFxSheet(id: string, filter: 'nearest' | 'linear'): Promise<{ texture: THREE.Texture; def: FxDef }> {
    const index = await this.loadJson<{ effects: FxDef[] }>('data.fx');
    const def = index.effects.find((e) => `fx.${e.id}` === id);
    if (!def) throw new Error(`unknown effect ${id}`);
    return { texture: await this.loadTexture(id, filter), def };
  }
}
