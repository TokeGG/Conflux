import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyFor, dayKey } from '../src/run/daily.ts';
import { ENDLESS } from '../src/run/endless.ts';
import { offerRewards } from '../src/run/rewards.ts';
import { RunDirector } from '../src/run/director.ts';
import { emptyLedger } from '../src/run/unlocks.ts';
import { makeStreams } from '../src/rng.ts';
import { defaultData } from '../src/files.ts';

const data = defaultData();

test('the day key is the UTC date as a number, so everyone on the same day shares a seed', () => {
  assert.equal(dayKey(new Date('2026-10-23T23:59:59Z')), 20261023);
  assert.equal(dayKey(new Date('2026-10-24T00:00:00Z')), 20261024);
});

test('a day gives three different elements, each with skills, and the same ones every time it is asked', () => {
  const d = dailyFor(20261023, data);
  assert.equal(d.elements.length, 3);
  assert.equal(new Set(d.elements).size, 3);
  for (const el of d.elements) assert.ok(Object.values(data.skills).some((s) => s.element === el && s.slot === 'basic'), el);
  assert.deepEqual(dailyFor(20261023, data), d);
});

test('different days give different sets of elements over a month', () => {
  const sets = new Set(Array.from({ length: 30 }, (_, i) => dailyFor(20261001 + i, data).elements.slice().sort().join()));
  assert.ok(sets.size >= 3, `${sets.size} different sets in 30 days`);
});

test('a daily run starts holding the day\'s three elements, with the day\'s seed, and is marked daily', () => {
  const d = dailyFor(20261023, data);
  const s = ENDLESS.start(d.seed, data, false, undefined, { daily: d });
  assert.deepEqual(s.skills.equipped, d.elements);
  assert.equal(s.daily, true);
  assert.equal(ENDLESS.start(1, data).daily, false);
});

test('in a daily run no reward offers an element: the three are locked for the whole run', () => {
  const d = dailyFor(20261023, data);
  const s = ENDLESS.start(d.seed, data, false, undefined, { daily: d });
  for (let room = 0; room < 30; room++) {
    const offers = offerRewards({ ...s, roomIndex: room }, data, makeStreams(d.seed).reward.fork(`t/${room}`));
    assert.ok(!offers.some((o) => o.kind === 'element'), `room ${room}`);
  }
});

test('the director starts a daily run from the same day for everyone, room for room', () => {
  const d = dailyFor(20261023, data);
  const a = new RunDirector(data, d.seed, emptyLedger(), false, ENDLESS, { daily: d });
  const b = new RunDirector(data, d.seed, emptyLedger(), false, ENDLESS, { daily: d });
  assert.deepEqual(a.run.current.roomId, b.run.current.roomId);
  assert.deepEqual(a.run.skills.equipped, d.elements);
});
