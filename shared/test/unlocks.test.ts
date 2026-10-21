import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, loadLedger, recordEvent, recordRunEnd, saveLedger, unlockedPool, LEDGER_KEY, type UnlockLedger } from '../src/run/unlocks.ts';
import { offerRewards } from '../src/run/rewards.ts';
import { ROOM_TO_ROOM } from '../src/run/roomToRoom.ts';
import { defaultData } from '../src/files.ts';
import { validateData } from '../src/data.ts';
import { makeStreams } from '../src/rng.ts';

const data = defaultData();
const run = (tuned = false) => ROOM_TO_ROOM.start(1, data, tuned);
const steam = { t: 0, type: 'reaction', effect: 'steam' };

test('50 Steam reactions unlock the achievement skill, 49 do not', () => {
  let l = emptyLedger();
  for (let i = 0; i < 49; i++) l = recordEvent(l, steam, run());
  assert.ok(!l.unlocked.includes('ach.steam_50'));
  l = recordEvent(l, steam, run());
  assert.ok(l.unlocked.includes('ach.steam_50'));
  assert.ok(unlockedPool(l, data).skills.has('water.slip_dash'));
});

test('beating boss.maw unlocks its augment', () => {
  const l = recordEvent(emptyLedger(), { t: 0, type: 'enemy_died', defId: 'boss.maw' }, run());
  assert.ok(unlockedPool(l, data).augments.has('aug.heavy_boulder'));
});

test('a tuned run records nothing', () => {
  const l = recordEvent(emptyLedger(), { t: 0, type: 'enemy_died', defId: 'boss.maw' }, run(true));
  assert.deepEqual(l, emptyLedger());
  assert.deepEqual(recordRunEnd(emptyLedger(), { ...run(true), status: 'victory' }), emptyLedger());
});

test('locked content is hidden from the pool and from reward offers', () => {
  const pool = unlockedPool(emptyLedger(), data);
  assert.ok(!pool.skills.has('water.slip_dash') && !pool.augments.has('aug.heavy_boulder'));
  for (let seed = 1; seed <= 20; seed++) {
    const state = { ...ROOM_TO_ROOM.start(seed, data, false, pool), roomIndex: 2 };
    for (const o of offerRewards(state, data, makeStreams(seed).reward.fork('x'))) assert.ok(!['water.slip_dash', 'aug.heavy_boulder'].includes(o.id ?? ''));
    for (const id of state.skills.pool) assert.ok(pool.skills.has(id));
  }
});

test('a won run counts the run and the victory', () => {
  const l = recordRunEnd(emptyLedger(), { ...run(), status: 'victory' });
  assert.equal(l.counters.runs, 1);
  assert.equal(l.counters.victory, 1);
  assert.ok(l.unlocked.includes('ach.first_win'));
});

test('a corrupt ledger string is discarded without throwing', () => {
  const store = new Map<string, string>([[LEDGER_KEY, '{nope']]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(loadLedger(storage), emptyLedger());
  store.set(LEDGER_KEY, JSON.stringify({ counters: 5, unlocked: 'x' }));
  assert.deepEqual(loadLedger(storage), emptyLedger());
});

test('a ledger saves and loads, and works without storage', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const l: UnlockLedger = { counters: { runs: 2 }, unlocked: ['ach.first_win'] };
  saveLedger(storage, l);
  assert.deepEqual(loadLedger(storage), l);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadLedger(broken), emptyLedger());
  assert.doesNotThrow(() => saveLedger(broken, l));
  assert.deepEqual(loadLedger(null), emptyLedger());
});

test('the unlock data references only things that exist', () => {
  assert.deepEqual(validateData(data), []);
  const bad = structuredClone(data);
  bad.unlocks['ach.steam_50'].unlocks.skills = ['nope'];
  assert.ok(validateData(bad).some((e) => e.includes('nope')));
});
