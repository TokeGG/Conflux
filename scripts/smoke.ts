// Browser smoke tests: serve client/dist, open it in the preinstalled Chromium (software GL) and check the real page.
// Usage: npm run build && npx tsx scripts/smoke.ts
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultData } from '@conflux/shared';
import { createApi } from '../api/src/handler.ts';
import { MemoryStore } from '../api/src/store.ts';

// the account API runs in-process (the Pages Function's twin, memory store); pages opened with ?dev are signed in as the owner
const OWNER_CODE = 'smoke-owner-code';
const api = createApi({ store: new MemoryStore(), env: { OWNER_CODE, OWNER_NAMES: 'smokeowner' } });
const apiCall = async (path: string, body: unknown): Promise<any> => (await api(new Request(`http://x.test/api/${path}`, { method: 'POST', body: JSON.stringify(body) }))).json();
const ownerToken: string = (await apiCall('register', { name: 'smokeowner', password: 'smoke-password-1', code: OWNER_CODE })).token;

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };

function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    if ((req.url ?? '').startsWith('/api/')) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await api(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === 'GET' || !chunks.length ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
      return;
    }
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
  // the dev panel is for accounts with dev access: pages that ask for ?dev are signed in as the owner
  if (/[?&]dev\b/.test(url)) await page.addInitScript((t) => localStorage.setItem('conflux.token', t), ownerToken);
  await page.goto(url);
  return { page, errors };
}

