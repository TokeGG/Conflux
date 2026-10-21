import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseElement, playRun } from '../src/bot.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import { ELEMENTS } from '../src/types.ts';

const data = defaultData();
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
let cache: ReturnType<typeof playRun>[] | null = null;
/** The 20 reports, played once and shared by the tests. */
const reports = () => (cache ??= SEEDS.map((seed) => playRun(data, seed, 1800)));

test('playRun finishes on 20 seeds within 1800 simulated seconds, win or lose', () => {
  for (const [i, r] of reports().entries()) {
    const seed = SEEDS[i];
    assert.equal(r.seed, seed);
    assert.ok(r.seconds > 0 && r.seconds <= 1800 + 1, `seed ${seed} ran ${r.seconds}s`);
    assert.ok(r.rooms >= 0 && r.rooms <= 9);
  }
});

test('the bot makes reactions on at least 15 of 20 seeds', () => {
  const withReactions = reports().filter((r) => Object.keys(r.reactions).length > 0).length;
  assert.ok(withReactions >= 15, `only ${withReactions} of 20 runs had a reaction`);
});

test('the same seed gives the same report', () => {
  assert.deepEqual(playRun(data, 7, 1800), playRun(data, 7, 1800));
});

test('the report counts skills used, and an augment once one is owned', () => {
  const total = reports();
  assert.ok(total.every((r) => Object.keys(r.skillUse).length > 0));
  assert.ok(total.some((r) => Object.keys(r.augmentUse).length > 0));
});

function lone(enemy: string) {
  const sim = createRoomSim(data, 1, 'forest_clearing');
  spawnEnemy(sim, enemy, { x: sim.player.pos.x, y: 0, z: sim.player.pos.z + 8 });
  return sim;
}

test('chooseElement picks water against a lone fire golem and wind against a lone earth golem', () => {
  const fire = Object.values(data.enemies).find((e) => e.element === 'fire' && e.weak.includes('water'))!;
  const earth = Object.values(data.enemies).find((e) => e.element === 'earth' && e.weak.includes('wind'))!;
  assert.equal(ELEMENTS[chooseElement(lone(fire.id))], 'water');
  assert.equal(ELEMENTS[chooseElement(lone(earth.id))], 'wind');
});
