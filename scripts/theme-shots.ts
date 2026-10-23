// Takes pictures of generated rooms, one set per theme: .superpowers/shots/theme-<theme>-<seed>-{view,overview}.png
// Usage: build the client, then npx tsx scripts/theme-shots.ts [seedsPerTheme=2] [theme,theme,...]
// `view` is the player's own camera at the start of the room; `overview` a camera high above it.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultData, generateRoom } from '@conflux/shared';
import { startSite } from './lib/shotsite.ts';

const out = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const site = await startSite();
const data = defaultData();
const per = Number(process.argv[2] ?? 2);
const only = process.argv[3]?.split(',');
const seeds = [3, 8, 14, 21, 33, 40].slice(0, per);
for (const theme of Object.keys(data.themes)) {
  if (only && !only.includes(theme)) continue;
  for (const seed of seeds) {
    const room = generateRoom(data, seed, 1, 0, theme).room;
    const [w, d] = room.size;
    const { page, errors } = await site.open(`?dev&theme=${theme}&seed=${seed}`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 120000 });
    await page.evaluate((spots) => {
      const c = (window as any).__conflux;
      c.command({ op: 'god', on: true });
      spots.slice(0, 3).forEach((s: { x: number; z: number }, i: number) => c.command({ op: 'spawn', enemy: ['enemy.skeleton', 'enemy.zombie', 'enemy.skeleton_mage'][i], count: 1, at: { x: s.x, y: 0, z: s.z } }));
    }, room.spawns.enemies);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: join(out, `theme-${theme}-${seed}-view.png`) });
    // the player's eye: just behind the start spot, looking at the middle of the room
    const sp = room.spawns.player;
    const len = Math.hypot(sp.x, sp.z) || 1;
    await page.evaluate(([x, z, l]) => (window as any).__conflux.lookFrom(x + (x / l) * 2.2, 2.4, z + (z / l) * 2.2, -x * 0.3, 1.2, -z * 0.3), [sp.x, sp.z, len]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `theme-${theme}-${seed}-eye.png`) });
    await page.evaluate(([w, d]) => {
      const c = (window as any).__conflux;
      c.lamp(true);
      c.lookFrom(0, Math.max(w, d) * 1.5, -d * 0.75, 0, 0, d * 0.05);
    }, [w, d]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `theme-${theme}-${seed}-overview.png`) });
    console.log(theme, seed, `${room.pieces.length} pieces, ${room.lights!.length} lights`, errors.length ? errors.slice(0, 2) : 'ok');
    await page.close();
  }
}
await site.close();
