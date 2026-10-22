// Screenshots of every player-facing screen (npm run build first): main menu, HUD in a fight with a status, boss bar, Esc menu
// (controls and crosshair tabs), reward with an element tooltip, gate signs, the death screen, and phone-sized versions.
// Usage: npx tsx scripts/ui-shots.ts   -> .superpowers/shots/ui-*.png
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomIcon } from '../client/src/hud/icons.ts';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };

function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end('not found');
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
const browser: Browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
const errors: string[] = [];
const open = async (url: string, w = 1280, h = 720): Promise<Page> => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  return page;
};
const snap = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: join(shots, `ui-${name}.png`), timeout: 120000 });
  console.log(`shot ui-${name}.png`);
};
const c = (page: Page, fn: string) => page.evaluate(fn);
try {
  // main menu, desktop and phone
  for (const [w, h, tag] of [[1280, 720, 'desktop'], [390, 844, 'phone']] as const) {
    const page = await open(`${server.url}?seed=1`, w, h);
    await page.waitForSelector('#runscreen.open button.go', { timeout: 20000 });
    await page.waitForTimeout(2500);
    await snap(page, `menu-${tag}`);
    await page.close();
  }
  // HUD in a fight with a status on an enemy and on you, a boss bar, damage numbers
  {
    const page = await open(`${server.url}?sandbox`);
    await page.evaluate(() => {
      const k = (window as any).__conflux;
      k.command({ op: 'spawnDummy', status: 'burning', at: { x: 0, y: 0, z: -4 } });
      k.command({ op: 'spawn', enemy: 'boss.reaper', count: 1, at: { x: 5, y: 0, z: -9 } });
      k.command({ op: 'applyStatus', id: 'soaked' });
      k.command({ op: 'god', on: true });
      k.sendInput(k.aimAt(0, 0.9, -4));
    });
    await page.waitForSelector('#hud .tag .ico', { timeout: 15000 });
    await page.waitForSelector('#hud .crosshair.hot', { timeout: 15000 });
    await page.evaluate(() => (window as any).__conflux.sendInput({ ...(window as any).__conflux.aimAt(0, 0.9, -4), buttons: 1 }));
    await page.waitForTimeout(700);
    await snap(page, 'hud-fight');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await snap(page, 'hud-phone');
    await page.close();
  }
  // Esc menu in a run: controls, then the crosshair tab
  {
    const page = await open(`${server.url}?dev&seed=1`);
    await page.waitForSelector('#runscreen.open button.go');
    await page.waitForTimeout(500);
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#escmenu.open');
    await snap(page, 'esc-controls');
    await page.click('#escmenu .etab:has-text("Crosshair")');
    await page.fill('#escmenu .xh-num >> nth=0', '40');
    await page.dispatchEvent('#escmenu .xh-num >> nth=0', 'change');
    await page.selectOption('#escmenu select', 'crossdot');
    await snap(page, 'esc-crosshair');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await snap(page, 'esc-crosshair-phone');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press('Escape');
    // gate signs
    await page.evaluate(() => (window as any).__conflux.command({ op: 'killAll' }));
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'doors', null, { timeout: 60000 });
    const g = await page.evaluate(() => (window as any).__conflux.run().gates[0]);
    // the real signs hang over gates in the 3D room; the screenshot places the same markup (copied from a live sign) side by side
    const icons = Object.fromEntries(['fight', 'elite', 'boss', 'shop', 'shrine', 'rest'].map((k) => [k, `<span class="ico-svg">${roomIcon(k)}</span>`]));
    await page.evaluate((icons) => {
      const kinds: [string, string, string][] = [['fight', 'Crypt', 'Reward: a skill'], ['elite', 'Elite Chapel', 'Reward: an augment'], ['boss', 'Boss: Library', 'Reward: an element'], ['shop', 'Shop', 'Spend your souls'], ['shrine', 'Shrine', 'One free boon'], ['rest', 'Rest', 'Heal for free']];
      const hud = document.getElementById('hud')!;
      kinds.forEach(([k, t, sub], i) => {
        const d = document.createElement('div');
        d.className = `gate ${k}`;
        d.style.cssText = `left:${(i % 3) * 30 + 20}%;top:${i < 3 ? 40 : 65}%`;
        d.innerHTML = `${icons[k]}<div class="gtext"><div class="t">${t}</div><div class="s">${sub}</div></div>`;
        hud.append(d);
      });
    }, icons);
    await page.waitForTimeout(300);
    await snap(page, 'gates');
    // reward with an element card: roll rooms until one offers an element (every third room), else take the first screen
    await page.evaluate((p) => (window as any).__conflux.command({ op: 'teleport', x: p.x, z: p.z }), g);
    await page.waitForSelector('#runscreen.open button.card', { timeout: 90000 });
    await snap(page, 'reward');
    await page.close();
  }
  // a reward screen with an element card and its tooltip: the third room offers one
  {
    const page = await open(`${server.url}?dev&seed=1`);
    await page.waitForSelector('#runscreen.open button.go');
    await page.waitForTimeout(500);
    await page.click('#runscreen button.go');
    for (let room = 0; room < 3; room++) {
      await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
      await page.evaluate(() => (window as any).__conflux.command({ op: 'killAll' }));
      await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'doors', null, { timeout: 60000 });
      const g = await page.evaluate(() => (window as any).__conflux.run().gates[0]);
      await page.evaluate((p) => (window as any).__conflux.command({ op: 'teleport', x: p.x, z: p.z }), g);
      await page.waitForSelector('#runscreen.open button.card', { timeout: 90000 });
      if (room === 2) break;
      await page.click('#runscreen button.card >> nth=0');
    }
    const el = page.locator('#runscreen button.card.element');
    if ((await el.count()) > 0) await el.first().hover();
    await page.waitForTimeout(300);
    await snap(page, 'reward-element-tooltip');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await snap(page, 'reward-phone');
    await page.close();
  }
  // the death screen: reapers around a player who is not a god
  {
    const page = await open(`${server.url}?dev&seed=3`);
    await page.waitForSelector('#runscreen.open button.go');
    await page.waitForTimeout(500);
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting', null, { timeout: 90000 });
    await page.evaluate(() => {
      const k = (window as any).__conflux;
      k.command({ op: 'spawn', enemy: 'boss.reaper', count: 8, at: { x: k.snapshot().players[0].pos.x, y: 0, z: k.snapshot().players[0].pos.z } });
    });
    await page.waitForSelector('#runscreen.open h1', { timeout: 240000 });
    await page.waitForTimeout(600);
    await snap(page, 'death');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await snap(page, 'death-phone');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
