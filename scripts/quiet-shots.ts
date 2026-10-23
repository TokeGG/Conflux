// Pictures of the quiet rooms from the player's view: .superpowers/shots/quiet-<kind>-{entrance,stall}.png
// Usage: build the client, then npx tsx scripts/quiet-shots.ts
// The landing room's gates lead to a shop, a shrine and a rest room; a room with fewer than three exits hides the last, so other seeds are tried.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startSite } from './lib/shotsite.ts';

const out = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const site = await startSite();
const kinds: [string, number][] = [['shop', 0], ['shrine', 1], ['rest', 2]];
for (const [kind, gate] of kinds) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { page, errors } = await site.open(`?dev&seed=${seed}&jump=6:${gate}:400`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 120000 });
    await page.waitForSelector('#runscreen.open button.go', { timeout: 20000 });
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'doors' && (window as any).__conflux.tick > 5, null, { timeout: 90000 });
    const run = await page.evaluate(() => (window as any).__conflux.run());
    if (run.roomType !== kind) {
      await page.close();
      continue;
    }
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(out, `quiet-${kind}-entrance.png`) });
    const st = run.stalls[0];
    const snap = await page.evaluate(() => (window as any).__conflux.snapshot().players[0].pos);
    // stand 1.6 m from the stall, on the side of the entrance, and look at it
    const dx = snap.x - st.x;
    const dz = snap.z - st.z;
    const l = Math.hypot(dx, dz) || 1;
    await page.evaluate(([x, z]) => (window as any).__conflux.command({ op: 'teleport', x, z }), [st.x + (dx / l) * 1.6, st.z + (dz / l) * 1.6]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `quiet-${kind}-stall.png`) });
    console.log(kind, `seed ${seed}`, JSON.stringify({ type: run.roomType, wares: run.wares, stalls: run.stalls.length }), errors.length ? errors.slice(0, 2) : 'ok');
    await page.close();
    break;
  }
}
await site.close();
