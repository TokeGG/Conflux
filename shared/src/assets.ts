// The asset manifest: logical ids (model.golem, fx.fireball_travel, clip.wizardpack.idle ...) mapped to files per render profile,
// each tied to the licence entry that covers it. The sim's data only ever names ids.

export interface AssetEntry {
  id: string;
  /** Render profile id to a path relative to the assets folder. */
  files: Record<string, string>;
  /** The `path` of the covering entry in licenses.json, or GENERATED_LICENCE for our own index files. */
  licence: string;
}

export interface LicenceEntry {
  path: string;
  title: string;
  author: string;
  license: string;
  verified: boolean;
  source?: string;
  note?: string;
}

/** Our own generated data files carry no third-party licence. */
export const GENERATED_LICENCE = 'generated';
export const DEFAULT_PROFILE = 'chunky';

export function resolveAsset(manifest: readonly AssetEntry[], id: string, profile: string): string {
  const a = manifest.find((m) => m.id === id);
  if (!a) throw new Error(`unknown asset ${id}`);
  const file = a.files[profile] ?? a.files[DEFAULT_PROFILE];
  if (!file) throw new Error(`asset ${id} has no file for profile ${profile}`);
  return file;
}

/** The path prefixes a licence entry covers: comma lists and one {a,b} group are expanded. */
export function licencePrefixes(path: string): string[] {
  return path
    .split(/,\s*(?![^{]*\})/)
    .flatMap((p) => {
      const m = /^(.*)\{([^}]*)\}(.*)$/.exec(p.trim());
      return m ? m[2].split(',').map((x) => m[1] + x.trim() + m[3]) : [p.trim()];
    })
    .filter(Boolean);
}

export function licenceCovers(entry: LicenceEntry, file: string): boolean {
  return licencePrefixes(entry.path).some((p) => file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export interface LicenceReport {
  /** Asset ids whose licence entry is not verified. */
  unverified: string[];
  /** Asset ids with no licence entry at all. */
  missing: string[];
}

export function licenceReport(manifest: readonly AssetEntry[], licences: readonly LicenceEntry[]): LicenceReport {
  const byPath = new Map(licences.map((l) => [l.path, l]));
  const report: LicenceReport = { unverified: [], missing: [] };
  for (const a of manifest) {
    if (a.licence === GENERATED_LICENCE) continue;
    const l = byPath.get(a.licence);
    if (!l) report.missing.push(a.id);
    else if (!l.verified) report.unverified.push(a.id);
  }
  return report;
}
