// Screenshots of the element effects: fire dash ground fire, lightning chain through Soaked dummies, and a few reactions.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && npx tsx scripts/element-shots.ts
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const server = await serve();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
try {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}?dev&sandbox`);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  const run = (code: string) => page.evaluate(code);
  const snap = (what: string) => run(`JSON.stringify(${what})`);
  // 1. fire dash: hold UTIL, re-sent every 100 ms
  await run(`window.__conflux.command({ op: 'setElement', i: 0 })`);
  await page.waitForTimeout(300);
  console.log('before', await snap(`[window.__conflux.snapshot().players[0].pos, window.__conflux.snapshot().players[0].element, window.__conflux.snapshot().players[0].statuses]`));
  for (let i = 0; i < 7; i++) {
    await run(`window.__conflux.sendInput({ buttons: 4, aimYaw: 0 })`);
    await page.waitForTimeout(100);
  }
  await run(`window.__conflux.sendInput({ aimYaw: Math.PI })`);
  console.log('dash', await snap(`{ pos: window.__conflux.snapshot().players[0].pos, zones: window.__conflux.snapshot().zones, fx: window.__conflux.fxActive() }`));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'el-firedash.png') });
  // 2. lightning chain through three soaked dummies
  await run(`(() => { const c = window.__conflux; c.sendInput({ aimYaw: 0 }); c.command({ op: 'killAll' }); for (const [x, z] of [[0, 6], [3, 8], [-3, 8]]) c.command({ op: 'spawnDummy', status: 'soaked', at: { x, y: 0, z } }); c.command({ op: 'setElement', i: 4 }); })()`);
  await page.waitForTimeout(500);
  console.log('lightning slots', await snap(`window.__conflux.snapshot().players[0].slots.map((s) => s.skillId)`));
  await run(`(() => { const c = window.__conflux; const e = c.snapshot().enemies[0]; c.sendInput({ ...c.aimAt(e.pos.x, 0.9, e.pos.z), buttons: 1 }); })()`);
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(shots, 'el-chain-a.png') });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(shots, 'el-chain-b.png') });
  await run(`window.__conflux.sendInput({})`);
  console.log('chain', await snap(`window.__conflux.snapshot().enemies.map((e) => [e.hp, e.statuses.map((s) => s.id)])`));
  // 3. reactions by dev command
  for (const [a, b, name] of [['fire', 'dark', 'hellfire'], ['wind', 'dark', 'vacuum'], ['earth', 'light', 'crystal']] as const) {
    await run(`(() => { const c = window.__conflux; c.sendInput({ aimYaw: 0 }); c.command({ op: 'killAll' }); c.command({ op: 'tryReaction', a: '${a}', b: '${b}' }); })()`);
    await page.waitForTimeout(450);
    console.log(name, await snap(`{ fx: window.__conflux.fxActive(), zones: window.__conflux.snapshot().zones.length }`));
    await page.screenshot({ path: join(shots, `el-react-${name}.png`) });
  }
  console.log(errors);
} finally {
  await browser.close();
  server.close();
}
