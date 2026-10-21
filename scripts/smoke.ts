// Browser smoke tests: serve client/dist, open it in the preinstalled Chromium (software GL) and check the real page.
// Usage: npm run build && npx tsx scripts/smoke.ts
import { chromium, type Browser, type Page } from 'playwright-core';
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
  // 1. the page boots, the worker answers, and something real is drawn
  {
    const { page, errors } = await open(browser, server.url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 0, null, { timeout: 20000 });
    check(true, 'worker round trip: a frame arrived after advance (tick > 0)');
    const colours: number = await page.evaluate(() => (window as any).__conflux.distinctColours());
    check(colours > 100, `the canvas shows more than 100 distinct colours (${colours})`);
    const info: { room: string; pieces: number } = await page.evaluate(() => ({ room: (window as any).__conflux.room, pieces: (window as any).__conflux.pieces }));
    check(info.room === 'forest_clearing' && info.pieces > 30, `the forest clearing is in the scene (${info.room}, ${info.pieces} pieces)`);
    await page.screenshot({ path: join(shots, 'smoke-boot.png') });
    check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 2. no WebGL 2: a readable message instead of a blank page
  {
    const { page } = await open(browser, server.url, () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      (HTMLCanvasElement.prototype as any).getContext = function (type: string, ...a: unknown[]) {
        return type === 'webgl2' ? null : (orig as any).call(this, type, ...a);
      };
    });
    await page.waitForSelector('#fatal', { timeout: 15000 });
    const text = await page.innerText('#fatal');
    check(/WebGL 2/.test(text), `without WebGL 2 the page says so ("${text.slice(0, 60)}")`);
    await page.close();
  }
  // 3. no Web Workers
  {
    const { page } = await open(browser, server.url, () => {
      delete (window as any).Worker;
    });
    await page.waitForSelector('#fatal', { timeout: 15000 });
    check(/Web Workers/.test(await page.innerText('#fatal')), 'without Web Workers the page says so');
    await page.close();
  }
  // 4. the dev panel: absent without ?dev; with ?dev F2 opens it, the performance page samples while open and stops when closed
  {
    const { page } = await open(browser, server.url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    check((await page.locator('#devpanel').count()) === 0, 'there is no dev panel without ?dev');
    await page.keyboard.press('F2');
    check((await page.locator('#devpanel').count()) === 0, 'F2 does nothing without ?dev');
    await page.close();
  }
  {
    const { page, errors } = await open(browser, `${server.url}?dev`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.keyboard.press('F2');
    await page.waitForSelector('#devpanel', { state: 'visible', timeout: 5000 });
    check(true, 'F2 opens the dev panel');
    await page.click('#devpanel nav button:has-text("Performance")');
    await page.waitForFunction(() => /\d/.test(document.querySelector('#perf-fps')?.textContent ?? ''), null, { timeout: 8000 });
    const fps = await page.innerText('#perf-fps');
    check(true, `the performance page shows a frame rate (${fps.trim()})`);
    check((await page.evaluate(() => (window as any).__confluxDev.sampling)) === true, 'sampling is on while the page is open');
    const report: string = await page.evaluate(() => (window as any).__confluxDev.report());
    check(/GPU: .+/.test(report) && /Draw calls: \d+/.test(report) && /Average: [\d.]+ fps/.test(report), 'the report has the GPU, draw calls and fps');
    await page.screenshot({ path: join(shots, 'smoke-dev.png') });
    await page.keyboard.press('F2');
    await page.waitForSelector('#devpanel', { state: 'hidden', timeout: 5000 });
    check((await page.evaluate(() => (window as any).__confluxDev.sampling)) === false, 'closing the panel stops the sampling');
    check(errors.length === 0, `no console errors with the panel${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 4b. editing a number in the panel reaches the running sim, shows in Changes, and undoes
  {
    const { page, errors } = await open(browser, `${server.url}?dev`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 20000 });
    await page.keyboard.press('F2');
    await page.click('#devpanel nav button:has-text("Skills")');
    await page.selectOption('#skills-pick', 'fire.fireball');
    const row = '#skills-rows [data-path="skills.fire.fireball.damage"] input';
    await page.waitForSelector(row, { timeout: 5000 });
    check((await page.locator('#skills-rows .dev-file').first().innerText()).startsWith('file:'), 'each row shows the file\'s value');
    const before: number = await page.evaluate(() => (window as any).__conflux.tick);
    await page.waitForTimeout(400);
    const after: number = await page.evaluate(() => (window as any).__conflux.tick);
    check(after === before, `the sim is paused while a data page is open (${before} to ${after})`);
    await page.fill(row, '50');
    await page.press(row, 'Tab');
    await page.click('#devpanel button:has-text("Try now")');
    check(/in use/i.test(await page.innerText('#dev-msg')), 'Try now reports the edit in use');
    check((await page.locator('#devpanel button:has-text("Changes (1)")').count()) === 1, 'Changes (1) lists the edit');
    await page.click('#devpanel nav button:has-text("Run tools")');
    await page.click('#tool-spawn');
    await page.keyboard.press('F2');
    await page.waitForFunction(() => (window as any).__conflux.snapshot()?.enemies.length === 1, null, { timeout: 8000 });
    check(true, 'the dummy spawned at the crosshair');
    await page.evaluate(() => (window as any).__conflux.sendInput({ buttons: 1 }));
    await page.waitForFunction(() => ((window as any).__conflux.snapshot()?.enemies[0]?.hp ?? 1000) < 1000, null, { timeout: 8000 });
    await page.evaluate(() => (window as any).__conflux.sendInput({ buttons: 0 }));
    const hp: number = await page.evaluate(() => (window as any).__conflux.snapshot().enemies[0].hp);
    check(hp === 950, `the next cast used the edited damage (1000 - ${1000 - hp})`);
    await page.keyboard.press('F2');
    await page.click('#devpanel button:has-text("Changes (1)")');
    await page.click('#devpanel .dev-change button:has-text("Undo")');
    check((await page.locator('#devpanel button:has-text("Changes (0)")').count()) === 1, 'Undo puts the value back');
    await page.click('#devpanel nav button:has-text("Animation viewer")');
    await page.waitForFunction(() => /clips/.test(document.querySelector('#viewer-status')?.textContent ?? ''), null, { timeout: 20000 });
    await page.selectOption('#viewer-clip', 'loco_standing_run_forward');
    await page.selectOption('#viewer-archetype', 'throw');
    await page.fill('#viewer-seek', '0.4');
    await page.waitForTimeout(300);
    check((await page.innerText('#viewer-status')).includes('model.wizardpack'), 'the animation viewer loads a model and its clips');
    await page.screenshot({ path: join(shots, 'dev-viewer.png') });
    check(errors.length === 0, `no console errors while editing${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 5a. the HUD: crosshair, element, three skills, health, and the tags above an enemy
  {
    const { page, errors } = await open(browser, server.url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#hud .slot').length === 3 && /\d/.test(document.querySelector('#hud .hp .txt')?.textContent ?? ''), null, { timeout: 10000 });
    check((await page.locator('#hud .crosshair').count()) === 1, 'the crosshair is drawn');
    const names = await page.locator('#hud .slot .name').allInnerTexts();
    check(names.join('|') === 'Fireball|Flame Cone|Flame Dash', `the three fire skills are shown (${names.join(', ')})`);
    check((await page.locator('#hud .element.on').innerText()).includes('Fire'), 'the held element is highlighted');
    await page.evaluate(() => (window as any).__conflux.hudDemo(true));
    await page.waitForSelector('#hud .tag .ico', { timeout: 5000 });
    check((await page.locator('#hud .tag .ico').count()) === 3, 'an enemy tag shows an icon for each status and mark');
    check((await page.locator('#hud .crosshair.hot').count()) === 1, 'the crosshair highlights an aimed enemy');
    await page.screenshot({ path: join(shots, 'hud.png') });
    check(errors.length === 0, `the HUD draws without console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 5. the player body: standing, running and casting render and animate without errors
  {
    const { page, errors } = await open(browser, server.url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    const pose = (state: string, cast: string | null, w: number, pitch: number) => page.evaluate(([a, b, c, d]) => (window as any).__conflux.pose(a, b, c, d), [state, cast, w, pitch] as const);
    await page.evaluate(() => (window as any).__conflux.frontView());
    await pose('idle', null, 0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'player-idle.png') });
    await pose('run_forward', null, 0, 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(shots, 'player-run.png') });
    await pose('run_forward', 'cast_1h_magic_attack_02', 1, 0.3);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'player-cast-run.png') });
    await pose('idle', 'cast_2h_magic_attack_01', 1, -0.3);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'player-cast-idle.png') });
    await page.evaluate(async () => {
      const c = (window as any).__conflux;
      await Promise.all(['fx.fireball_impact', 'fx.steam_puff', 'fx.burning_ground'].map((id) => c.playFx(id)));
    });
    await page.waitForTimeout(350);
    const live: number = await page.evaluate(() => (window as any).__conflux.fxActive());
    check(live >= 2, `effects play and are pooled (${live} live)`);
    await page.screenshot({ path: join(shots, 'player-fx.png') });
    check(errors.length === 0, `the player stands, runs and casts without console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures > 0) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('smoke passed');
