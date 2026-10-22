// Patches: a dotted path and a new value. Paths walk the game data; ids that contain dots ("fire.fireball") are matched against
// the keys that exist, and array rows are matched by their id or by index.
import type { GameData } from './types.ts';
import { fieldFor } from './fields.ts';

export interface DataPatch {
  path: string;
  value: number | boolean | string;
}

export interface Resolved {
  parent: Record<string | number, unknown>;
  key: string | number;
  value: unknown;
  /** The path with each (possibly dotted) id as one segment. */
  canonical: string[];
}

export function resolvePath(data: unknown, path: string): Resolved | null {
  const segs = path.split('.');
  let cur: unknown = data;
  let parent: Resolved['parent'] | null = null;
  let key: string | number = '';
  const canonical: string[] = [];
  let i = 0;
  while (i < segs.length) {
    if (cur === null || typeof cur !== 'object') return null;
    let matched = false;
    for (let j = i + 1; j <= segs.length && !matched; j++) {
      const k = segs.slice(i, j).join('.');
      if (Array.isArray(cur)) {
        const byId = cur.findIndex((e) => e && typeof e === 'object' && (e as { id?: unknown }).id === k);
        const idx = byId >= 0 ? byId : j === i + 1 && /^\d+$/.test(k) && Number(k) < cur.length ? Number(k) : -1;
        if (idx >= 0) {
          parent = cur as unknown as Resolved['parent'];
          key = idx;
          cur = cur[idx];
          canonical.push(k);
          i = j;
          matched = true;
        }
      } else if (Object.prototype.hasOwnProperty.call(cur, k)) {
        parent = cur as Resolved['parent'];
        key = k;
        cur = (cur as Record<string, unknown>)[k];
        canonical.push(k);
        i = j;
        matched = true;
      }
    }
    if (!matched) return null;
  }
  return parent ? { parent, key, value: cur, canonical } : null;
}

/** Like resolvePath, but an optional setting the data does not have yet resolves to its parent object with an undefined value. */
function resolveForPatch(data: unknown, path: string): Resolved | null {
  const found = resolvePath(data, path);
  if (found) return found;
  if (!fieldFor(path)?.optional) return null;
  const cut = path.lastIndexOf('.');
  const parent = cut > 0 ? resolvePath(data, path.slice(0, cut)) : null;
  if (!parent || !parent.value || typeof parent.value !== 'object' || Array.isArray(parent.value)) return null;
  const key = path.slice(cut + 1);
  return { parent: parent.value as Resolved['parent'], key, value: undefined, canonical: [...parent.canonical, key] };
}

/** Null when the patch is acceptable, otherwise the reason it is refused. */
export function validatePatch(data: GameData, p: DataPatch): string | null {
  const target = resolveForPatch(data, p.path);
  if (!target) return `unknown path ${p.path}`;
  const field = fieldFor(p.path);
  if (!field) return `${p.path} is not editable`;
  if (field.kind === 'boolean') return typeof p.value === 'boolean' ? null : `${p.path} must be yes or no (a boolean)`;
  if (field.kind === 'text') {
    if (typeof p.value !== 'string') return `${p.path} must be text (a name)`;
    if (p.value.length > field.max) return `${p.path} is too long (${field.max} characters at most)`;
    if (p.value.length < field.min) return `${p.path} cannot be empty`;
    if (!/^[A-Za-z0-9_.-]*$/.test(p.value)) return `${p.path} may only have letters, digits, _ . and -`;
    if (field.oneOf && !field.oneOf.includes(p.value)) return `${p.path} must be one of: ${field.oneOf.join(', ')}`;
    return null;
  }
  if (typeof p.value !== 'number') return `${p.path} must be a number`;
  if (!Number.isFinite(p.value)) return `${p.path} must be a finite number`;
  if (p.value < field.min || p.value > field.max) return `${p.path} must be between ${field.min} and ${field.max}${field.unit ? ` ${field.unit}` : ''}`;
  return null;
}

/** Applies the patches in order to a copy. `undo` applied to the result restores the original values. Throws on an invalid patch. */
export function applyPatches(data: GameData, patches: readonly DataPatch[]): { data: GameData; undo: DataPatch[] } {
  const out = structuredClone(data);
  const undo: DataPatch[] = [];
  for (const p of patches) {
    const err = validatePatch(out, p);
    if (err) throw new Error(`invalid patch ${p.path}: ${err}`);
    const t = resolveForPatch(out, p.path)!;
    undo.unshift({ path: p.path, value: (t.value ?? fieldFor(p.path)?.fallback ?? 0) as DataPatch['value'] });
    t.parent[t.key] = p.value;
  }
  return { data: out, undo };
}
