// Copies the converted assets from a staging folder into the repo (idempotent). The raw downloads are never imported.
// Usage: npx tsx scripts/import-staging.ts <stagingDir>
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** [path inside staging, path inside the repo] */
export const KEEP: [string, string][] = [
  ['models', 'client/public/assets/models'],
  ['clips', 'client/public/assets/clips'],
  ['fx/spellwoven', 'client/public/assets/fx/spellwoven'],
  ['env/forest', 'client/public/assets/env/forest'],
  ['env/dungeon', 'client/public/assets/env/dungeon'],
  ['env/graveyard', 'client/public/assets/env/graveyard'],
  ['env/nature', 'client/public/assets/env/nature'],
  ['env/index.json', 'client/public/assets/env/index.json'],
  ['tex/sbs128', 'client/public/assets/tex/sbs128'],
  ['tex/sbs256', 'client/public/assets/tex/sbs256'],
  ['tex/index.json', 'client/public/assets/tex/index.json'],
  ['audio', 'client/public/assets/audio'],
  ['licenses.json', 'client/public/assets/licenses.json'],
  ['README.md', 'client/public/assets/README.md'],
  ['scripts', 'scripts/convert'],
];

export function importStaging(staging: string, repo = root): string[] {
  const copied: string[] = [];
  for (const [from, to] of KEEP) {
    const src = join(staging, from);
    if (!existsSync(src)) throw new Error(`staging is missing ${from}`);
    mkdirSync(dirname(join(repo, to)), { recursive: true });
    cpSync(src, join(repo, to), { recursive: true });
    copied.push(to);
  }
  return copied;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npx tsx scripts/import-staging.ts <stagingDir>');
    process.exit(2);
  }
  console.log(`imported ${importStaging(resolve(dir)).length} entries`);
}
