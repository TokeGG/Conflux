// The logic behind the panel's toolbar: stage edits, try them in the run, keep them for the session, put everything back, copy them out.
import { validatePatch, type DataLayers, type DataPatch } from '@conflux/shared';

export interface DevStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'conflux.devSession';

const merge = (list: DataPatch[]): DataPatch[] => [...new Map(list.map((p) => [p.path, p])).values()];

const isPatch = (v: unknown): v is DataPatch => !!v && typeof v === 'object' && typeof (v as DataPatch).path === 'string' && ['number', 'boolean', 'string'].includes(typeof (v as DataPatch).value);

export class DevState {
  staged: DataPatch[] = [];

  constructor(
    readonly layers: DataLayers,
    private readonly storage: DevStorage | null,
  ) {}

  /** Null when staged, otherwise why the edit was refused. A later edit of the same path replaces the earlier one. */
  stage(p: DataPatch): string | null {
    const err = validatePatch(this.layers.base, p);
    if (err) return err;
    this.staged = merge([...this.staged, p]);
    return null;
  }

  /** Staged edits go into the run layer. Returns the edits that were refused. */
  tryNow(): string[] {
    const errors = this.layers.setRun(merge([...this.layers.runPatches(), ...this.staged]));
    this.staged = [];
    return errors;
  }

  /** Tried edits become the session layer and are saved. False when they could not be saved (they still apply for this visit). */
  keep(): boolean {
    if (this.staged.length) this.tryNow();
    const all = this.layers.patches();
    this.layers.setSession(all);
    this.layers.setRun([]);
    if (!this.storage) return false;
    try {
      this.storage.setItem(KEY, JSON.stringify(all));
      return true;
    } catch {
      return false;
    }
  }

  /** Reads the saved session. Entries that no longer apply are returned as errors; unreadable ones are dropped silently. */
  loadSession(): string[] {
    let saved: unknown[] = [];
    try {
      const text = this.storage?.getItem(KEY);
      const parsed = text ? JSON.parse(text) : [];
      if (Array.isArray(parsed)) saved = parsed;
    } catch {
      saved = [];
    }
    return this.layers.setSession(saved.filter(isPatch));
  }

  putBack(): void {
    this.layers.reset();
    this.staged = [];
    try {
      this.storage?.removeItem(KEY);
    } catch {
      /* nothing saved that we could remove */
    }
  }

  changesText(): string {
    return JSON.stringify(this.layers.patches(), null, 2);
  }
}
