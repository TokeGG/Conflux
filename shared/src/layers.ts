// The numbers the game plays with: the data files, then the owner's saved session numbers, then the numbers tried in the current run.
import type { GameData } from './types.ts';
import { applyPatches, resolvePath, validatePatch, type DataPatch } from './patch.ts';

export interface ChangeRow {
  path: string;
  from: unknown;
  to: unknown;
  layer: 'session' | 'run';
}

export class DataLayers {
  private session: DataPatch[] = [];
  private run: DataPatch[] = [];
  private cache: GameData | null = null;
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

  runPatches(): DataPatch[] {
    return [...this.run];
  }

  /** The effective patches, one per path: session patches that are not overridden, then the run patches. */
  patches(): DataPatch[] {
    const last = (list: DataPatch[]) => [...new Map(list.map((p) => [p.path, p])).values()];
    const run = last(this.run);
    const overridden = new Set(run.map((p) => p.path));
    return [...last(this.session).filter((p) => !overridden.has(p.path)), ...run];
  }

  current(): GameData {
    if (!this.cache) this.cache = applyPatches(this.base, [...this.session, ...this.run]).data;
    return this.cache;
  }

  /** Every changed value as file value to current value, one row per path, tagged with the layer that wins. */
  changes(): ChangeRow[] {
    const paths = [...new Set([...this.session, ...this.run].map((p) => p.path))];
    const now = this.current();
    const rows: ChangeRow[] = [];
    for (const path of paths) {
      const from = resolvePath(this.base, path)?.value;
      const to = resolvePath(now, path)?.value;
      if (from === to) continue;
      rows.push({ path, from, to, layer: this.run.some((p) => p.path === path) ? 'run' : 'session' });
    }
    return rows;
  }

  /** Puts one value back to the file value (the undo in the Changes list). */
  revert(path: string): void {
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
      const err = validatePatch(this.base, p);
      if (err) errors.push(err);
      else ok.push(p);
    }
    return { ok, errors };
  }

  private touch(): void {
    this.cache = null;
    this.version++;
  }
}
