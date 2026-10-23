// Browser check of the attack animations (build the client first): for every mob and EVERY attack in its list, spawns it beside the player,
// starts that attack with the dev command forceAttack (a boss's AI may never pick some), watches the body transform through the test hook and
// takes a screenshot at the end of the wind-up and at the strike. Output: .superpowers/shots/attack-<mob>-<attack>-<view>-<stage>.png
// Usage: npx tsx scripts/attack-shots.ts [enemy ids or enemy:attack ids...]   (VIEWS=cam,side,front picks the cameras, default cam)
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
const enemies = JSON.parse(readFileSync(fileURLToPath(new URL('../shared/data/enemies.json', import.meta.url)), 'utf8')) as Record<string, { attacks: string[] }>;
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['boss.reaper', 'boss.maw', 'enemy.skeleton', 'enemy.golem_fire', 'enemy.book', 'enemy.fire_elemental'];
const byMob = new Map<string, string[]>();
for (const w of wanted) {
  const [mob, only] = w.split(':');
  if (!enemies[mob]) throw new Error(`unknown enemy ${mob}`);
  byMob.set(mob, [...(byMob.get(mob) ?? []), ...(only ? [only] : enemies[mob].attacks)]);
}
const views = (process.env.VIEWS ?? 'cam').split(',');
let failures = 0;
try {
  for (const [mob, attacks] of byMob) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__conflux.tick > 3, null, { timeout: 20000 });
    await page.evaluate(`window.__conflux.command({ op: 'god', on: true })`);
    await page.evaluate(`window.__conflux.command({ op: 'pause', on: true })`);
    for (const attack of attacks) {
      for (const view of views) {
        const name = `${mob.replace(/[^a-z]+/g, '-')}-${attack.replace(/^atk\./, '').replace(/[^a-z]+/g, '-')}-${view}`;
        const result = await page.evaluate(`(async () => {
          const c = window.__conflux;
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const stepWait = async (n) => { const t0 = c.snapshot().tick; c.command({ op: 'step', n }); for (let i = 0; i < 200 && c.snapshot().tick < t0 + n; i++) await sleep(50); };
          c.command({ op: 'killAll' });
          await stepWait(3);
          await sleep(200);
          const me = c.snapshot().players[0].pos;
          c.command({ op: 'spawn', enemy: ${JSON.stringify(mob)}, count: 1, at: { x: me.x + 6, y: 0, z: me.z } });
          await stepWait(2);
          for (let i = 0; i < 400 && !(c.snapshot().enemies.length === 1 && c.enemyPoses().some((q) => q.sim === c.snapshot().enemies[0].id)); i++) await sleep(50);
          const e0 = c.snapshot().enemies[0];
          const id = e0.id;
          const boss = ${JSON.stringify(mob.startsWith('boss.'))};
          const d = boss ? 10 : 6, h = boss ? 1.0 : 0.6;
          // the mob faces the player (-x); cam is a three-quarter view from behind-left, side looks across its flank, front faces it
          const cams = {
            cam: [e0.pos.x - 2, d * 0.7 + 1, e0.pos.z - d * 0.6, e0.pos.x - 1, d * 0.15 + 0.4, e0.pos.z],
            side: [e0.pos.x, d * 0.3 + 0.8, e0.pos.z + d, e0.pos.x, h * 1.6, e0.pos.z],
            front: [e0.pos.x - d, d * 0.3 + 0.8, e0.pos.z, e0.pos.x, h * 1.6, e0.pos.z],
          };
          c.lookFrom(...cams[${JSON.stringify(view)}]);
          const seen = { rest: null, stages: {}, rotX: [], y: [], scaleY: [], weapon: [] };
          const poseOf = () => c.enemyPoses().find((q) => q.sim === id);
          const note = () => { const p = poseOf(); if (!p) return; seen.rotX.push(p.rotX); seen.y.push(p.y); seen.scaleY.push(p.scaleY); seen.weapon.push(p.weapon); if (p.stage) seen.stages[p.stage] = (seen.stages[p.stage] || 0) + 1; return p; };
          await sleep(300);
          seen.rest = note();
          c.command({ op: 'forceAttack', enemy: id, attack: ${JSON.stringify(attack)} });
          await stepWait(1);
          await sleep(100);
          if (!c.snapshot().enemies.find((e) => e.id === id && e.attack)) return JSON.stringify({ error: 'attack did not start ' + JSON.stringify(c.snapshot().enemies.map((e) => [e.id, e.def, e.attack, e.hp, e.pos]))  });
          // step through the wind-up in small pieces so the screenshot catches the pose just before the hit
          for (let i = 0; i < 200; i++) {
            const e = c.snapshot().enemies.find((q) => q.id === id);
            if (!e || !e.attack || e.attackProgress > 0.9) break;
            await stepWait(2);
            await sleep(30);
            note();
          }
          await sleep(300);
          note();
          return JSON.stringify({ rest: seen.rest, stages: seen.stages, range: { rotX: [Math.min(...seen.rotX), Math.max(...seen.rotX)], y: [Math.min(...seen.y), Math.max(...seen.y)], scaleY: [Math.min(...seen.scaleY), Math.max(...seen.scaleY)], weapon: [Math.min(...seen.weapon), Math.max(...seen.weapon)] } });
        })()`);
        const r = JSON.parse(result as string);
        if (r.error) {
          console.log(`FAIL ${mob} ${attack}: ${r.error}`);
          failures++;
          continue;
        }
        await page.screenshot({ path: join(shots, `attack-${name}-windup.png`) });
        // land the blow, then catch the strike while the view's strike stage (0.12 s) is still on
        await page.evaluate(`window.__conflux.command({ op: 'step', n: 4 })`);
        await page.waitForTimeout(60);
        await page.screenshot({ path: join(shots, `attack-${name}-strike.png`) });
        if (/charge/.test(attack)) {
          await page.evaluate(`window.__conflux.command({ op: 'step', n: 14 })`);
          await page.waitForTimeout(120);
          await page.screenshot({ path: join(shots, `attack-${name}-run.png`) });
        }
        // let the attack finish so the next one starts clean
        await page.evaluate(`window.__conflux.command({ op: 'step', n: 90 })`);
        await page.waitForTimeout(600);
        const moved = !!r.stages.windup && (r.range.rotX[1] - r.range.rotX[0] > 0.05 || r.range.y[1] - r.range.y[0] > 0.03 || r.range.scaleY[1] - r.range.scaleY[0] > 0.03 || r.range.weapon[1] - r.range.weapon[0] > 0.1);
        console.log(`${moved ? 'ok  ' : 'FAIL'} ${mob} ${attack} [${view}] changes pose when it attacks`, JSON.stringify(r.range), JSON.stringify(r.stages));
        if (!moved) failures++;
      }
    }
    if (errors.length) {
      console.log('FAIL errors', errors.join(' | ').slice(0, 300));
      failures++;
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
