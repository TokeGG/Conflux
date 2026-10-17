// Licence gate. Warn mode (default) prints what is unverified and succeeds; enforce mode (LICENSE_GATE=enforce) fails the build.
// It must be switched on before any public release.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { licenceReport, type AssetEntry, type LicenceEntry } from '../shared/src/assets.ts';

const defaultDir = fileURLToPath(new URL('../client/public/assets/', import.meta.url));

export function checkLicences(mode: 'warn' | 'enforce', root: string = defaultDir, log: (m: string) => void = console.warn): number {
  const manifest: AssetEntry[] = JSON.parse(readFileSync(join(root, 'assets.json'), 'utf8'));
  const licences: LicenceEntry[] = JSON.parse(readFileSync(join(root, 'licenses.json'), 'utf8')).entries;
  const r = licenceReport(manifest, licences);
  const byLicence = new Map<string, number>();
  const bump = (id: string) => {
    const key = manifest.find((a) => a.id === id)!.licence;
    byLicence.set(key, (byLicence.get(key) ?? 0) + 1);
  };
  r.unverified.forEach(bump);
  if (r.unverified.length) {
    log(`licences: ${r.unverified.length} assets are not verified yet:`);
    for (const [k, n] of byLicence) log(`  - ${k} (${n})`);
  }
  if (r.missing.length) log(`licences: ${r.missing.length} assets have no licence entry (first: ${r.missing.slice(0, 5).join(', ')})`);
  const bad = r.unverified.length + r.missing.length;
  if (mode === 'enforce' && bad > 0) {
    log('LICENSE_GATE=enforce: failing the build.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(checkLicences(process.env.LICENSE_GATE === 'enforce' ? 'enforce' : 'warn'));
}
