import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyBestLine, loadDailyBest, saveDailyBest } from '../src/dailyBest.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('nothing is recorded for a day nobody has played', () => {
  assert.equal(loadDailyBest(store(), 20261023), 0);
  assert.equal(loadDailyBest(null, 20261023), 0);
});

test('the best result of a day is kept, and a worse one does not replace it', () => {
  const s = store();
  assert.equal(saveDailyBest(s, 20261023, 7), 7);
  assert.equal(saveDailyBest(s, 20261023, 4), 7);
  assert.equal(saveDailyBest(s, 20261023, 9), 9);
  assert.equal(loadDailyBest(s, 20261023), 9);
  assert.equal(loadDailyBest(s, 20261024), 0, 'another day starts again');
});

test('a corrupt saved value counts as nothing', () => {
  const s = store();
  s.setItem('conflux.daily.20261023', 'banana');
  assert.equal(loadDailyBest(s, 20261023), 0);
});

test('the best line says how far you got, or invites a first try', () => {
  assert.match(dailyBestLine(0), /not yet|first/i);
  assert.match(dailyBestLine(1), /1 room\b/);
  assert.match(dailyBestLine(9), /9 rooms/);
});
