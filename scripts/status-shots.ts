// Screenshots of the status looks on a mob (tint pulse plus sheet effects) and of the time-element swap leaving nothing behind.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && npx tsx scripts/status-shots.ts [enemy.id] [prefix]
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const enemy = process.argv[2] ?? 'enemy.skeleton';
const prefix = process.argv[3] ?? 'st';

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
  await page.goto(`${server.url}?dev&theme=crypt&seed=3`);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  const run = (code: string) => page.evaluate(code);
  const hold = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      await run(`(() => { const c = window.__conflux; const en = c.snapshot().enemies; const e = en[en.length - 1]; if (e) c.sendInput(c.aimAt(e.pos.x, 1.0, e.pos.z)); })()`);
      await page.waitForTimeout(100);
    }
  };
  const statuses = (process.env.STATUSES ?? 'burning,soaked,rocked,poisoned,shocked,cursed,exposed,rent,dilated,gusted').split(',').filter((x) => x && !process.env.REACTIONS);
  for (const st of statuses) {
    await run(`(() => { const c = window.__conflux; c.command({ op: 'killAll' }); c.command({ op: 'teleport', x: 0, z: -2 }); c.sendInput({ aimYaw: 0 }); c.command({ op: 'spawn', enemy: '${enemy}', count: 1, at: { x: 0, y: 0, z: 1.6 } }); })()`);
    await hold(600);
    for (let k = 0; k < 20; k++) {
      await run(`window.__conflux.command({ op: 'applyStatus', id: '${st}' })`);
      await hold(200);
      if (await run(`window.__conflux.snapshot().enemies.some((e) => e.statuses.some((s) => s.id === '${st}'))`)) break;
    }
    await hold(900);
    console.log(st, await run(`JSON.stringify(window.__conflux.snapshot().enemies.map((e) => e.statuses.map((s) => s.id)))`), 'fx', await run(`window.__conflux.fxActive()`));
    await page.screenshot({ path: join(shots, `${prefix}-${st}.png`), clip: { x: 320, y: 120, width: 640, height: 400 } });
  }
  // ground effects of reactions: REACTIONS=water:earth:mud,fire:water:steam
  for (const r of (process.env.REACTIONS ?? '').split(',').filter(Boolean)) {
    const [a, b, name] = r.split(':');
    await run(`(() => { const c = window.__conflux; c.command({ op: 'killAll' }); c.command({ op: 'teleport', x: 0, z: -2 }); c.sendInput({ aimYaw: 0 }); c.command({ op: 'tryReaction', a: '${a}', b: '${b}' }); })()`);
    await page.waitForTimeout(1500);
    console.log(name, 'fx', await run(`JSON.stringify(window.__conflux.fxIds())`));
    await page.screenshot({ path: join(shots, `${prefix}-react-${name}.png`), clip: { x: 220, y: 100, width: 840, height: 520 } });
  }
  // the time element's swap effect, several times, then another room
  await run(`window.__conflux.command({ op: 'killAll' })`);
  for (let i = 0; i < 6; i++) {
    await run(`window.__conflux.command({ op: 'setElement', i: ${i % 2 ? 9 : 0} })`);
    await page.waitForTimeout(250);
  }
  await run(`window.__conflux.command({ op: 'setElement', i: 9 })`);
  await page.waitForTimeout(400);
  console.log('after swaps fx', await run(`window.__conflux.fxActive()`));
  await page.screenshot({ path: join(shots, `${prefix}-swaps.png`) });
  await page.waitForTimeout(2200);
  console.log('2.2 s later fx', await run(`window.__conflux.fxActive()`));
  await page.screenshot({ path: join(shots, `${prefix}-swaps-later.png`) });
  console.log(errors);
} finally {
  await browser.close();
  server.close();
}
