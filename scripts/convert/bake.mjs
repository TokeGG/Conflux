import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path';
const S = '/tmp/claude-0/-home-user/60552bea-0a23-5b6c-8ecc-5f70a35c71f2/scratchpad';
const files = fs.readdirSync(S + '/convert/in/clips'); const glbs = files.filter((f) => f.endsWith('.glb') && !f.startsWith('chk_')).map((f) => f.replace(/\.glb$/, '')); const names = files.filter((f) => f.endsWith('.fbx') && !f.startsWith('chk_')).map((f) => f.replace(/\.fbx$/, '')).sort();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
for (const rig of process.argv.slice(2)) {
  const p = await b.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await p.goto('http://127.0.0.1:5201/bake.html'); await p.waitForFunction(() => document.title === 'ready'); await p.evaluate((g) => window.setGlb(g), glbs);
  const res = []; for (let i = 0; i < names.length; i += 8) res.push(...await p.evaluate(([r, n]) => window.bake(r, n), [rig, names.slice(i, i + 8)]));
  const dir = `${S}/staging/clips/${rig}`; fs.mkdirSync(dir, { recursive: true }); let ok = 0, bytes = 0; const index = [];
  for (const c of res) { if (c.error) { console.log(rig, 'FAILED', c.name, c.error); continue; } fs.writeFileSync(`${dir}/${c.name}.json`, JSON.stringify(c)); ok++; bytes += fs.statSync(`${dir}/${c.name}.json`).size; index.push({ name: c.name, frames: c.frames, duration: c.duration, loop: c.loop, rootSpeed: c.rootSpeed }); }
  fs.writeFileSync(`${dir}/index.json`, JSON.stringify({ rig, fps: 30, bones: res.find((c) => c.bones).bones, clips: index }));
  console.log(rig, ok, 'clips baked,', (bytes / 1e6).toFixed(2) + 'MB'); await p.close();
}
await b.close();
