// Balance check of the ten-element system. For every pair: damage dealt to a small cluster of dummies in 5 s with the reaction
// and without it (the same hit on a dummy that does not carry the first element's status). For every skill: damage per second
// on the same cluster over 10 s of casting it whenever it is ready. Outliers are more than 3x (or under a third of) the median.
// usage: npx tsx scripts/balance-elements.ts
import { defaultData, ELEMENTS, Sim } from '@conflux/shared';
import { castSkill } from '../shared/src/sim/skills.ts';
import { applyStatus } from '../shared/src/sim/statuses.ts';
import { dealDamage } from '../shared/src/sim/damage.ts';
import { spawnEnemy } from '../shared/src/sim/state.ts';
import { idleInput } from '../shared/src/types.ts';

const HP = 1e6;
const data = defaultData();

function arena(): Sim {
  const sim = new Sim(structuredClone(data), 7);
  sim.god = true;
  sim.player.pos = { x: 0, y: 0, z: 0 };
  for (const [x, z] of [[0, 4], [1.5, 5.5], [-1.5, 5.5]]) {
    spawnEnemy(sim, 'enemy.dummy', { x, y: sim.world.groundAt(x, z), z });
  }
  for (const e of sim.enemies) e.hp = e.maxHp = HP;
  return sim;
}
const lost = (sim: Sim) => sim.enemies.reduce((s, e) => s + (HP - e.hp), 0);
const input = () => ({ ...idleInput(), aimYaw: 0, camOrigin: { x: 0, y: 1.6, z: 0 } });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function pairDamage(a: (typeof ELEMENTS)[number], b: (typeof ELEMENTS)[number], withStatus: boolean): number {
  const sim = arena();
  const target = sim.enemies[0];
  const status = sim.data.elements.reacts[a];
  if (withStatus && status) applyStatus(sim, target, status, sim.time);
  dealDamage(sim, target, 20, b);
  for (let i = 0; i < 300; i++) sim.step([input()]);
  return lost(sim);
}

function skillDps(id: string): number {
  const sim = arena();
  sim.player.hp = 1e6;
  const skill = data.skills[id];
  const i = input();
  for (let t = 0; t < 600; t++) {
    castSkill(sim, sim.player, id, { x: 0, y: 1, z: 4 });
    sim.step([i]);
    sim.player.pos = { x: 0, y: 0, z: 0 };
  }
  void skill;
  return lost(sim) / 10;
}

const rows = data.reactions.map((r) => {
  const [a, b] = r.pair;
  const withR = (pairDamage(a, b, true) + pairDamage(b, a, true)) / 2;
  const without = (pairDamage(a, b, false) + pairDamage(b, a, false)) / 2;
  return { id: r.id, pair: `${a}+${b}`, withR, without, bonus: withR - without };
});
const med = median(rows.map((r) => r.bonus).filter((x) => x > 1));
console.log(`REACTIONS  (damage in 5 s on 3 dummies; bonus = with - without; median bonus ${med.toFixed(1)})`);
for (const r of rows.sort((x, y) => y.bonus - x.bonus)) {
  const flag = r.bonus > 3 * med ? '  HIGH' : r.bonus < 1 ? '  utility (no direct damage)' : r.bonus < med / 3 ? '  LOW' : '';
  console.log(`${r.id.padEnd(16)} ${r.pair.padEnd(16)} with ${r.withR.toFixed(0).padStart(6)}  without ${r.without.toFixed(0).padStart(5)}  bonus ${r.bonus.toFixed(0).padStart(6)}${flag}`);
}

const skills = Object.keys(data.skills).map((id) => ({ id, slot: data.skills[id].slot, dps: skillDps(id) }));
const smed = median(skills.map((s) => s.dps).filter((x) => x > 0));
console.log(`\nSKILLS  (damage per second over 10 s; median of damaging skills ${smed.toFixed(1)})`);
for (const s of skills.sort((x, y) => y.dps - x.dps)) {
  const flag = s.dps === 0 ? '  no direct damage' : s.dps > 3 * smed ? '  HIGH' : s.dps < smed / 3 ? '  LOW' : '';
  console.log(`${s.id.padEnd(26)} ${s.slot.padEnd(10)} dps ${s.dps.toFixed(1).padStart(7)}${flag}`);
}
