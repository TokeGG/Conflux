// Takes a picture of every enemy in the game, one at a time in the dungeon hall, and joins them into one contact sheet:
// .superpowers/shots/roster-sheet.png. Usage: npm run build && npx tsx scripts/roster-sheet.ts
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultData } from '@conflux/shared';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let f = join(dist, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
});
import { statSync } from 'node:fs';
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const exe = join(root, readdirSync(root).find((d) => d.startsWith('chromium-'))!, 'chrome-linux/chrome');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const data = defaultData();
const ids = Object.keys(data.enemies).filter((id) => id !== 'enemy.dummy');
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
await page.goto(`${url}?dev&room=dungeon_hall`);
await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 90000 });
await page.evaluate(() => {
  const c = (window as any).__conflux;
  c.command({ op: 'god', on: true });
  c.command({ op: 'pause', on: true });
  document.getElementById('hud')?.setAttribute('style', 'display:none');
  document.querySelector('button[title], .dev-toggle')?.setAttribute('style', 'display:none');
});
const tiles: { input: Buffer; left: number; top: number }[] = [];
const cols = 6;
for (const [i, id] of ids.entries()) {
  const e = data.enemies[id];
  const top = Math.max(...e.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r)) * e.scale;
  await page.evaluate(() => {
    (window as any).__conflux.command({ op: 'killAll' });
    (window as any).__conflux.command({ op: 'step', n: 2 });
  });
  await page.waitForTimeout(1100);
  await page.evaluate(([enemy, h]) => {
    const c = (window as any).__conflux;
    c.command({ op: 'spawn', enemy, count: 1, at: { x: 0, y: 0, z: 3 } });
    c.command({ op: 'step', n: 4 });
    c.lookFrom(h * 0.55, h * 0.75 + 0.4, 3 + h * 2.1 + 2, 0, h * 0.45, 3);
  }, [id, top] as const);
  await page.waitForFunction((n) => (window as any).__conflux.enemyViews() >= 1, 1, { timeout: 60000 });
  await page.waitForTimeout(900);
  tiles.push({ input: await page.screenshot(), left: (i % cols) * 320, top: Math.floor(i / cols) * 340 });
  console.log(id);
}
const rows = Math.ceil(ids.length / cols);
const sheet = await sharp({ create: { width: cols * 320, height: rows * 340, channels: 3, background: '#05060a' } })
  .composite(
    await Promise.all(
      tiles.map(async (t, i) => {
        const label = Buffer.from(`<svg width="320" height="22"><text x="160" y="16" font-size="15" fill="#cdd5f0" text-anchor="middle" font-family="sans-serif">${data.enemies[ids[i]].name}</text></svg>`);
        const img = await sharp(t.input).resize(320, 320).toBuffer();
        return [{ input: img, left: t.left, top: t.top }, { input: label, left: t.left, top: t.top + 318 }];
      }),
    ).then((x) => x.flat()),
  )
  .png()
  .toFile(join(shots, 'roster-sheet.png'));
await browser.close();
server.close();
console.log('wrote roster-sheet.png');
