// Custom content kept in the browser: uploaded mobs and their processed models, in IndexedDB. The data layer gets the mob;
// the asset loader gets the model. Nothing here reaches the sim except as ordinary enemy data.
import type { DataLayers, EnemyDef } from '@conflux/shared';
import { buildExportZip, type Licence } from './exportZip.ts';

export interface CustomMob {
  id: string;
  name: string;
  /** The model id the enemy points at (model.custom.<slug>). */
  glbKey: string;
  enemy: EnemyDef;
  pools: string[];
  licence: Licence;
}

const DB = 'conflux-custom';
const MOBS = 'mobs';
const GLBS = 'glb';

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export class CustomContentStore {
  private constructor(private db: IDBDatabase) {}

  /** The store, or null when the browser has no IndexedDB (private windows, blocked storage). */
  static async open(): Promise<CustomContentStore | null> {
    try {
      if (typeof indexedDB === 'undefined') return null;
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(MOBS, { keyPath: 'id' });
        req.result.createObjectStore(GLBS);
      };
      return new CustomContentStore(await wrap(req));
    } catch {
      return null;
    }
  }

  async put(mob: CustomMob, glb: Uint8Array): Promise<void> {
    const tx = this.db.transaction([MOBS, GLBS], 'readwrite');
    tx.objectStore(MOBS).put(mob);
    tx.objectStore(GLBS).put(glb, mob.glbKey);
    await done(tx);
  }

  async get(id: string): Promise<{ mob: CustomMob; glb: Uint8Array } | null> {
    const tx = this.db.transaction([MOBS, GLBS], 'readonly');
    const mob = (await wrap(tx.objectStore(MOBS).get(id))) as CustomMob | undefined;
    if (!mob) return null;
    const glb = (await wrap(tx.objectStore(GLBS).get(mob.glbKey))) as Uint8Array | undefined;
    return glb ? { mob, glb } : null;
  }

  async list(): Promise<CustomMob[]> {
    return (await wrap(this.db.transaction(MOBS, 'readonly').objectStore(MOBS).getAll())) as CustomMob[];
  }

  async remove(id: string): Promise<void> {
    const mob = (await wrap(this.db.transaction(MOBS, 'readonly').objectStore(MOBS).get(id))) as CustomMob | undefined;
    if (!mob) return;
    const tx = this.db.transaction([MOBS, GLBS], 'readwrite');
    tx.objectStore(MOBS).delete(id);
    tx.objectStore(GLBS).delete(mob.glbKey);
    await done(tx);
  }

  /** One zip with every saved mob: the processed model, its enemy entry, its licence stub and its pools. */
  async exportZip(): Promise<Uint8Array> {
    const all = await Promise.all((await this.list()).map((m) => this.get(m.id)));
    return buildExportZip(
      all
        .filter((x): x is { mob: CustomMob; glb: Uint8Array } => !!x)
        .map(({ mob, glb }) => ({ slug: mob.id.replace(/^enemy\.custom\./, ''), glb, enemy: mob.enemy, pools: mob.pools, licence: mob.licence })),
    );
  }
}

/** Deletes a mob everywhere: its stored model, and the data layer (which drops it from every encounter pool). */
export async function removeMob(store: CustomContentStore, layers: DataLayers, id: string): Promise<void> {
  await store.remove(id);
  layers.removeCustom(id);
}
