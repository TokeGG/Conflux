import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TuningRegistry } from '../src/anim/tuning.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const make = () => {
  const obj = { breathAmp: 0.025, lean: { perSpeed: 0.12, max: 0.35 }, flag: true, name: 'x' };
  const reg = new TuningRegistry();
  reg.register('motion', obj, { title: 'Mob motion', specs: { breathAmp: { min: 0, max: 0.2, step: 0.005 } } });
  return { obj, reg };
};

test('a registered object lists its number and yes/no leaves (nested ones by dotted path) and skips text', () => {
  const { reg } = make();
  const rows = reg.rows('motion');
  assert.deepEqual(rows.map((r) => r.path), ['breathAmp', 'lean.perSpeed', 'lean.max', 'flag']);
  assert.equal(rows[0].min, 0);
  assert.equal(rows[0].max, 0.2);
  assert.equal(rows[1].default, 0.12);
  assert.ok(rows[1].max > 0.12 && rows[1].step > 0, 'a leaf with no spec gets a range around its default');
  assert.equal(reg.list()[0].title, 'Mob motion');
});

test('set changes the live object at once, refuses numbers out of range, and reset puts the default back', () => {
  const { obj, reg } = make();
  assert.equal(reg.set('motion', 'breathAmp', 0.1), null);
  assert.equal(obj.breathAmp, 0.1);
  assert.match(reg.set('motion', 'breathAmp', 5) ?? '', /between/);
  assert.equal(obj.breathAmp, 0.1, 'a refused edit changes nothing');
  assert.match(reg.set('motion', 'breathAmp', NaN) ?? '', /number/);
  assert.equal(reg.set('motion', 'lean.max', 0.5), null);
  assert.equal(obj.lean.max, 0.5);
  assert.equal(reg.set('motion', 'flag', false), null);
  assert.equal(obj.flag, false);
  assert.match(reg.set('motion', 'nope', 1) ?? '', /unknown/);
  reg.reset('motion', 'lean.max');
  assert.equal(obj.lean.max, 0.35);
  reg.reset('motion');
  assert.deepEqual([obj.breathAmp, obj.flag], [0.025, true]);
});

test('changes lists only what differs from the defaults, as patches that paste back', () => {
  const { reg } = make();
  assert.deepEqual(reg.changes(), []);
  reg.set('motion', 'breathAmp', 0.05);
  reg.set('motion', 'lean.perSpeed', 0.2);
  assert.deepEqual(reg.changes(), [
    { path: 'motion.breathAmp', from: 0.025, to: 0.05 },
    { path: 'motion.lean.perSpeed', from: 0.12, to: 0.2 },
  ]);
  const text = reg.exportText();
  assert.deepEqual(JSON.parse(text), { motion: { breathAmp: 0.05, lean: { perSpeed: 0.2 } } });
});

test('keep saves the changes for the session and loadSession applies them to a fresh registry, skipping what no longer fits', () => {
  const store = memory();
  const a = make();
  a.reg.set('motion', 'breathAmp', 0.05);
  assert.equal(a.reg.keep(store), true);
  const b = make();
  assert.deepEqual(b.reg.loadSession(store), []);
  assert.equal(b.obj.breathAmp, 0.05);
  store.setItem('conflux.tuningSession', JSON.stringify({ motion: { gone: 1, breathAmp: 99 }, other: { x: 1 } }));
  const c = make();
  const errors = c.reg.loadSession(store);
  assert.equal(errors.length, 3, 'unknown leaf, out of range, unknown object');
  assert.equal(c.obj.breathAmp, 0.025);
  assert.equal(b.reg.keep(null), false, 'no storage: not saved, still applied');
});

test('putBack resets everything and forgets the saved session', () => {
  const store = memory();
  const { obj, reg } = make();
  reg.set('motion', 'breathAmp', 0.05);
  reg.keep(store);
  reg.putBack(store);
  assert.equal(obj.breathAmp, 0.025);
  assert.equal(store.getItem('conflux.tuningSession'), null);
});

test('registering the same name again replaces it, and a version counter moves on every change', () => {
  const { reg } = make();
  const v = reg.version;
  reg.set('motion', 'breathAmp', 0.05);
  assert.ok(reg.version > v);
  reg.register('motion', { a: 1 });
  assert.deepEqual(reg.rows('motion').map((r) => r.path), ['a']);
});
