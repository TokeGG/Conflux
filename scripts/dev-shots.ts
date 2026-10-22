// Screenshots of every dev panel page (npm run build first). Browser smoke tests: serve client/dist, open it in the preinstalled Chromium (software GL) and check the real page.
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
  const { page } = await open(browser, `${server.url}?dev&sandbox`);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.keyboard.press('F2');
  await page.waitForSelector('#devpanel', { state: 'visible', timeout: 5000 });
  const names = await page.$$eval('#devpanel nav button', (bs) => bs.map((b) => b.textContent?.trim() ?? ''));
  for (const name of names) {
    await page.click(`#devpanel nav button:text-is("${name}")`);
    await page.waitForTimeout(600);
    const file = `devpanel-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    await page.screenshot({ path: join(shots, file) });
    console.log(file);
  }
} finally {
  await browser.close();
  server.close();
}
