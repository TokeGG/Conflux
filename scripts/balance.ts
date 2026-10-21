// Plays many runs with the scripted bot and prints how they went: win rate, run length, and what got used.
// usage: npx tsx scripts/balance.ts [seeds=50] [maxSeconds=1800]
import { defaultData, playRun, type RunReport } from '@conflux/shared';

const seeds = Number(process.argv[2] ?? 50);
const maxSeconds = Number(process.argv[3] ?? 1800);
if (!Number.isInteger(seeds) || seeds < 1) throw new Error('usage: balance.ts <seeds> [maxSeconds]');

const data = defaultData();
const reports: RunReport[] = [];
for (let seed = 1; seed <= seeds; seed++) reports.push(playRun(data, seed, maxSeconds));

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const wins = reports.filter((r) => r.victory).length;
console.log(`runs: ${seeds}   win rate: ${pct(wins, seeds)} (${wins})   mean length: ${mean(reports.map((r) => r.seconds)).toFixed(0)} s   mean rooms cleared: ${mean(reports.map((r) => r.rooms)).toFixed(1)} of 9`);

// where runs end
const ended: Record<number, number> = {};
for (const r of reports) if (!r.victory) ended[r.rooms] = (ended[r.rooms] ?? 0) + 1;
console.log(`runs lost after N rooms: ${Object.entries(ended).map(([k, v]) => `${k}:${v}`).join('  ') || 'none'}`);

function usage(title: string, all: string[], pick: (r: RunReport) => Record<string, number>): void {
  const total: Record<string, number> = Object.fromEntries(all.map((id) => [id, 0]));
  for (const r of reports) for (const [k, v] of Object.entries(pick(r))) total[k] = (total[k] ?? 0) + v;
  const sorted = Object.entries(total).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const row = (xs: [string, number][]) => xs.map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`\n${title}\n  most used:  ${row(sorted.slice(0, 5))}\n  least used: ${row(sorted.slice(-5).reverse())}`);
}
usage('Skills cast', Object.keys(data.skills), (r) => r.skillUse);
usage('Augments owned at the end of a run', Object.keys(data.augments), (r) => r.augmentUse);
usage('Reactions', [...new Set(data.reactions.map((x) => x.effect))], (r) => r.reactions);
