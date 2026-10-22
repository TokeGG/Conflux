// Makes the undead mobs' model files from the Kenney graveyard characters: one self-contained GLB each (texture embedded), with only
// the clips the game plays. Usage: npx tsx scripts/make-kenney-mobs.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const KEEP = new Set(['idle', 'walk', 'attack-melee-right', 'attack-melee-left', 'die']);
const io = new NodeIO();
const at = (rel: string) => fileURLToPath(new URL(`../client/public/assets/${rel}`, import.meta.url));
for (const name of ['skeleton', 'zombie', 'vampire', 'ghost', 'keeper']) {
  const doc = await io.read(at(`env/graveyard/character-${name}.glb`));
  for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName())) a.dispose();
  await doc.transform(prune());
  const glb = await io.writeBinary(doc);
  writeFileSync(at(`models/enemies/${name}.glb`), glb);
  console.log(`${name}: ${doc.getRoot().listAnimations().length} clips, ${(glb.length / 1e3).toFixed(0)} kB`);
}
