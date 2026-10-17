import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayers, defaultData } from '@conflux/shared';
import { DevState } from '../src/dev/devstate.ts';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const make = (storage: ReturnType<typeof fakeStorage> | null = fakeStorage()) => {
  const layers = new DataLayers(defaultData());
  return { layers, state: new DevState(layers, storage), storage };
};

test('stage accepts a valid edit and refuses a bad one with the reason', () => {
  const { state } = make();
  assert.equal(state.stage({ path: 'player.moveSpeed', value: 8 }), null);
  assert.match(state.stage({ path: 'player.moveSpeed', value: 999 })!, /between/);
  assert.match(state.stage({ path: 'skills.nope.damage', value: 1 })!, /unknown/);
  assert.equal(state.staged.length, 1);
});

test('staging the same path again replaces the earlier edit', () => {
  const { state } = make();
  state.stage({ path: 'player.moveSpeed', value: 8 });
  state.stage({ path: 'player.moveSpeed', value: 9 });
  assert.deepEqual(state.staged, [{ path: 'player.moveSpeed', value: 9 }]);
});

test('tryNow puts staged edits in the run layer and clears them', () => {
  const { state, layers } = make();
  state.stage({ path: 'player.moveSpeed', value: 8 });
  assert.equal(layers.current().player.moveSpeed, 6, 'staged edits do nothing until tried');
  assert.deepEqual(state.tryNow(), []);
  assert.equal(layers.current().player.moveSpeed, 8);
  assert.equal(state.staged.length, 0);
  assert.equal(layers.changes()[0].layer, 'run');
});

test('keep moves tried edits into the session layer and saves them', () => {
  const { state, layers, storage } = make();
  state.stage({ path: 'player.health', value: 150 });
  state.tryNow();
  assert.equal(state.keep(), true);
  assert.equal(layers.changes()[0].layer, 'session');
  assert.deepEqual(JSON.parse(storage!.m.get('conflux.devSession')!), [{ path: 'player.health', value: 150 }]);
});

test('loadSession restores saved edits in a new session', () => {
  const a = make();
  a.state.stage({ path: 'player.health', value: 150 });
  a.state.tryNow();
  a.state.keep();
  const layers = new DataLayers(defaultData());
  const b = new DevState(layers, a.storage);
  assert.deepEqual(b.loadSession(), []);
  assert.equal(layers.current().player.health, 150);
});

test('a corrupt or outdated saved session is ignored without throwing', () => {
  const s = fakeStorage();
  s.setItem('conflux.devSession', '{not json');
  const layers = new DataLayers(defaultData());
  assert.doesNotThrow(() => new DevState(layers, s).loadSession());
  assert.deepEqual(layers.changes(), []);
  s.setItem('conflux.devSession', JSON.stringify([{ path: 'skills.removed.damage', value: 3 }, { path: 'player.health', value: 120 }, 'junk', null]));
  const errors = new DevState(layers, s).loadSession();
  assert.equal(errors.length, 1);
  assert.equal(layers.current().player.health, 120);
});

test('with no storage everything still works in memory, and keep reports it could not save', () => {
  const { state, layers } = make(null);
  state.stage({ path: 'player.health', value: 150 });
  state.tryNow();
  assert.equal(state.keep(), false);
  assert.equal(layers.current().player.health, 150);
  assert.deepEqual(state.loadSession(), []);
});

test('storage that throws on write is survived', () => {
  const s = { ...fakeStorage(), setItem: () => { throw new Error('quota'); } };
  const { state, layers } = make(s as never);
  state.stage({ path: 'player.health', value: 150 });
  state.tryNow();
  assert.equal(state.keep(), false);
  assert.equal(layers.current().player.health, 150);
});

test('putBack clears every layer, the staged edits and the saved session', () => {
  const { state, layers, storage } = make();
  state.stage({ path: 'player.health', value: 150 });
  state.tryNow();
  state.keep();
  state.stage({ path: 'player.moveSpeed', value: 8 });
  state.putBack();
  assert.deepEqual(layers.changes(), []);
  assert.equal(state.staged.length, 0);
  assert.equal(storage!.m.has('conflux.devSession'), false);
});

test('changesText is the effective patches as JSON, ready to paste', () => {
  const { state } = make();
  state.stage({ path: 'player.health', value: 150 });
  state.stage({ path: 'skills.fire.fireball.damage', value: 20 });
  state.tryNow();
  assert.deepEqual(JSON.parse(state.changesText()), [
    { path: 'player.health', value: 150 },
    { path: 'skills.fire.fireball.damage', value: 20 },
  ]);
});
