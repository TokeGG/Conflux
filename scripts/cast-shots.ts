// Casts every skill in turn in the sandbox from the real behind-the-shoulder camera, one screenshot of each mid-cast, then a contact sheet.
// Usage: (cd client && node ../node_modules/vite/bin/vite.js build) && npx tsx scripts/cast-shots.ts [skill-id-prefix]
// Scripted input is re-sent about every 100 ms, as the page keeps the last input only until the next call.
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { defaultData, ELEMENTS } from '@conflux/shared';
import { startSite } from './lib/shotsite.ts';

const out = '.superpowers/shots/cast';
mkdirSync(out, { recursive: true });
const data = defaultData();
const only = process.argv[2] ?? '';
const skills = Object.values(data.skills).filter((s) => s.id.startsWith(only));
const BUTTON = { basic: 1, secondary: 2, utility: 4 } as const;
/** Milliseconds into the held button at which the shot is taken, by shape. */
const SHOT_AT: Record<string, number> = { projectile: 330, cone: 380, stream: 900, zone: 600, wall: 600, self: 650, dash: 230 };

const site = await startSite();
const files: { id: string; file: string }[] = [];
try {
  const { page, errors } = await site.open('?dev&sandbox');
  await page.waitForFunction(() => (window as any).__conflux?.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__conflux.tick > 5, null, { timeout: 30000 });
  const ev = <T>(code: string) => page.evaluate(code) as Promise<T>;
  await ev(`(() => { const c = window.__conflux; c.command({ op: 'god', on: true }); c.command({ op: 'noCooldowns', on: true }); })()`);
  for (const s of skills) {
    await ev(`(() => { const c = window.__conflux; c.sendInput(null); c.command({ op: 'killAll' }); c.command({ op: 'teleport', x: 0, z: 0 }); c.command({ op: 'giveSkill', skill: '${s.id}' }); c.command({ op: 'setElement', i: ${ELEMENTS.indexOf(s.element)} }); })()`);
    await page.waitForTimeout(500);
    await ev(`window.__conflux.command({ op: 'spawn', enemy: 'enemy.dummy', count: 1, at: { x: 1.5, y: 0, z: 7 } })`);
    await page.waitForTimeout(500);
    const button = BUTTON[s.slot];
    const start = Date.now();
    let shot = false;
    const at = SHOT_AT[s.shape.type] ?? 400;
    const file = `${out}/${s.id.replace('.', '_')}.png`;
    for (let i = 0; i < 20 && !shot; i++) {
      await ev(`(() => { const c = window.__conflux; const e = c.snapshot().enemies[0]; const t = e ? e.pos : { x: 1.5, z: 7 }; c.sendInput({ ...c.aimAt(t.x, 1.0, t.z), buttons: ${button} }); })()`);
      await page.waitForTimeout(100);
      if (Date.now() - start >= at) {
        await page.screenshot({ path: file });
        shot = true;
      }
    }
    await ev(`window.__conflux.sendInput(null)`);
    files.push({ id: s.id, file });
    await page.waitForTimeout(700);
  }
  console.log('errors', errors.slice(0, 5));
} finally {
  await site.close();
}

// the contact sheet: 5 columns, the middle of each screenshot (the player and what is in front of them), labelled
const W = 640;
const H = 360;
const cols = 3;
const cells = await Promise.all(
  files.map(async (f, i) => {
    const img = await sharp(f.file).extract({ left: 240, top: 90, width: 800, height: 500 }).resize(W, H, { fit: "cover" }).toBuffer();
    const label = Buffer.from(`<svg width="${W}" height="26"><rect width="${W}" height="26" fill="#000" opacity="0.7"/><text x="8" y="18" font-family="sans-serif" font-size="16" fill="#fff">${f.id}</text></svg>`);
    return { input: await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer(), left: (i % cols) * W, top: Math.floor(i / cols) * H };
  }),
);
const sheet = sharp({ create: { width: cols * W, height: Math.ceil(files.length / cols) * H, channels: 3, background: '#111' } });
await sheet.composite(cells).png().toFile(`${out}/contact-sheet${only ? '-' + only : ''}.png`);
console.log('contact sheet', `${out}/contact-sheet${only ? '-' + only : ''}.png`, files.length, 'skills');
