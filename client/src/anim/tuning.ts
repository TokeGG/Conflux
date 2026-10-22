// A registry of live tuning objects: plain objects of numbers (and yes/no values) that the code reads every frame, such as MOTION in
// mobMotion.ts. Anything registered here shows up on the dev panel's "Motion tuning" page, where it can be edited live, kept for the
// browser session and copied out. Pure (no DOM), so it is tested.
//
//   tuning.register('mobMotion', MOTION, { title: 'Mob motion', specs: { breathAmp: { min: 0, max: 0.2, step: 0.005 } } });
//
// Job A registers its attack-animation objects the same way (see registerTuning.ts).

export interface TuningSpec {
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export interface TuningRow {
  /** Dotted path inside the object. */
  path: string;
  label: string;
  value: number | boolean;
  default: number | boolean;
  boolean: boolean;
  min: number;
  max: number;
  step: number;
}

export interface TuningChange {
  path: string;
  from: number | boolean;
  to: number | boolean;
}

interface Entry {
  name: string;
  title: string;
  obj: Record<string, unknown>;
  specs: Record<string, TuningSpec>;
  defaults: Map<string, number | boolean>;
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'conflux.tuningSession';
const isLeaf = (v: unknown): v is number | boolean => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

function leaves(obj: unknown, prefix: string, out: Map<string, number | boolean>): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.set(path, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, path, out);
  }
}

function at(obj: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } | null {
  const segs = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[segs[i]];
  }
  if (!cur || typeof cur !== 'object' || !(segs[segs.length - 1] in (cur as object))) return null;
  return { parent: cur as Record<string, unknown>, key: segs[segs.length - 1] };
}

const humanise = (path: string): string => {
  const last = path.split('.').slice(-1)[0].replace(/([A-Z])/g, ' $1').toLowerCase();
  return last.charAt(0).toUpperCase() + last.slice(1);
};

/** A sensible range and step around a default that has no spec: from 0 (or the negative of the range) to a few times the default. */
function autoRange(d: number): { min: number; max: number; step: number } {
  const mag = Math.max(Math.abs(d), 0.01);
  const max = Math.max(1, mag * 4);
  const step = mag >= 10 ? 0.5 : mag >= 1 ? 0.05 : mag >= 0.1 ? 0.01 : 0.005;
  return { min: d < 0 ? -max : 0, max, step };
}

export class TuningRegistry {
  private entries = new Map<string, Entry>();
  /** Goes up on every register, edit, reset and load, so a page knows when to redraw. */
  version = 0;

  /** Adds an object (the live one, not a copy). Registering a name again replaces it. The numbers it has now are its defaults. */
  register(name: string, obj: object, opts: { title?: string; specs?: Record<string, TuningSpec> } = {}): void {
    const defaults = new Map<string, number | boolean>();
    leaves(obj, '', defaults);
    this.entries.set(name, { name, title: opts.title ?? name, obj: obj as Record<string, unknown>, specs: opts.specs ?? {}, defaults });
    this.version++;
  }

  list(): { name: string; title: string }[] {
    return [...this.entries.values()].map((e) => ({ name: e.name, title: e.title }));
  }

  rows(name: string): TuningRow[] {
    const e = this.entries.get(name);
    if (!e) return [];
    const now = new Map<string, number | boolean>();
    leaves(e.obj, '', now);
    return [...e.defaults].map(([path, def]) => {
      const spec = e.specs[path] ?? {};
      const isBool = typeof def === 'boolean';
      const auto = isBool ? { min: 0, max: 1, step: 1 } : autoRange(def as number);
      return {
        path,
        label: spec.label ?? humanise(path),
        value: now.get(path) ?? def,
        default: def,
        boolean: isBool,
        min: spec.min ?? auto.min,
        max: spec.max ?? auto.max,
        step: spec.step ?? auto.step,
      };
    });
  }

  /** Null when applied, otherwise why not. The live object changes at once. */
  set(name: string, path: string, value: number | boolean): string | null {
    const e = this.entries.get(name);
    if (!e) return `unknown tuning object ${name}`;
    const def = e.defaults.get(path);
    const slot = at(e.obj, path);
    if (def === undefined || !slot) return `unknown value ${name}.${path}`;
    if (typeof def === 'boolean') {
      if (typeof value !== 'boolean') return `${name}.${path} must be yes or no`;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${name}.${path} must be a number`;
      const row = this.rows(name).find((r) => r.path === path)!;
      if (value < row.min || value > row.max) return `${name}.${path} must be between ${row.min} and ${row.max}`;
    }
    slot.parent[slot.key] = value;
    this.version++;
    return null;
  }

  /** Puts one value, or a whole object, back to what it was when registered. */
  reset(name: string, path?: string): void {
    const e = this.entries.get(name);
    if (!e) return;
    for (const [p, d] of e.defaults) {
      if (path !== undefined && p !== path) continue;
      const slot = at(e.obj, p);
      if (slot) slot.parent[slot.key] = d;
    }
    this.version++;
  }

  /** Every value that is not at its default. */
  changes(): TuningChange[] {
    const out: TuningChange[] = [];
    for (const e of this.entries.values()) for (const r of this.rows(e.name)) if (r.value !== r.default) out.push({ path: `${e.name}.${r.path}`, from: r.default, to: r.value });
    return out;
  }

  /** The changes as nested JSON: { objectName: { nested: { leaf: value } } }, to paste back. */
  exportText(): string {
    const out: Record<string, unknown> = {};
    for (const e of this.entries.values()) {
      for (const r of this.rows(e.name)) {
        if (r.value === r.default) continue;
        const segs = [e.name, ...r.path.split('.')];
        let cur = out;
        for (const s of segs.slice(0, -1)) cur = (cur[s] ??= {}) as Record<string, unknown>;
        cur[segs[segs.length - 1]] = r.value;
      }
    }
    return JSON.stringify(out, null, 2);
  }

  /** Saves the changes for this browser. False when they could not be saved (they still apply for this visit). */
  keep(storage: Storage | null): boolean {
    if (!storage) return false;
    try {
      storage.setItem(KEY, this.exportText());
      return true;
    } catch {
      return false;
    }
  }

  /** Applies a saved session. Returns what could not be applied (a value that no longer exists, or is out of range). */
  loadSession(storage: Storage | null): string[] {
    let saved: unknown = {};
    try {
      const text = storage?.getItem(KEY);
      saved = text ? JSON.parse(text) : {};
    } catch {
      return [];
    }
    if (!saved || typeof saved !== 'object') return [];
    const errors: string[] = [];
    for (const [name, body] of Object.entries(saved as Record<string, unknown>)) {
      if (!this.entries.has(name)) {
        errors.push(`unknown tuning object ${name}`);
        continue;
      }
      const flat = new Map<string, number | boolean>();
      leaves(body, '', flat);
      for (const [path, v] of flat) {
        const err = this.set(name, path, v);
        if (err) errors.push(err);
      }
    }
    return errors;
  }

  /** Resets everything and forgets the saved session. */
  putBack(storage: Storage | null): void {
    for (const e of this.entries.values()) this.reset(e.name);
    try {
      storage?.removeItem(KEY);
    } catch {
      /* nothing saved that we could remove */
    }
  }
}

/** The game's registry. */
export const tuning = new TuningRegistry();
