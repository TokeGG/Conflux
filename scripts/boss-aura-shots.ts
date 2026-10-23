// Takes pictures of each boss standing in a dark arena room with its aura on: .superpowers/shots/aura-<boss>-<view>.png
// Usage: build the client, then npx tsx scripts/boss-aura-shots.ts [boss ids...]   (THEME=arena SEED=3 to change the room)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultData, generateRoom } from '@conflux/shared';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const out = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let f = join(dist, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const browser = await chromium.launch({ executablePath: join(root, readdirSync(root).find((d) => d.startsWith('chromium-'))!, 'chrome-linux/chrome'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const theme = process.env.THEME ?? 'arena';
const seed = Number(process.env.SEED ?? 3);
const bosses = process.argv.slice(2).length ? process.argv.slice(2) : ['boss.reaper', 'boss.maw'];
const room = generateRoom(defaultData(), seed, 1, 0, theme).room;
const spot = room.spawns.enemies[0];
for (const boss of bosses) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?dev&theme=${theme}&seed=${seed}`);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 120000 });
  await page.evaluate(([b, s]) => {
    const c = (window as any).__conflux;
    c.command({ op: 'god', on: true });
    c.command({ op: 'spawn', enemy: b, count: 1, at: { x: s.x, y: 0, z: s.z } });
  }, [boss, spot] as const);
  await page.waitForTimeout(5000);
  // the player's own view first, then a close three-quarter view and a wide one
  await page.screenshot({ path: join(out, `aura-${boss.replace(/[^a-z]+/g, '-')}-player.png`) });
  for (const [name, dist, height] of [['near', 7, 2.4], ['wide', 13, 4.5]] as const) {
    await page.evaluate(([s, d, h]) => {
      const c = (window as any).__conflux;
      c.lookFrom(s.x - d * 0.8, h, s.z - d * 0.6, s.x, 1.8, s.z);
    }, [spot, dist, height] as const);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `aura-${boss.replace(/[^a-z]+/g, '-')}-${name}.png`) });
  }
  console.log(boss, theme, seed, errors.length ? errors.slice(0, 2) : 'ok', 'lights', await page.evaluate(() => (window as any).__conflux.lights()));
  await page.close();
}
await browser.close();
server.close();
