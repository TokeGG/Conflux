import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const src = process.argv[2], out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const list = m.assets || m.animations || m.items || m.effects || Object.values(m).find(Array.isArray);
const index = []; let inBytes = 0, outBytes = 0;
for (const e of list) {
  const f = path.join(src, e.sheet); if (!fs.existsSync(f)) { console.log('missing sheet', e.id); continue; }
  const meta = await sharp(f).metadata();
  const dest = path.join(out, e.id + '.webp');
  await sharp(f).webp({ lossless: true, effort: 4 }).toFile(dest);
  inBytes += fs.statSync(f).size; outBytes += fs.statSync(dest).size;
  index.push({ id: e.id, name: e.name, category: e.category, mode: e.mode, file: e.id + '.webp', sheet: [meta.width, meta.height], frame: e.canvas, cols: e.sheet_columns, frames: e.frame_count, ms: e.duration_ms, loop: e.loop, anchor: e.anchor, blend: e.blend, events: e.events || [] });
}
fs.writeFileSync(path.join(out, 'fx.json'), JSON.stringify({ source: 'Spellwoven - Animated Fantasy Effects v4.0', license: 'Full Version terms: commercial use and modification allowed; unmodified redistribution not allowed', effects: index }, null, 1));
console.log('effects', index.length, `sheets ${(inBytes / 1e6).toFixed(1)}MB png -> ${(outBytes / 1e6).toFixed(1)}MB webp`);
