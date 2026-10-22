// Browser check of the attack animations (npm run build first): spawns a mob beside the player, waits for it to attack, watches the body
// transform through the test hook and takes a screenshot at the end of the wind-up and at the strike. Output: .superpowers/shots/attack-<mob>-<stage>.png
// Usage: npx tsx scripts/attack-shots.ts [enemy ids...]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
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
const mobs = process.argv.slice(2).length ? process.argv.slice(2) : ['boss.reaper', 'boss.maw', 'enemy.skeleton', 'enemy.golem_fire', 'enemy.book', 'enemy.fire_elemental'];
let failures = 0;
try {
  for (const mob of mobs) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 20000 });
    const name = mob.replace(/[^a-z]+/g, '-');
    const result = await page.evaluate(`(async () => {
      const c = window.__conflux;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      c.command({ op: 'god', on: true });
      const me = c.snapshot().players[0].pos;
      c.command({ op: 'spawn', enemy: ${JSON.stringify(mob)}, count: 1, at: { x: me.x + 6, y: 0, z: me.z } });
      for (let i = 0; i < 400 && c.enemyViews() < 1; i++) await sleep(50);
      const id = c.snapshot().enemies[0].id;
      const e0 = c.snapshot().enemies[0];
      const far = ${mob.startsWith('boss.') ? 10 : 6}; c.lookFrom(e0.pos.x - 2, far * 0.7 + 1, e0.pos.z - far * 0.6, e0.pos.x - 1, far * 0.15 + 0.4, e0.pos.z);
      const seen = { rest: null, windup: null, stages: {}, rotX: [], y: [], scaleY: [], weapon: [], open: [] };
      const poseOf = () => c.enemyPoses().find((q) => q.sim === id);
      const note = () => { const p = poseOf(); if (!p) return; seen.rotX.push(p.rotX); seen.y.push(p.y); seen.scaleY.push(p.scaleY); seen.weapon.push(p.weapon); if (p.stage) seen.stages[p.stage] = (seen.stages[p.stage] || 0) + 1; return p; };
      c.command({ op: 'pause', on: true });
      await sleep(300);
      seen.rest = note();
      let found = false;
      for (let i = 0; i < 400 && !found; i++) {
        c.command({ op: 'step', n: 6 });
        await sleep(120);
        found = !!c.snapshot().enemies.find((e) => e.id === id && e.attack);
        note();
      }
      // step through the wind-up in small pieces so the screenshot catches the pose just before the hit
      for (let i = 0; i < 200; i++) {
        const e = c.snapshot().enemies.find((q) => q.id === id);
        if (!e || !e.attack || e.attackProgress > 0.9) break;
        c.command({ op: 'step', n: 2 });
        await sleep(100);
        note();
      }
      await sleep(400);
      seen.windup = note();
      window.__seen = seen;
      return JSON.stringify({ rest: seen.rest, windup: seen.windup, stages: seen.stages, range: { rotX: [Math.min(...seen.rotX), Math.max(...seen.rotX)], y: [Math.min(...seen.y), Math.max(...seen.y)], scaleY: [Math.min(...seen.scaleY), Math.max(...seen.scaleY)], weapon: [Math.min(...seen.weapon), Math.max(...seen.weapon)] } });
    })()`);
    const r = JSON.parse(result as string);
    await page.screenshot({ path: join(shots, `attack-${name}-windup.png`) });
    // let the attack land (a few ticks), then the strike is on screen
    await page.evaluate(`window.__conflux.command({ op: 'step', n: 8 })`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(shots, `attack-${name}-strike.png`) });
    const moved = !!r.stages.windup && (r.range.rotX[1] - r.range.rotX[0] > 0.05 || r.range.y[1] - r.range.y[0] > 0.03 || r.range.scaleY[1] - r.range.scaleY[0] > 0.03 || r.range.weapon[1] - r.range.weapon[0] > 0.1);
    console.log(`${moved ? 'ok  ' : 'FAIL'} ${mob} changes pose when it attacks`, JSON.stringify(r.range), JSON.stringify(r.stages));
    if (!moved || errors.length) failures++;
    if (errors.length) console.log('FAIL errors', errors.join(' | ').slice(0, 300));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
