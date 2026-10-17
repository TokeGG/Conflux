import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const ex = process.argv[2], out = process.argv[3];
const sets = [
  ['sbs128', 'sbs128/128x128', 'CC0 (Screaming Brain Studios)', true, null],
  ['sbs256', 'sbs256/256x256', 'CC0 (Screaming Brain Studios)', true, null],
  ['wood', 'wood', 'unknown (source not given)', false, 512],
  ['vegetation', 'veg', 'unknown (source not given)', false, 512],
  ['grounds', 'grounds', 'unknown (source not given)', false, 512],
  ['cave', 'cave', 'unknown (source not given)', false, 512],
  ['grassdirt', 'grassdirt/JPEG', 'unknown (source not given)', false, 512, /basecolor|normal\.|normalogl/i],
];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const index = {}; let total = 0;
for (const [name, dir, license, verified, maxDim, filter] of sets) {
  const root = path.join(ex, dir); const items = [];
  for (const f of walk(root).filter((x) => /\.(png|jpe?g)$/i.test(x) && (!filter || filter.test(path.basename(x)))).sort()) {
    const rel = path.relative(root, f).replace(/\.\w+$/, '.webp').replace(/[ ()]+/g, '_').replace(/_+\./, '.');
    const dest = path.join(out, name, rel); fs.mkdirSync(path.dirname(dest), { recursive: true });
    let img = sharp(f); const m = await img.metadata(); let w = m.width, h = m.height;
    if (maxDim && Math.max(w, h) > maxDim) { img = img.resize({ width: w >= h ? maxDim : undefined, height: h > w ? maxDim : undefined }); const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    await img.webp(maxDim ? { quality: 88 } : { lossless: true }).toFile(dest); total += fs.statSync(dest).size;
    items.push({ file: path.join(name, rel), size: [w, h], from: [m.width, m.height], alpha: !!m.hasAlpha });
  }
  index[name] = { license, licenseVerified: verified, count: items.length, items };
  console.log(name.padEnd(11), String(items.length).padStart(3), 'files', items[0] ? `e.g. ${items[0].from.join('x')} -> ${items[0].size.join('x')}` : 'EMPTY', verified ? '' : '  [license unverified]');
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
console.log('total', (total / 1e6).toFixed(1) + 'MB');
