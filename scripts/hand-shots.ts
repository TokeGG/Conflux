// Screenshots of the player mid-cast from the side and from behind, with the hand position read out, to check spells leave the hand.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && npx tsx scripts/hand-shots.ts [clip]
import { startSite } from './lib/shotsite.ts';

const site = await startSite();
const clip = process.argv[2] ?? 'cast_1h_magic_attack_02';
try {
  const { page } = await site.open('?dev&sandbox');
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  await page.evaluate(`window.__conflux.lamp(true)`);
  const p = JSON.parse((await page.evaluate(`JSON.stringify(window.__conflux.snapshot().players[0].pos)`)) as string);
  await page.evaluate(`window.__conflux.pose('idle', '${clip}', 1, 0)`);
  await page.waitForTimeout(1500);
  for (const [name, c] of [
    ['side', [p.x - 3, 1.2, p.z]],
    ['behind', [p.x, 1.6, p.z - 3]],
    ['front', [p.x + 0.5, 1.4, p.z + 3]],
  ] as const) {
    await page.evaluate(`window.__conflux.lookFrom(${c[0]}, ${c[1]}, ${c[2]}, ${p.x}, 1.0, ${p.z})`);
    await page.waitForTimeout(600);
    console.log(name, await page.evaluate(`JSON.stringify(window.__conflux.boneLocal('FistR'))`));
    await page.screenshot({ path: `.superpowers/shots/hand-${name}.png` });
  }
} finally {
  await site.close();
}
