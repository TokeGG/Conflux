import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLoadout, equipElement, startingLoadout, EQUIPPED } from '../src/run/loadout.ts';
import { offerRewards } from '../src/run/rewards.ts';
import { RunDirector, createRunRoomSim } from '../src/run/director.ts';
import { emptyLedger } from '../src/run/unlocks.ts';
import { trySwap } from '../src/sim/swap.ts';
import { chooseElement } from '../src/bot.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import { makeStreams, Rng } from '../src/rng.ts';
import { ELEMENTS } from '../src/types.ts';
import { input, makeSim, run } from './helpers.ts';

const data = defaultData();

test('a player holds three elements; the rest are on the bench', () => {
  const sim = makeSim();
  assert.equal(EQUIPPED, 3);
  assert.deepEqual(sim.player.equipped, ['fire', 'water', 'earth']);
  assert.deepEqual(sim.snapshot().players[0].equipped, ['fire', 'water', 'earth']);
});

test('swapTo is a slot of the three: 0 to 2 switch, 3 and above do nothing', () => {
  const sim = makeSim();
  run(sim, 1, input({ swapTo: 2 }));
  assert.equal(sim.snapshot().players[0].element, 'earth');
  run(sim, 1, input({ swapTo: 3 }));
  assert.equal(sim.snapshot().players[0].element, 'earth');
  run(sim, 1, input({ swapTo: 0 }));
  assert.equal(sim.snapshot().players[0].element, 'fire');
});

test('a benched element cannot be held, even by index', () => {
  const sim = makeSim();
  assert.equal(trySwap(sim, sim.player, ELEMENTS.indexOf('wind')), false);
  assert.equal(sim.snapshot().players[0].element, 'fire');
});

test('a starting loadout equips three different elements that all have skills, and the room sim holds them', () => {
  const l = startingLoadout(data, new Rng(5));
  assert.equal(l.equipped.length, 3);
  assert.equal(new Set(l.equipped).size, 3);
  for (const el of l.equipped) assert.ok(l.slots[el].basic, el);
  const sim = makeSim();
  applyLoadout(sim, l);
  assert.deepEqual(sim.player.equipped, l.equipped);
  assert.equal(ELEMENTS[sim.player.element], l.equipped[0]);
});

test('equipElement replaces one slot, the replaced element goes to the bench, and it can be swapped back', () => {
  let l = startingLoadout(data, new Rng(1));
  const bench = ELEMENTS.find((e) => !l.equipped.includes(e))!;
  const out = l.equipped[1];
  l = equipElement(l, 1, bench);
  assert.equal(l.equipped[1], bench);
  assert.ok(!l.equipped.includes(out));
  l = equipElement(l, 1, out);
  assert.equal(l.equipped[1], out);
  assert.throws(() => equipElement(l, 0, l.equipped[2]), /already/);
  assert.throws(() => equipElement(l, 3, bench), /slot/);
});

test('an element offer names an element off the bench; picking it needs a slot to replace', () => {
  const d = new RunDirector(data, 11, emptyLedger());
  const offers = offerRewards({ ...d.run, roomIndex: 2 }, data, makeStreams(11).reward.fork('x'));
  const el = offers.find((o) => o.kind === 'element');
  assert.ok(el, 'an element offer appears');
  assert.ok(!d.run.skills.equipped.includes(el!.element!));
});

test('the director equips the element in the chosen slot and the next room starts with it', () => {
  const d = new RunDirector(data, 11, emptyLedger());
  const bench = ELEMENTS.find((e) => !d.run.skills.equipped.includes(e))!;
  d.phase = 'reward';
  d.offers = [{ kind: 'element', element: bench }];
  d.pick(0);
  assert.equal(d.phase, 'reward', 'without a slot nothing happens');
  d.pick(0, 2);
  assert.equal(d.phase, 'doors');
  assert.equal(d.run.skills.equipped[2], bench);
  const sim = createRunRoomSim(d.run, data);
  assert.equal(sim.player.equipped[2], bench);
});

test('the bot only picks an element it holds', () => {
  const sim = makeSim();
  spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 6 });
  const want = chooseElement(sim);
  assert.ok(sim.player.equipped.includes(ELEMENTS[want]));
});
