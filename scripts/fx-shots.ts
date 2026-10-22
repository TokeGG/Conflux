// Screenshots of the persistent effects (dash fire, gust swirl, tornado). Browser smoke tests: serve client/dist, open it in the preinstalled Chromium (software GL) and check the real page.
// Usage: npm run build && npx tsx scripts/smoke.ts
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultData } from '@conflux/shared';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };

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

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

async function open(browser: Browser, url: string, init?: () => void): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url);
  return { page, errors };
}

const server = await serve();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
try {
  const { page, errors } = await open(browser, `${server.url}?dev&sandbox`);
  page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 200)));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  const run = (code: string) => page.evaluate(code);
  await run(`(() => { const c = window.__conflux; c.command({ op: 'spawn', enemy: 'enemy.dummy', count: 1, at: { x: 0, y: 0, z: -4 } }); c.command({ op: 'spawn', enemy: 'enemy.dummy', count: 1, at: { x: 3, y: 0, z: -1 } }); })()`);
  await page.waitForTimeout(800);
  // 1. a gusted enemy is wrapped in a swirl (aim at it and keep applying until the status shows)
  for (let i = 0; i < 20; i++) {
    await run(`(() => { const c = window.__conflux; const e = c.snapshot().enemies[0]; c.sendInput({ ...c.aimAt(e.pos.x, 0.9, e.pos.z) }); c.command({ op: 'applyStatus', id: 'gusted' }); })()`);
    await page.waitForTimeout(150);
    if (await run(`window.__conflux.snapshot().enemies[0].statuses.length > 0`)) break;
  }
  await page.waitForTimeout(500);
  console.log('gusted', await run(`JSON.stringify({ st: window.__conflux.snapshot().enemies.map((e) => [e.id, e.statuses]), fx: window.__conflux.fxActive() })`));
  await page.screenshot({ path: join(shots, 'fx-gusted.png') });
  // 2. a fire dash leaves ground fire along the path
  console.log('before', await run(`JSON.stringify(window.__conflux.snapshot().players[0].pos)`));
  await run(`(() => { const c = window.__conflux; c.sendInput({ buttons: 4, aimYaw: 0 }); })()`);
  await page.waitForTimeout(120);
  console.log('mid', await run(`JSON.stringify([window.__conflux.snapshot().players[0].pos, window.__conflux.snapshot().players[0].dodging, window.__conflux.events().map((e) => e.type)])`));
  await run(`window.__conflux.sendInput({})`);
  await page.waitForTimeout(700);
  console.log('dash', await run(`JSON.stringify({ zones: window.__conflux.snapshot().zones, fx: window.__conflux.fxActive(), cd: window.__conflux.snapshot().players[0].slots, pos: window.__conflux.snapshot().players[0].pos })`));
  await page.screenshot({ path: join(shots, 'fx-firedash.png') });
  // 3. fire on a gusted enemy: a big tornado that moves
  await run(`(() => { const c = window.__conflux; const e = c.snapshot().enemies[0]; c.sendInput({ ...c.aimAt(e.pos.x, 0.9, e.pos.z), buttons: 1 }); })()`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'fx-tornado-1.png') });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'fx-tornado-2.png') });
  console.log(await run(`JSON.stringify(window.__conflux.snapshot().zones)`), errors);
} finally {
  await browser.close();
  server.close();
}
