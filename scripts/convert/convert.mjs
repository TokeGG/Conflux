import { chromium } from 'playwright-core';
import fs from 'node:fs';
const jobs = JSON.parse(process.argv[2]); // [{kind,url,out,opts}]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
for (const j of jobs) {
  const p = await b.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await p.goto('http://127.0.0.1:5201/converter.html'); await p.waitForFunction(() => document.title === 'ready');
  try {
    const r = await p.evaluate(([k, u, o]) => window.convert(k, u, o), [j.kind, j.url, j.opts || {}]);
    fs.writeFileSync(j.out, Buffer.from(r.glb, 'base64'));
    console.log(j.out.split('/').pop(), (fs.statSync(j.out).size / 1e6).toFixed(1) + 'MB', JSON.stringify(r.info).slice(0, 700));
  } catch (e) { console.log('FAILED', j.url, String(e).slice(0, 300)); }
  await p.close();
}
await b.close();
