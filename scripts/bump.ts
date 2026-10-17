// Release bump: patch number +1 in the root and client package.json, README line 1, and a new top entry in shared/data/patches.json.
// Usage: npm run bump -- "What changed, in plain words."  (owner and dev tools are never listed in patch notes)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function nextVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a version: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

const setVersion = (raw: string, v: string) => raw.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`);

/** Applies the bump under `root` and returns the new version. Computes everything before writing, so a failure changes nothing. */
export function applyBump(root: string, note: string, now: Date): string {
  const text = note.trim();
  if (!text) throw new Error('a note is required');
  const file = (p: string) => join(root, p);
  const rootRaw = readFileSync(file('package.json'), 'utf8');
  const clientRaw = readFileSync(file('client/package.json'), 'utf8');
  const readme = readFileSync(file('README.md'), 'utf8');
  const patches = JSON.parse(readFileSync(file('shared/data/patches.json'), 'utf8')) as unknown[];
  const next = nextVersion(JSON.parse(rootRaw).version);
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  patches.unshift({ version: next, date: iso.slice(0, 10), at: iso, notes: [text] });
  const lines = readme.split('\n');
  lines[0] = `# Conflux · v${next}`;
  writeFileSync(file('package.json'), setVersion(rootRaw, next));
  writeFileSync(file('client/package.json'), setVersion(clientRaw, next));
  writeFileSync(file('README.md'), lines.join('\n'));
  writeFileSync(file('shared/data/patches.json'), JSON.stringify(patches, null, 2) + '\n');
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const note = process.argv.slice(2).join(' ');
  try {
    console.log(`bumped to ${applyBump(process.cwd(), note, new Date())}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
