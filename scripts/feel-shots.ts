// Screenshots of the live-feel dev pages (npm run build first): the animation viewer, the Animations page, Skill animation and Camera and feel.
// Usage: npx tsx scripts/feel-shots.ts [page-title ...]   (files go to .superpowers/shots/feel-<page>.png)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serveDist } from './lib/browser.ts';

const shots = fileURLToPath(new URL('../.superpowers/shots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const only = process.argv.slice(2);
const server = await serveDist();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${server.url}?dev&sandbox`);
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.keyboard.press('F2');
  await page.waitForSelector('#devpanel', { state: 'visible', timeout: 5000 });
  const names = await page.$$eval('#devpanel nav button', (bs) => bs.map((b) => b.textContent?.trim() ?? ''));
  console.log(names.join(' | '));
  for (const name of names) {
    if (only.length && !only.includes(name)) continue;
    await page.click(`#devpanel nav button:text-is("${name}")`);
    await page.waitForTimeout(2500);
    const file = `feel-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    await page.screenshot({ path: join(shots, file) });
    console.log(file);
  }
} finally {
  await browser.close();
  server.close();
}
