// Measures where the hands (FistR, FistL) are, in metres forward / right (character's right) / up of the player's feet, along each cast clip, so player.json's castOrigin can be set from the model.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && npx tsx scripts/hand-measure.ts
import { startSite } from './lib/shotsite.ts';

const site = await startSite();
try {
  const { page } = await site.open('?dev&sandbox');
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  for (const clip of ['cast_1h_magic_attack_02', 'cast_2h_magic_attack_01', 'cast_two_hand_spell_casting', 'cast_magic_spell_casting', 'cast_1h_cast_spell_01']) {
    console.log(clip);
    for (let t = 0; t < 1.5; t += 0.1) {
      const r = JSON.parse((await page.evaluate(`JSON.stringify({ R: window.__conflux.boneAtClip('FistR', '${clip}', ${t}), L: window.__conflux.boneAtClip('FistL', '${clip}', ${t}) })`)) as string);
      const f = (b: any) => `${b.forward.toFixed(2)} ${b.right.toFixed(2)} ${b.up.toFixed(2)}`;
      console.log(`  t=${t.toFixed(1)} R(f r u) ${f(r.R)}   L ${f(r.L)}`);
    }
  }
} finally {
  await site.close();
}