const server = await serve();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(shots, { recursive: true });
try {
  // 1. the page boots, the worker answers, and something real is drawn
  {
    const { page, errors } = await open(browser, `${server.url}?sandbox`);
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
    const { page } = await open(browser, `${server.url}?sandbox`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    check((await page.locator('#devpanel').count()) === 0, 'there is no dev panel without ?dev');
    await page.keyboard.press('F2');
    check((await page.locator('#devpanel').count()) === 0, 'F2 does nothing without ?dev');
    await page.close();
  }
  // 4a. accounts: a guest has no dev panel, ?dev alone does nothing in a production build, signing in as the owner brings the panel and the Admin page
  {
    const { page, errors } = await open(browser, server.url);
    await page.waitForSelector('#runscreen.open button.go', { timeout: 60000 });
    await page.waitForSelector('#accountchip');
    check((await page.innerText('#accountchip')) === 'Sign in', 'a guest on a server with accounts sees a Sign in chip');
    check((await page.locator('#devbtn').count()) === 0, 'a guest has no dev tools button');
    await page.click('#accountchip');
    await page.screenshot({ path: join(shots, 'account-signin.png') });
    await page.click('#acct-swap');
    await page.fill('#acct-name', 'smokeowner');
    await page.fill('#acct-pass', 'smoke-password-2');
    await page.fill('#acct-code', 'wrong');
    await page.click('#acct-go');
    await page.waitForFunction(() => /reserved/.test(document.querySelector('#acct-msg')?.textContent ?? ''));
    check(true, 'a reserved name is refused without the owner code');
    await page.fill('#acct-name', 'Visitor');
    await page.fill('#acct-code', '');
    await Promise.all([page.waitForEvent('load'), page.click('#acct-go')]);
    await page.waitForSelector('#accountchip');
    await page.waitForFunction(() => document.querySelector('#accountchip')?.textContent === 'Visitor');
    check((await page.locator('#devbtn').count()) === 0, 'a plain account has no dev tools button');
    await page.close();
    const g = await open(browser, `${server.url}?dev&sandbox`, undefined);
    await g.page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    check((await g.page.locator('#devbtn').count()) === 1, 'the owner token brings the dev tools button');
    await g.page.keyboard.press('F2');
    await g.page.waitForSelector('#devpanel:not([hidden])');
    check((await g.page.locator('#devpanel .dev-nav button:text-is("Admin")').count()) === 1, 'the owner sees the Admin page');
    await g.page.click('#devpanel .dev-nav button:text-is("Admin")');
    await g.page.waitForSelector('#admin-accounts .dev-row');
    check((await g.page.locator('#admin-accounts .dev-row').count()) >= 2, 'the Admin page lists the accounts');
    await g.page.screenshot({ path: join(shots, 'account-admin.png') });
    check(g.errors.length === 0, 'the owner session has no console errors');
    await g.page.close();
  }
  {
    const { page, errors } = await open(browser, `${server.url}?dev&sandbox`);
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
    const { page, errors } = await open(browser, `${server.url}?dev&sandbox`);
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
    await page.waitForFunction(() => (window as any).__conflux.snapshot()?.enemies.length === 1, null, { timeout: 40000 });
    check(true, 'the dummy spawned at the crosshair');
    await page.evaluate(() => (window as any).__conflux.sendInput({ buttons: 1 }));
    await page.waitForFunction(() => ((window as any).__conflux.snapshot()?.enemies[0]?.hp ?? 1000) < 1000, null, { timeout: 40000 });
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
  // 4c. M1 exit: the owner's combo against two training dummies, with scripted inputs (water on A, earth on B, fire on A, wind on B)
  {
    const { page, errors } = await open(browser, `${server.url}?dev&sandbox`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 20000 });
    // plain JavaScript in a string: tsx would add helpers to a function that the browser cannot resolve
    const comboScript = `(async () => {
      const c = window.__conflux;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, what) => {
        for (let i = 0; i < 1500; i++) {
          if (f()) return;
          await sleep(20);
        }
        throw new Error('timed out waiting for ' + what);
      };
      const A = { x: -5, y: 0, z: 5 };
      const B = { x: 5, y: 0, z: 5 };
      c.command({ op: 'spawn', enemy: 'enemy.dummy', count: 1, at: A });
      c.command({ op: 'spawn', enemy: 'enemy.dummy', count: 1, at: B });
      await until(() => c.snapshot()?.enemies.length === 2, 'two dummies');
      const [a, b] = c.snapshot().enemies.map((e) => e.id);
      const enemy = (id) => c.snapshot().enemies.find((e) => e.id === id);
      const has = (id, status) => !!enemy(id)?.statuses.some((s) => s.id === status);
      const look = (p, extra = {}) => c.sendInput({ ...c.aimAt(p.x, 0.9, p.z), ...extra });
      const swap = async (to, name, at) => {
        look(at, { swapTo: to });
        await until(() => c.snapshot().players[0].element === name, 'the ' + name + ' element');
        look(at);
      };
      await swap(1, 'water', A);
      look(A, { buttons: 1 });
      await until(() => has(a, 'soaked'), 'A soaked');
      await swap(2, 'earth', B);
      look(B, { buttons: 1 });
      await until(() => has(b, 'rocked'), 'B rocked');
      await swap(0, 'fire', A);
      look(A, { buttons: 1 });
      await until(() => c.events().some((e) => e.type === 'reaction' && e.enemyId === a), 'steam on A');
      look(B); // stop casting at A and aim at B before the element changes
      c.command({ op: 'setElement', i: 3 }); // wind is on the bench: the dev tool puts it in the slot held
      await until(() => c.snapshot().players[0].element === 'wind', 'the wind element');
      look(B, { buttons: 1 });
      await until(() => c.events().some((e) => e.type === 'reaction' && e.enemyId === b), 'sandstorm on B');
      c.sendInput(null);
      return c.events().filter((e) => e.type === 'reaction').map((e) => ({ id: e.id, effect: e.effect }));
    })()`;
    const reactions: { id: string; effect: string }[] = await page.evaluate(comboScript);
    check((await page.evaluate(() => (window as any).__conflux.damageShown())) > 0, 'damage numbers floated up from the hits');
    check(reactions.length >= 2 && reactions[0].effect === 'steam' && reactions[1].effect === 'sandstorm', `the combo gives Steam then Sandstorm (${reactions.map((r) => r.effect).join(', ')})`);
    await page.screenshot({ path: join(shots, 'combo.png') });
    check(errors.length === 0, `no console errors during the combo${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 4d. every enemy of the roster spawns through the dev tool, loads its model and renders without console errors
  {
    const { page, errors } = await open(browser, `${server.url}?dev&room=dungeon_hall`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 20000 });
    const ids = Object.keys(defaultData().enemies).filter((id) => id !== 'enemy.dummy');
    await page.evaluate((list) => {
      const c = (window as any).__conflux;
      c.command({ op: 'god', on: true });
      list.forEach((enemy: string, i: number) => c.command({ op: 'spawn', enemy, count: 1, at: { x: -7.5 + (i % 6) * 3, y: 0, z: -3.5 + Math.floor(i / 6) * 3.8 } }));
      c.command({ op: 'pause', on: true });
      c.command({ op: 'step', n: 3 });
    }, ids);
    await page.waitForFunction((n) => (window as any).__conflux.enemyViews() === n, ids.length, { timeout: 60000 });
    check(true, `all ${ids.length} roster enemies loaded their models`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(shots, 'roster.png') });
    await page.evaluate(() => (window as any).__conflux.lookFrom(0, 7.5, 13, 0, 0.8, 2.5));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(shots, 'roster-lineup.png') });
    check(errors.length === 0, `the roster renders without console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 4e. upload a model in the panel, make it a mob, spawn it, and find it still saved after a reload
  {
    const { page, errors } = await open(browser, `${server.url}?dev&sandbox`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.keyboard.press('F2');
    await page.click('#devpanel nav button:has-text("Models and mobs")');
    await page.setInputFiles('#mob-file', fileURLToPath(new URL('../client/test/fixtures/cube.glb', import.meta.url)));
    await page.waitForSelector('#mob-report', { timeout: 15000 });
    check(/12/.test(await page.innerText('#mob-report')), 'the report shows the uploaded cube (12 triangles)');
    await page.fill('#mob-name', 'Smoke Cube');
    await page.click('#mob-prepare');
    await page.waitForSelector('#mob-spawn', { timeout: 15000 });
    await page.selectOption('#mob-element', 'earth');
    await page.click('#mob-spawn');
    await page.waitForFunction(() => (window as any).__conflux.snapshot()?.enemies.some((e: any) => e.defId === 'enemy.custom.smoke_cube'), null, { timeout: 15000 });
    check(true, 'Spawn now puts the custom mob in the game');
    await page.waitForFunction(() => (window as any).__conflux.enemyViews() === 1, null, { timeout: 15000 });
    check(true, 'the custom mob is drawn from its uploaded model');
    check((await page.locator('#devpanel button:has-text("Changes (")').innerText()).includes('(1)'), 'the new mob is listed in Changes');
    await page.reload();
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.keyboard.press('F2');
    await page.click('#devpanel nav button:has-text("Models and mobs")');
    await page.waitForSelector('#mob-list [data-id="enemy.custom.smoke_cube"]', { timeout: 10000 });
    check(true, 'after a reload the mob is still listed');
    await page.click('#mob-list [data-id="enemy.custom.smoke_cube"] button:has-text("Spawn")');
    await page.waitForFunction(() => (window as any).__conflux.enemyViews() === 1, null, { timeout: 15000 });
    check(true, 'and it spawns again from the saved model');
    await page.click('#mob-list [data-id="enemy.custom.smoke_cube"] .mob-delete');
    await page.waitForFunction(() => !document.querySelector('#mob-list [data-id="enemy.custom.smoke_cube"]'), null, { timeout: 10000 });
    check(true, 'delete removes it');
    check(errors.length === 0, `no console errors while adding a mob${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 4f. every room template loads and draws
  for (const id of ['forest_grove', 'forest_trail', 'dungeon_hall', 'dungeon_crypt', 'dungeon_ruins']) {
    const { page, errors } = await open(browser, `${server.url}?room=${id}`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    const shown: string = await page.evaluate(() => (window as any).__conflux.room);
    const colours: number = await page.evaluate(() => (window as any).__conflux.distinctColours());
    await page.screenshot({ path: join(shots, `room-${id}.png`) });
    check(shown === id && colours > 100 && errors.length === 0, `${id} loads and draws (${colours} colours${errors.length ? `, errors: ${errors.join(' | ').slice(0, 200)}` : ''})`);
    await page.close();
  }
  // 5a. the HUD: crosshair, element, three skills, health, and the tags above an enemy
  {
    const { page, errors } = await open(browser, `${server.url}?sandbox`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#hud .slot').length === 3 && /\d/.test(document.querySelector('#hud .hp .txt')?.textContent ?? ''), null, { timeout: 10000 });
    check((await page.locator('#hud .crosshair').count()) === 1, 'the crosshair is drawn');
    const names = await page.locator('#hud .slot .name').allInnerTexts();
    check(names.join('|') === 'Fireball|Flame Cone|Flame Dash', `the three fire skills are shown (${names.join(', ')})`);
    check((await page.locator('#hud .element.on').innerText()).includes('Fire'), 'the held element is highlighted');
    await page.evaluate(() => {
      const c = (window as any).__conflux;
      c.command({ op: 'spawnDummy', status: 'burning', at: { x: 0, y: 0, z: -4 } });
      c.sendInput(c.aimAt(0, 0.9, -4));
    });
    await page.waitForSelector('#hud .tag .ico', { timeout: 15000 });
    check((await page.locator('#hud .tag .ico').count()) === 1, 'an enemy tag shows an icon for its status');
    await page.waitForSelector('#hud .crosshair.hot', { timeout: 15000 });
    check(true, 'the crosshair highlights the enemy under it');
    await page.screenshot({ path: join(shots, 'hud.png') });
    check(errors.length === 0, `the HUD draws without console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 5. the player body: standing, running and casting render and animate without errors
  {
    const { page, errors } = await open(browser, `${server.url}?sandbox`);
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
  // 6. the run flow: begin, clear a room, pick a reward, pick a door, fight the next room
  {
    const { page, errors } = await open(browser, `${server.url}?seed=1`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForSelector('#runscreen.open button.go', { timeout: 20000 });
    check(true, 'a normal visit opens the run start screen');
    check(String(await page.evaluate(() => (window as any).__conflux.room)).startsWith('gen_'), 'the main menu opens on one of the generated dark rooms, not the old outdoor one');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(shots, 'menu.png') });
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
    check(true, 'beginning the run puts the first room fight on screen');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#escmenu.open', { timeout: 10000 });
    check((await page.locator('#escmenu .keybtn').count()) === 12, 'Esc opens the menu with all 12 keys listed');
    await page.screenshot({ path: join(shots, 'esc-menu.png') });
    await page.click('#escmenu .keybtn >> nth=4');
    await page.keyboard.press('KeyX');
    check((await page.locator('#escmenu .keybtn >> nth=4').innerText()) === 'X', 'clicking a key and pressing another rebinds it');
    await page.click('#escmenu .etab:has-text("Game")');
    check((await page.locator('#escmenu input[type=range]').count()) === 2, 'the Game tab has mouse speed and field of view');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__conflux.menuOpen(), null, { timeout: 5000 });
    check(true, 'Esc closes the menu again');
    await page.evaluate(() => (window as any).__conflux.command({ op: 'killAll' }));
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'doors', null, { timeout: 60000 });
    const gates: number = await page.evaluate(() => (window as any).__conflux.run().gates.length);
    check(gates >= 1 && gates <= 3, `clearing the room opens its gates at once (${gates})`);
    check((await page.locator('#runscreen.open').count()) === 0, 'no screen covers the room while the gates are open');
    await page.screenshot({ path: join(shots, 'run-doors.png') });
    await page.evaluate(() => {
      const c = (window as any).__conflux;
      const g = c.run().gates[0];
      c.command({ op: 'teleport', x: g.x, z: g.z });
    });
    await page.waitForSelector('#runscreen.open button.card', { timeout: 90000 });
    const offers: number = await page.locator('#runscreen button.card').count();
    check(offers === 3, `the reward is offered at the entrance of the next room (${offers})`);
    check((await page.evaluate(() => (window as any).__conflux.run()?.roomIndex)) === 1, 'the reward screen is in room 2');
    await page.screenshot({ path: join(shots, 'run-reward.png') });
    const tickAtReward: number = await page.evaluate(() => (window as any).__conflux.tick);
    await page.waitForTimeout(700);
    check((await page.evaluate(() => (window as any).__conflux.tick)) === tickAtReward, 'the game is paused while the reward is chosen');
    const locksBefore: number = await page.evaluate(() => (window as any).__conflux.lockRequests());
    await page.click('#runscreen button.card >> nth=0');
    check((await page.evaluate(() => (window as any).__conflux.lockRequests())) > locksBefore, 'picking a reward asks for the mouse again');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
    check(true, 'picking starts the room with its enemies');
    const run: { tuned: boolean; unlocked: string[]; counters: Record<string, number> } = await page.evaluate(() => (window as any).__conflux.run());
    check(run.tuned, 'a dev command marks the run tuned');
    check((run.counters['rooms.cleared'] ?? 0) === 0, 'a tuned run records nothing in the ledger');
    const saved: string | null = await page.evaluate(() => localStorage.getItem('conflux.ledger'));
    check(saved !== null, 'the ledger is saved in local storage');
    check(errors.length === 0, `the run flow has no console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 7. M3 acceptance: the bot plays a run in the browser: clears room 1, takes a reward, reaches room 2, with no console errors
  {
    const { page, errors } = await open(browser, `${server.url}?dev&seed=1`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
    await page.evaluate(() => (window as any).__conflux.command({ op: 'bot', on: true }));
    await page.waitForFunction(() => (window as any).__conflux.run()?.screen === 'reward', null, { timeout: 400000, polling: 1000 });
    check(true, 'the bot cleared room 1, walked out through a gate and the reward opened at the entrance of room 2');
    await page.evaluate(() => (window as any).__conflux.command({ op: 'bot', on: false }));
    await page.click('#runscreen button.card >> nth=0');
    await page.waitForFunction(() => (window as any).__conflux.run()?.roomIndex === 1 && (window as any).__conflux.run()?.phase === 'fighting', null, { timeout: 90000 });
    check(true, 'a reward later the run is fighting in room 2');
    check(errors.length === 0, `the bot-driven run has no console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 8. the main menu: patch notes without owner or dev tool entries, and the credits
  {
    const { page, errors } = await open(browser, server.url);
    await page.waitForSelector('#runscreen.open button.go', { timeout: 60000 });
    check((await page.locator('#invert-y, #dev-tools').count()) === 0, 'the start page has no invert or developer options');
    await page.click('#runscreen button:text-is("Patch notes")');
    await page.waitForSelector('#runscreen .scroll');
    const notes: string = await page.locator('#runscreen .scroll').innerText();
    check(/v0\.1\.\d+/.test(notes) && !/dev panel|dev tool|owner/i.test(notes), 'the patch notes list versions and no owner or dev tool entries');
    await page.click('#runscreen button:text-is("Back")');
    await page.click('#runscreen button:text-is("Credits")');
    await page.waitForFunction(() => /by .*CC-BY/.test(document.querySelector('#runscreen .scroll')?.textContent ?? ''), null, { timeout: 20000 });
    check(true, 'the credits list the CC-BY assets with their authors');
    await page.click('#runscreen button:text-is("Back")');
    const daily: string = await page.locator('#runscreen button.daily').innerText();
    check(/daily run/i.test(daily) && /today: \w+, \w+, \w+/i.test(daily), `the menu offers the daily run with its three elements (${daily.replace(/\n/g, ' | ')})`);
    await page.click('#runscreen button.daily');
    await page.waitForFunction(() => (window as any).__conflux.run()?.phase === 'fighting' && (window as any).__conflux.snapshot()?.enemies.length > 0, null, { timeout: 90000 });
    const held: string[] = await page.evaluate(() => (window as any).__conflux.snapshot().players[0].equipped);
    check(held.length === 3 && new Set(held).size === 3, `the daily run starts holding three elements (${held.join(', ')})`);
    check(errors.length === 0, `the menu pages have no console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 9. generated rooms: each theme loads, is lit by at most the torch and eight room lights, and renders without console errors
  for (const theme of ['crypt', 'hall', 'cave', 'cellar', 'grove', 'library', 'chapel']) {
    const { page, errors } = await open(browser, `${server.url}?dev&theme=${theme}&seed=3`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 120000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const lit: number = await page.evaluate(() => (window as any).__conflux.lights());
    check(lit >= 4 && lit <= 8, `the ${theme} room is lit by the torch and ${lit - 1} room lights (eight lights in all)`);
    const colours: number = await page.evaluate(() => (window as any).__conflux.distinctColours());
    check(colours > 150, `the ${theme} room draws more than 150 distinct colours (${colours})`);
    await page.screenshot({ path: join(shots, `smoke-theme-${theme}.png`) });
    check(errors.length === 0, `the ${theme} room renders without console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
    await page.close();
  }
  // 10. a shop room (?dev&jump=<room>:<gate>:<souls>): wares, souls, a purchase, the gate signs, the depth counter
  {
    const { page, errors } = await open(browser, `${server.url}?dev&seed=1&jump=6:0:400`);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForSelector('#runscreen.open button.go', { timeout: 20000 });
    await page.click('#runscreen button.go');
    await page.waitForFunction(() => (window as any).__conflux.run()?.roomType === 'shop' && (window as any).__conflux.run()?.phase === 'doors', null, { timeout: 90000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
    await page.waitForSelector('#hud .stall', { timeout: 30000 });
    const run = await page.evaluate(() => (window as any).__conflux.run());
    check(run.wares >= 3 && run.wares <= 4, `a shop room stocks ${run.wares} wares`);
    check(run.souls === 400 && run.depth === 1, `the run holds ${run.souls} souls on depth ${run.depth}`);
    check((await page.locator('#hud .souls').innerText()).includes('400'), 'the souls counter shows the souls in hand');
    check((await page.locator('#hud .depth').innerText()).includes('Depth 1'), 'the depth counter shows the depth');
    check((await page.locator('#hud .gate.rest, #hud .gate.shop, #hud .gate.shrine, #hud .gate.fight, #hud .gate.elite').count()) >= 1, 'the gate signs name the room behind each gate');
    check((await page.locator('#hud .stall').count()) === run.wares, 'every ware has a label over its stall');
    // stand at the augment stall (the third ware in a shop with an element, a skill, an augment and a heal) and buy
    await page.evaluate((s) => (window as any).__conflux.command({ op: 'teleport', x: s.x + 0.4, z: s.z }), run.stalls[2]);
    await page.evaluate((s) => (window as any).__conflux.lookFrom(s.x + 2.5, 2.6, s.z + 4, s.x - 1, 1.2, s.z - 2), run.stalls[2]);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'shop.png') });
    check((await page.locator('#hud .prompt.on').innerText()).includes('[E]'), 'standing at a stall shows the interact prompt with the price');
    const answer: string = await page.evaluate(() => (window as any).__conflux.buyNearest());
    const after = await page.evaluate(() => (window as any).__conflux.run());
    check(answer === 'ok' && after.souls < 400, `buying at a stall works (${answer}, ${after.souls} souls left)`);
    check(errors.length === 0, `the shop room has no console errors${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
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
