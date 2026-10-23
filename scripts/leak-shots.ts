// Leaking effects: swap to the time element several times, change room, and count what is still drawn.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && [DIST=<dir>] npx tsx scripts/leak-shots.ts [prefix]
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = process.env.DIST ?? fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const prefix = process.argv[2] ?? 'leak';

function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() })));
}

function chromiumPath(): string {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  if (!dir) throw new Error(`no chromium under ${root}`);
  return join(root, dir, 'chrome-linux/chrome');
}

const server = await serve();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
try {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}?dev&seed=3`);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForSelector('#runscreen.open button.go', { timeout: 60000 });
  await page.click('#runscreen button.go');
  await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
  const run = (code: string) => page.evaluate(code);
  await run(`window.__conflux.command({ op: 'killAll' })`);
  // swap to the time element and back, stepping away each time, so the swap effects are left in a row along the floor
  const start = (await run(`(() => { const p = window.__conflux.snapshot().players[0].pos; return JSON.stringify({ x: p.x, z: p.z }); })()`)) as string;
  const o = JSON.parse(start) as { x: number; z: number };
  // the death effects of the cleared room play out first (the headless renderer is slow, and effect time is capped per frame)
  await page.waitForFunction(() => (window as any).__conflux.fxActive() === 0, null, { timeout: 90000 });
  // the swap effect of the time element (fx.arcane_portal, a looping sheet), as the game spawns it for an event: no follow
  for (let i = 0; i < 3; i++) {
    await run(`window.__conflux.playFx('fx.arcane_portal')`);
    await page.waitForTimeout(400);
  }
  const lookBack = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      await run(`(() => { const c = window.__conflux; c.sendInput(c.aimAt(${o.x} - 0.6, 1.0, ${o.z} + 0.8)); })()`);
      await page.waitForTimeout(100);
    }
  };
  await lookBack(500);
  await page.waitForTimeout(300);
  console.log('after the swaps, fx drawn:', await run(`JSON.stringify(window.__conflux.fxIds())`));
  await page.screenshot({ path: join(shots, `${prefix}-1-after-swaps.png`) });
  await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'doors', null, { timeout: 60000 });
  await run(`(() => { const c = window.__conflux; const g = c.run().gates[0]; c.command({ op: 'teleport', x: g.x, z: g.z }); })()`);
  await page.waitForSelector('#runscreen.open button.card', { timeout: 90000 });
  await page.click('#runscreen button.card >> nth=0');
  await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting', null, { timeout: 90000 });
  await page.waitForTimeout(700);
  await lookBack(500);
  console.log('in the next room, fx drawn:', await run(`JSON.stringify(window.__conflux.fxIds())`), 'room', await run(`window.__conflux.room`));
  await page.screenshot({ path: join(shots, `${prefix}-2-next-room.png`) });
  console.log(errors);
} finally {
  await browser.close();
  server.close();
}
