// Regenerates shared/data/fxIds.json (the logical effect ids) from the Spellwoven manifest.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const fx: { effects: { id: string }[] } = JSON.parse(readFileSync(new URL('client/public/assets/fx/spellwoven/fx.json', root), 'utf8'));
const ids = fx.effects.map((e) => `fx.${e.id}`).sort();
writeFileSync(new URL('shared/data/fxIds.json', root), JSON.stringify(ids, null, 2) + '\n');
console.log(`wrote ${ids.length} effect ids`);
