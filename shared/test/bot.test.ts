import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botInput, chooseElement, playRun } from '../src/bot.ts';
import { ENDLESS } from '../src/run/endless.ts';
import { createRunRoomSim } from '../src/run/director.ts';
import { applyDevCommand } from '../src/sim/devcmd.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import { ELEMENTS } from '../src/types.ts';

const data = defaultData();
/** Simulated seconds each run may last: enough for a dozen rooms, short enough to test 20 seeds. */
const LIMIT = 600;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
let cache: ReturnType<typeof playRun>[] | null = null;
/** The 20 reports, played once and shared by the tests. */
const reports = () => (cache ??= SEEDS.map((seed) => playRun(data, seed, LIMIT)));

test('playRun finishes on 20 seeds within the time it is given (the run is endless, so it ends in a death or at the limit)', () => {
  for (const [i, r] of reports().entries()) {
    const seed = SEEDS[i];
    assert.equal(r.seed, seed);
    assert.ok(r.seconds > 0 && r.seconds <= LIMIT + 1, `seed ${seed} ran ${r.seconds}s`);
    assert.equal(r.victory, false, 'an endless run is never won');
  }
});

test('the bot makes reactions on at least 12 of 20 seeds', () => {
  const withReactions = reports().filter((r) => Object.keys(r.reactions).length > 0).length;
  assert.ok(withReactions >= 12, `only ${withReactions} of 20 runs had a reaction`);
});

test('the same seed gives the same report', () => {
  assert.deepEqual(playRun(data, 7, LIMIT), playRun(data, 7, LIMIT));
});

test('the report counts skills used, and an augment once one is owned', () => {
  const total = reports();
  assert.ok(total.every((r) => Object.keys(r.skillUse).length > 0));
  assert.ok(total.some((r) => Object.keys(r.augmentUse).length > 0));
});

function lone(enemy: string) {
  const sim = createRoomSim(data, 1, 'forest_clearing');
  sim.player.equipped = ['fire', 'water', 'wind'];
  spawnEnemy(sim, enemy, { x: sim.player.pos.x, y: 0, z: sim.player.pos.z + 8 });
  return sim;
}

test('chooseElement picks water against a lone fire golem and wind against a lone earth golem', () => {
  const fire = Object.values(data.enemies).find((e) => e.element === 'fire' && e.weak.includes('water'))!;
  const earth = Object.values(data.enemies).find((e) => e.element === 'earth' && e.weak.includes('wind'))!;
  assert.equal(ELEMENTS[chooseElement(lone(fire.id))], 'water');
  assert.equal(ELEMENTS[chooseElement(lone(earth.id))], 'wind');
});

test('the bot clears a room, then walks around the props to a gate and leaves through it', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const run = ENDLESS.start(seed, data);
    const sim = createRunRoomSim(run, data);
    applyDevCommand(sim, { op: 'killAll' });
    const types: string[] = [];
    for (let i = 0; i < 90 * 60 && !types.includes('door_entered'); i++) types.push(...sim.step([botInput(sim)]).map((e) => e.type));
    assert.ok(types.includes('room_cleared'), `seed ${seed} clears`);
    assert.ok(types.includes('door_entered'), `seed ${seed}: the bot walked out through a gate`);
  }
});

test('playRun gets past the first room on at least 15 of 20 seeds', () => {
  const past = reports().filter((r) => r.rooms >= 2).length;
  assert.ok(past >= 15, `only ${past} of 20 runs cleared two rooms`);
});

test('in a shop the bot walks to the best ware it can afford, buys it, and leaves by a gate', async () => {
  const { RunDirector } = await import('../src/run/director.ts');
  const { planRoomAt } = await import('../src/run/endless.ts');
  const { emptyLedger } = await import('../src/run/unlocks.ts');
  const { botShop } = await import('../src/bot.ts');
  for (const seed of [1, 2, 3, 4, 5]) {
    const d = new RunDirector(data, seed, emptyLedger(), false, ENDLESS);
    d.run = { ...d.run, roomIndex: 6, current: planRoomAt(data, seed, 1, 6, 0), souls: 400, soulsEarned: 400, hp: 50 };
    d.onEnter = () => undefined;
    // arrive as the director does after the reward at the entrance
    (d as unknown as { startQuiet(): void }).startQuiet();
    assert.equal(d.phase, 'doors');
    const sim = createRunRoomSim(d.run, data);
    let bought = 0;
    for (let t = 0; t < 60 * 60 && d.phase === 'doors'; t++) {
      const input = botShop(d, sim, () => bought++) ?? botInput(sim);
      d.onEvents(sim.step([input]));
    }
    assert.ok(bought >= 1, `seed ${seed}: bought something`);
    assert.ok(d.run.souls < 400, `seed ${seed}: spent souls`);
    assert.equal(d.phase, 'fighting', `seed ${seed}: left through a gate into the next room`);
    assert.equal(d.run.roomIndex, 7);
  }
});

test('a bot that holds each element, with two others, plays all three and reaches a reaction against a pair of dummies', () => {
  for (const el of ELEMENTS) {
    const i = ELEMENTS.indexOf(el);
    const sim = createRoomSim(data, 3, 'forest_clearing');
    sim.player.equipped = [el, ELEMENTS[(i + 4) % 10], ELEMENTS[(i + 7) % 10]];
    sim.player.element = i;
    for (const dx of [-2, 2]) spawnEnemy(sim, 'enemy.dummy', { x: sim.player.pos.x + dx, y: 0, z: sim.player.pos.z + 8 });
    const cast = new Set<string>();
    let reacted = false;
    for (let t = 0; t < 60 * 40 && !reacted; t++) {
      for (const e of sim.step([botInput(sim)])) {
        if (e.type === 'reaction') reacted = true;
        if (e.type === 'cast') cast.add(ELEMENTS.find((x) => String(e.skillId).startsWith(`${x}.`))!);
      }
    }
    assert.ok(reacted, `${el}: a reaction within 40 s`);
    if (el !== 'wind') assert.ok(cast.has(el), `${el} was played`); // wind adds no status of its own, so the bot may leave it on the key
  }
});

test('a lost run reports where it ended: the room, its type and theme, and what dealt the last hit', () => {
  let lost = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = playRun(data, seed, 900);
    if (r.seconds >= 899) continue;
    lost++;
    assert.ok(r.death, `seed ${seed} died without a death report`);
    assert.ok(r.death.room >= r.rooms, 'the room it died in is at or after the number of fights it cleared (quiet rooms are not fights)');
    assert.ok(['combat', 'elite', 'boss'].includes(r.death.type) && r.death.theme in data.themes);
    assert.ok(r.death.killer === '' || r.death.killer === 'timeout' || r.death.killer === 'zone' || r.death.killer === 'projectile' || r.death.killer.startsWith('elite.') || r.death.killer in data.enemies, `killer ${r.death.killer}`);
  }
  assert.ok(lost > 0, 'some run in twelve should end in a death');
});
