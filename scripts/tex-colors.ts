// Prints the average colour (and hue) of every sbs256 texture: npx tsx scripts/tex-colors.ts
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
const root = new URL('../client/public/assets/tex/sbs256/', import.meta.url).pathname;
for (const dir of readdirSync(root)) {
  const row: string[] = [];
  for (const f of readdirSync(root + dir).sort()) {
    const { channels } = await sharp(root + dir + '/' + f).stats();
    const [r, g, b] = channels.map((c) => c.mean);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const h = mx === mn ? 0 : mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
    row.push(`${f.slice(dir.length + 1, dir.length + 3)}:${Math.round(h * 60)}/${Math.round(((mx - mn) / (mx || 1)) * 100)}/${Math.round(mx)}`);
  }
  console.log(dir, '(num:hue/sat%/value)\n ', row.join(' '));
}
