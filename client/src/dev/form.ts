// Turns a part of the game data into form rows: every value the catalogue lets you edit, with its label, unit and bounds.
import { fieldFor, resolvePath, type DataPatch, type GameData } from '@conflux/shared';

export interface FormRow {
  path: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  boolean: boolean;
  /** The value in use now (a tried edit shows here). */
  value: number | boolean;
  /** The value in the data files. */
  fileValue: number | boolean;
}

export interface FormGroup {
  /** The part of the entry the rows belong to ("shape", "cast"), or the entry's own name for its top-level values. */
  title: string;
  rows: FormRow[];
}

const isLeaf = (v: unknown): v is number | boolean => typeof v === 'number' || typeof v === 'boolean';

function walk(value: unknown, path: string, rel: string[], out: { path: string; rel: string[]; value: number | boolean }[]): void {
  if (isLeaf(value)) {
    out.push({ path, rel, value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}.${i}`, [...rel, String(i)], out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, [...rel, k], out);
  }
}

/** The editable values under `root`, grouped by the part of the entry they sit in. `base` is the file's data (defaults to `data`). */
export function buildForm(data: GameData, root: string, base: GameData = data): FormGroup[] {
  const at = resolvePath(data, root);
  if (!at) return [];
  const leaves: { path: string; rel: string[]; value: number | boolean }[] = [];
  walk(at.value, root, [], leaves);
  const groups = new Map<string, FormRow[]>();
  for (const leaf of leaves) {
    const info = fieldFor(leaf.path);
    if (!info) continue;
    const file = resolvePath(base, leaf.path)?.value;
    const title = leaf.rel.length > 1 ? leaf.rel.slice(0, -1).join('.') : root.split('.').slice(-2).join('.');
    const row: FormRow = {
      path: leaf.path,
      label: info.label,
      unit: info.unit,
      min: info.min,
      max: info.max,
      step: info.step,
      boolean: info.kind === 'boolean',
      value: leaf.value,
      fileValue: isLeaf(file) ? file : leaf.value,
    };
    (groups.get(title) ?? groups.set(title, []).get(title)!).push(row);
  }
  return [...groups].map(([title, rows]) => ({ title, rows }));
}

export const rowIsChanged = (r: FormRow): boolean => r.value !== r.fileValue;

/** What the box says, as a patch. A string comes back when the text is not a number. Bounds are checked when the patch is staged. */
export function patchFor(row: FormRow, raw: string | number | boolean): DataPatch | string {
  if (row.boolean) return { path: row.path, value: raw === true || raw === 'true' || raw === 1 || raw === '1' };
  if (typeof raw === 'string' && raw.trim() === '') return `${row.label} needs a number`;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return `${row.label} needs a number`;
  return { path: row.path, value: n };
}
