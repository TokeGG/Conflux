// The numbers the game plays with: the data files, then the owner's saved session numbers, then the numbers tried in the current run.
import type { EnemyDef, GameData } from './types.ts';
import { applyPatches, resolvePath, validatePatch, type DataPatch } from './patch.ts';

export interface ChangeRow {
  path: string;
  from: unknown;
  to: unknown;
  layer: 'session' | 'run' | 'custom';
}

/** A mob added by the owner (from the dev panel): an enemy entry and the biome pools it joins. */
export interface CustomMobData {
  id: string;
  enemy: EnemyDef;
  pools: string[];
}

export class DataLayers {
  private session: DataPatch[] = [];
  private run: DataPatch[] = [];
  private cache: GameData | null = null;
  private custom: CustomMobData[] = [];
  private seeded: GameData | null = null;
  private removedListeners: ((id: string) => void)[] = [];
  /** Changes whenever a layer does, so panels know to redraw. */
  version = 0;

  constructor(readonly base: GameData) {}

  /** Replaces the session layer. Patches that no longer apply are dropped and reported. */
  setSession(patches: readonly DataPatch[]): string[] {
    const { ok, errors } = this.sanitize(patches);
    this.session = ok;
    this.touch();
    return errors;
  }

  /** Replaces the layer for the current run. */
  setRun(patches: readonly DataPatch[]): string[] {
    const { ok, errors } = this.sanitize(patches);
    this.run = ok;
    this.touch();
    return errors;
  }

  sessionPatches(): DataPatch[] {
    return [...this.session];
  }

  /** Replaces all custom mobs (used when saved ones are loaded). */
  setCustom(mobs: readonly CustomMobData[]): void {
    for (const m of mobs) this.checkCustom(m);
    this.custom = [...new Map(mobs.map((m) => [m.id, m])).values()];
    this.touch();
  }

  /** Adds a mob, or replaces one with the same id. A built-in enemy cannot be replaced. */
  addCustom(mob: CustomMobData): void {
    this.checkCustom(mob);
    this.custom = [...this.custom.filter((m) => m.id !== mob.id), mob];
    this.touch();
  }

  /** Takes a mob out of the data and out of every pool, and tells the listeners (the models page deletes it from storage). */
  removeCustom(id: string): void {
    if (!this.custom.some((m) => m.id === id)) return;
    this.custom = this.custom.filter((m) => m.id !== id);
    this.touch();
    for (const cb of this.removedListeners) cb(id);
  }

  customMobs(): CustomMobData[] {
    return [...this.custom];
  }

  onCustomRemoved(cb: (id: string) => void): void {
    this.removedListeners.push(cb);
  }

  private checkCustom(m: CustomMobData): void {
    if (this.base.enemies[m.id]) throw new Error(`${m.id} is a built-in enemy and cannot be replaced by a custom mob`);
  }

  /** The file data with the custom mobs added: their enemy entries and their places in the pools. */
  private withCustom(): GameData {
    if (!this.custom.length) return this.base;
    if (!this.seeded) {
      const d = structuredClone(this.base);
      for (const m of this.custom) {
        d.enemies[m.id] = { ...structuredClone(m.enemy), id: m.id };
        for (const pool of m.pools) {
          const b = d.biomes[pool];
          if (b && !b.enemyPool.includes(m.id)) b.enemyPool.push(m.id);
        }
      }
      this.seeded = d;
    }
    return this.seeded;
  }

  runPatches(): DataPatch[] {
    return [...this.run];
  }

  /** True when any patch or uploaded mob is in effect: a run on this data must not count toward unlocks. */
  isModified(): boolean {
    return this.patches().length > 0 || this.custom.length > 0;
  }

  /** The effective patches, one per path: session patches that are not overridden, then the run patches. */
  patches(): DataPatch[] {
    const last = (list: DataPatch[]) => [...new Map(list.map((p) => [p.path, p])).values()];
    const run = last(this.run);
    const overridden = new Set(run.map((p) => p.path));
    return [...last(this.session).filter((p) => !overridden.has(p.path)), ...run];
  }

  current(): GameData {
    if (!this.cache) this.cache = applyPatches(this.withCustom(), [...this.session, ...this.run]).data;
    return this.cache;
  }

  /** Every changed value as file value to current value, one row per path, tagged with the layer that wins. */
  changes(): ChangeRow[] {
    const paths = [...new Set([...this.session, ...this.run].map((p) => p.path))];
    const now = this.current();
    const rows: ChangeRow[] = [];
    for (const m of this.custom) rows.push({ path: `enemies.${m.id}`, from: undefined, to: 'added', layer: 'custom' });
    for (const path of paths) {
      const from = resolvePath(this.withCustom(), path)?.value;
      const to = resolvePath(now, path)?.value;
      if (from === to) continue;
      rows.push({ path, from, to, layer: this.run.some((p) => p.path === path) ? 'run' : 'session' });
    }
    return rows;
  }

  /** Puts one value back to the file value (the undo in the Changes list). */
  revert(path: string): void {
    const added = this.custom.find((m) => path === `enemies.${m.id}`);
    if (added) {
      this.removeCustom(added.id);
      return;
    }
    this.session = this.session.filter((p) => p.path !== path);
    this.run = this.run.filter((p) => p.path !== path);
    this.touch();
  }

  reset(): void {
    this.session = [];
    this.run = [];
    this.touch();
  }

  private sanitize(patches: readonly DataPatch[]): { ok: DataPatch[]; errors: string[] } {
    const ok: DataPatch[] = [];
    const errors: string[] = [];
    for (const p of patches) {
      const err = validatePatch(this.withCustom(), p);
      if (err) errors.push(err);
      else ok.push(p);
    }
    return { ok, errors };
  }

  private touch(): void {
    this.cache = null;
    this.seeded = null;
    this.version++;
  }
}
