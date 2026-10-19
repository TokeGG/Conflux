import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, makeStreams } from '../src/rng.ts';

const draw = (r: Rng, n: number) => Array.from({ length: n }, () => r.next());

test('the same seed gives the same first 1000 values', () => {
  assert.deepEqual(draw(new Rng(42), 1000), draw(new Rng(42), 1000));
});

test('different seeds differ', () => {
  assert.notDeepEqual(draw(new Rng(1), 20), draw(new Rng(2), 20));
});

test('next stays in [0, 1)', () => {
  for (const v of draw(new Rng(7), 5000)) assert.ok(v >= 0 && v < 1);
});

test('int(6) over 6000 draws hits every value 0 to 5, each 800 to 1200 times', () => {
  const r = new Rng(12345);
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) counts[r.int(6)]++;
  for (const c of counts) assert.ok(c >= 800 && c <= 1200, `count ${c} out of range: ${counts}`);
});

test('fork is deterministic, differs by label and ignores how much the parent has drawn', () => {
  const a = new Rng(9);
  const b = new Rng(9);
  draw(b, 500);
  assert.deepEqual(draw(a.fork('x'), 50), draw(b.fork('x'), 50));
  assert.notDeepEqual(draw(new Rng(9).fork('x'), 50), draw(new Rng(9).fork('y'), 50));
});

test('drawing from the combat stream never changes the map stream', () => {
  const quiet = makeStreams(77);
  const busy = makeStreams(77);
  draw(busy.combat, 1000);
  draw(busy.reward, 1000);
  assert.deepEqual(draw(busy.map, 20), draw(quiet.map, 20));
  assert.deepEqual(draw(busy.encounter, 20), draw(quiet.encounter, 20));
});

test('the four streams are different from each other', () => {
  const s = makeStreams(5);
  const firsts = [s.map, s.encounter, s.reward, s.combat].map((r) => r.next());
  assert.equal(new Set(firsts).size, 4);
});

test('weighted with weights [0,1,0] always returns the middle item', () => {
  const r = new Rng(3);
  const weights: Record<string, number> = { a: 0, b: 1, c: 0 };
  for (let i = 0; i < 200; i++) assert.equal(r.weighted(['a', 'b', 'c'], (k) => weights[k]), 'b');
});

test('weighted refuses all-zero weights', () => {
  assert.throws(() => new Rng(3).weighted(['a', 'b'], () => 0), /weight/i);
});

test('pick returns an item of the array and throws on an empty array', () => {
  const r = new Rng(11);
  for (let i = 0; i < 100; i++) assert.ok(['p', 'q', 'r'].includes(r.pick(['p', 'q', 'r'])));
  assert.throws(() => r.pick([]), /empty/i);
});

test('state() is the same for same-seed streams, changes after a draw, and is four numbers', () => {
  const a = new Rng(21);
  const b = new Rng(21);
  assert.deepEqual(a.state(), b.state());
  assert.equal(a.state().length, 4);
  a.next();
  assert.notDeepEqual(a.state(), b.state());
  b.next();
  assert.deepEqual(a.state(), b.state());
});
