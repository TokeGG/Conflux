// The export of custom mobs: one zip laid out like the repo (models, enemies, licences), so it can be handed over and added as files.
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import type { EnemyDef } from '@conflux/shared';

export interface Licence {
  author: string;
  licence: string;
  source: string;
  verified: false;
}

export interface ExportedMob {
  slug: string;
  glb: Uint8Array;
  enemy: EnemyDef;
  pools: string[];
  licence: Licence;
}

const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));

export function buildExportZip(mobs: ExportedMob[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const m of mobs) {
    files[`models/${m.slug}.glb`] = m.glb;
    files[`enemies/${m.slug}.json`] = json(m.enemy);
    files[`licenses/${m.slug}.json`] = json(m.licence);
    files[`pools/${m.slug}.json`] = json({ id: m.enemy.id, model: m.enemy.model, pools: m.pools });
  }
  return zipSync(files, { level: 0 });
}

/** Reads an export back (the same files the build step reads). */
export function readExportZip(zip: Uint8Array): ExportedMob[] {
  const files = unzipSync(zip);
  const out: ExportedMob[] = [];
  for (const path of Object.keys(files)) {
    const m = /^models\/(.+)\.glb$/.exec(path);
    if (!m) continue;
    const slug = m[1];
    const read = <T>(dir: string): T => JSON.parse(strFromU8(files[`${dir}/${slug}.json`]));
    out.push({ slug, glb: files[path], enemy: read<EnemyDef>('enemies'), licence: read<Licence>('licenses'), pools: read<{ pools: string[] }>('pools').pools });
  }
  return out;
}
