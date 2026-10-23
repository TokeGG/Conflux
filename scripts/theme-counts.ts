// Prints the mean number of pieces per theme over a few seeds: npx tsx scripts/theme-counts.ts
import { defaultData, generateRoom } from '@conflux/shared';
const data = defaultData();
const seeds = [3, 8, 14, 21, 33, 40, 51, 62, 77, 90];
for (const theme of Object.keys(data.themes)) {
  const ns = seeds.map((s) => generateRoom(data, s, 1, 0, theme).room.pieces.length);
  console.log(theme.padEnd(8), 'mean', (ns.reduce((a, b) => a + b, 0) / ns.length).toFixed(0), 'min', Math.min(...ns), 'max', Math.max(...ns));
}
