// Writes shared/data/pieces.json: the bounds of every kit piece the room generator may place, taken from the environment index, so the
// generator (which runs in the sim's worker) needs no access to the art files. Usage: npx tsx scripts/gen-pieces.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvIndex } from '../shared/src/room.ts';

/** Every piece any theme recipe names (themes.json may only use these). */
export const USED_PIECES: Record<string, string[]> = {
  dungeon: ['template-floor', 'template-floor-detail', 'template-floor-detail-a', 'template-wall', 'template-wall-detail-a', 'template-wall-corner', 'template-wall-half', 'template-corner', 'gate', 'gate-metal-bars', 'gate-door', 'template-floor-layer', 'template-floor-layer-raised'],
  graveyard: ['coffin', 'coffin-old', 'crypt-small', 'crypt-a', 'crypt-b', 'gravestone-bevel', 'gravestone-broken', 'gravestone-cross', 'gravestone-cross-large', 'gravestone-round', 'gravestone-wide', 'gravestone-debris', 'gravestone-decorative', 'urn-round', 'urn-square', 'debris', 'debris-wood', 'pillar-square', 'pillar-large', 'pillar-small', 'pillar-obelisk', 'column-large', 'altar-stone', 'candle', 'candle-multiple', 'fire-basket', 'lantern-candle', 'stone-wall', 'stone-wall-column', 'rocks', 'rocks-tall', 'trunk', 'shovel-dirt', 'crypt-large'],
  cave: ['template-floor', 'template-floor-detail', 'template-floor-detail-a', 'template-wall', 'template-wall-detail-a', 'template-wall-corner', 'gate', 'gate-metal-bars', 'gate-rock'],
  minidungeon: ['barrel', 'chair', 'chest', 'column', 'pot', 'table', 'banner', 'wood-structure', 'wood-support', 'stones', 'rocks', 'trap'],
  forest: ['tree', 'tree-high', 'plant', 'rocks-high', 'rocks-low', 'stones', 'fence', 'tent', 'flag', 'patch-grass', 'patch-dirt'],
  nature: ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_tallA', 'rock_tallC', 'rock_tallF', 'rock_tallI', 'rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_smallF', 'stone_smallA', 'mushroom_tanTall', 'mushroom_redGroup', 'mushroom_tanGroup', 'stump_old', 'log'],
};

export type PieceBounds = Record<string, Record<string, { size: [number, number, number]; min: [number, number, number] }>>;

const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;

export function buildPieces(index: EnvIndex): PieceBounds {
  const out: PieceBounds = {};
  for (const [kit, ids] of Object.entries(USED_PIECES)) {
    out[kit] = {};
    for (const id of ids) {
      const item = index[kit]?.items.find((i) => i.id === id);
      if (!item) throw new Error(`the environment index has no ${kit}/${id}`);
      out[kit][id] = { size: item.size.map(r3) as [number, number, number], min: item.min.map(r3) as [number, number, number] };
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = JSON.parse(readFileSync(new URL('../client/public/assets/env/index.json', import.meta.url), 'utf8')) as EnvIndex;
  writeFileSync(new URL('../shared/data/pieces.json', import.meta.url), JSON.stringify(buildPieces(index), null, 1) + '\n');
  console.log('wrote shared/data/pieces.json');
}
