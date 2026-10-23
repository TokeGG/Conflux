// Puts the theme screenshots side by side in one image: npx tsx scripts/contact-sheet.ts <dir> <out.png> [kind=eye] [seed=3]
// One cell per theme (labelled), 4 columns.
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { defaultData } from '@conflux/shared';

const [dir = '.superpowers/shots', out = '.superpowers/contact.png', kind = 'eye', seed = '3'] = process.argv.slice(2);
const themes = Object.keys(defaultData().themes);
const W = 480;
const H = 270;
const cols = 4;
const cells: sharp.OverlayOptions[] = [];
themes.forEach((t, i) => {
  const f = `${dir}/theme-${t}-${seed}-${kind}.png`;
  if (!existsSync(f)) return;
  const left = (i % cols) * W;
  const top = Math.floor(i / cols) * H;
  cells.push({ input: f, left, top });
  cells.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="26"><rect width="${W}" height="26" fill="#000" fill-opacity="0.6"/><text x="8" y="19" font-size="18" font-family="sans-serif" fill="#fff">${t}</text></svg>`), left, top });
});
// each source is resized to a cell first
const resized: sharp.OverlayOptions[] = [];
for (const c of cells) {
  if (typeof c.input === 'string') resized.push({ ...c, input: await sharp(c.input).resize(W, H, { fit: 'cover' }).toBuffer() });
  else resized.push(c);
}
await sharp({ create: { width: W * cols, height: H * Math.ceil(themes.length / cols), channels: 3, background: '#000' } }).composite(resized).png().toFile(out);
console.log('wrote', out);
