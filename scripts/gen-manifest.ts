// Builds client/public/assets/assets.json from the files on disk and licenses.json.
// Usage: npx tsx scripts/gen-manifest.ts
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_PROFILE, GENERATED_LICENCE, licenceCovers, type AssetEntry, type LicenceEntry } from '../shared/src/assets.ts';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const slugPath = (p: string) => p.split('/').map(slug).join('.');

/** [pattern, id builder, generated?] in priority order. */
const RULES: [RegExp, (m: RegExpMatchArray) => string, boolean?][] = [
  [/^fx\/spellwoven\/fx\.json$/, () => 'data.fx', true],
  [/^env\/index\.json$/, () => 'data.env', true],
  [/^tex\/index\.json$/, () => 'data.tex', true],
  [/^clips\/([^/]+)\/index\.json$/, (m) => `data.clips.${m[1]}`, true],
  [/^models\/[^/]+\/([^/]+)\.glb$/, (m) => `model.${slug(m[1])}`],
  [/^fx\/spellwoven\/([^/]+)\.webp$/, (m) => `fx.${m[1]}`],
  [/^clips\/([^/]+)\/([^/]+)\.json$/, (m) => `clip.${m[1]}.${m[2]}`],
  [/^env\/([^/]+)\/([^/]+)\.glb$/, (m) => `env.${m[1]}.${slug(m[2])}`],
  [/^tex\/([^/]+)\/(.+)\.webp$/, (m) => `tex.${m[1]}.${slugPath(m[2])}`],
  [/^audio\/(.+)\.mp3$/, (m) => `audio.${slugPath(m[1])}`],
];

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

export function buildManifest(assetsDir: string): AssetEntry[] {
  const licences: LicenceEntry[] = JSON.parse(readFileSync(join(assetsDir, 'licenses.json'), 'utf8')).entries;
  const out: AssetEntry[] = [];
  const seen = new Map<string, string>();
  for (const abs of walk(assetsDir).sort()) {
    const rel = relative(assetsDir, abs).split(sep).join('/');
    for (const [re, id, generated] of RULES) {
      const m = re.exec(rel);
      if (!m) continue;
      const assetId = id(m);
      if (seen.has(assetId)) throw new Error(`duplicate asset id ${assetId}: ${seen.get(assetId)} and ${rel}`);
      seen.set(assetId, rel);
      const cover = generated ? undefined : licences.find((l) => licenceCovers(l, rel));
      out.push({ id: assetId, files: { [DEFAULT_PROFILE]: rel }, licence: generated ? GENERATED_LICENCE : cover ? cover.path : 'none' });
      break;
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const manifestText = (m: AssetEntry[]) => `[\n${m.map((e) => JSON.stringify(e)).join(',\n')}\n]\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = fileURLToPath(new URL('../client/public/assets/', import.meta.url));
  const m = buildManifest(dir);
  writeFileSync(join(dir, 'assets.json'), manifestText(m));
  console.log(`wrote ${m.length} assets`);
}
