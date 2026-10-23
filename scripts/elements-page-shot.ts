// Screenshot of the dev panel's Elements page with a reaction picked and tried. Run after building the client.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = process.env.DIST ?? fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end('not found');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/?dev&sandbox`;
const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const exe = process.env.CHROMIUM ?? join(root, readdirSync(root).find((d) => d.startsWith('chromium-'))!, 'chrome-linux/chrome');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.click('#devbtn');
  await page.waitForSelector('#devpanel', { state: 'visible', timeout: 20000 });
  await page.click('#devpanel nav button:text-is("Elements")');
  await page.click('.el-cell[data-a="fire"][data-b="dark"]');
  console.log('cells', await page.$$eval('.el-cell[data-id]', (c) => c.length), 'param rows', await page.$$eval('#el-params .dev-row', (c) => c.length));
  await page.click('#el-try');
  await page.waitForTimeout(2500);
  console.log('enemies', await page.evaluate(() => (window as any).__conflux.snapshot().enemies.length), await page.evaluate(() => JSON.stringify((window as any).__conflux.snapshot().enemies[0]?.statuses)));
  await page.screenshot({ path: join(shots, 'el-devpage.png') });
  console.log(errors);
} finally {
  await browser.close();
  server.close();
}
