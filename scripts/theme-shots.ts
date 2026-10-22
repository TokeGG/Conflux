// Takes pictures of generated rooms, one set per theme: .superpowers/shots/theme-<theme>-<seed>-{view,overview}.png
// Usage: npm run build && npx tsx scripts/theme-shots.ts [seedsPerTheme=2]
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
const data = defaultData();
const per = Number(process.argv[2] ?? 2);
const seeds = [3, 8, 14, 21, 33, 40].slice(0, per);
for (const theme of Object.keys(data.themes)) {
  for (const seed of seeds) {
    const room = generateRoom(data, seed, 1, 0, theme).room;
    const [w, d] = room.size;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${url}?dev&theme=${theme}&seed=${seed}`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 120000 });
    await page.evaluate((spots) => {
      const c = (window as any).__conflux;
      c.command({ op: 'god', on: true });
      spots.slice(0, 3).forEach((s: { x: number; z: number }, i: number) => c.command({ op: 'spawn', enemy: ['enemy.skeleton', 'enemy.zombie', 'enemy.skeleton_mage'][i], count: 1, at: { x: s.x, y: 0, z: s.z } }));
    }, room.spawns.enemies);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: join(out, `theme-${theme}-${seed}-view.png`) });
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
await browser.close();
server.close();
