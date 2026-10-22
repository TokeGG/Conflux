import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, keyFor, loadBindings, rebind, saveBindings } from '../src/keybinds.ts';
import { defaultBindings } from '../src/input.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('every action has exactly one key, and no two actions share one, by default', () => {
  const b = defaultBindings();
  const keys = ACTIONS.map((a) => keyFor(b, a.id));
  assert.ok(keys.every((k) => typeof k === 'string' && k.length > 0));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(ACTIONS.length, 12);
});

test('rebinding an action sets its key', () => {
  const r = rebind(defaultBindings(), 'jump', 'KeyX');
  assert.equal(r.error, undefined);
  assert.equal(keyFor(r.bindings, 'jump'), 'KeyX');
});

test('binding a key another action uses swaps the two, so nothing is left unbound', () => {
  const b = defaultBindings();
  const r = rebind(b, 'jump', keyFor(b, 'dodge'));
  assert.equal(keyFor(r.bindings, 'jump'), keyFor(b, 'dodge'));
  assert.equal(keyFor(r.bindings, 'dodge'), keyFor(b, 'jump'));
  const keys = ACTIONS.map((a) => keyFor(r.bindings, a.id));
  assert.equal(new Set(keys).size, keys.length);
});

test('Escape cannot be bound: it opens the menu', () => {
  const b = defaultBindings();
  const r = rebind(b, 'jump', 'Escape');
  assert.match(r.error ?? '', /Esc/);
  assert.equal(keyFor(r.bindings, 'jump'), keyFor(b, 'jump'));
});

test('bindings persist, and a corrupt or incomplete saved set falls back to the defaults', () => {
  const s = store();
  saveBindings(s, rebind(defaultBindings(), 'jump', 'KeyX').bindings);
  assert.equal(keyFor(loadBindings(s), 'jump'), 'KeyX');
  s.setItem('conflux.keys', '{nope');
  assert.deepEqual(loadBindings(s), defaultBindings());
  s.setItem('conflux.keys', JSON.stringify({ forward: 'KeyW' }));
  assert.deepEqual(loadBindings(s), defaultBindings());
  s.setItem('conflux.keys', JSON.stringify({ ...defaultBindings(), jump: 'Escape' }));
  assert.deepEqual(loadBindings(s), defaultBindings());
  assert.deepEqual(loadBindings(null), defaultBindings());
});

test('keyLabel shows a key the way a player reads it', async () => {
  const { keyLabel } = await import('../src/keybinds.ts');
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit2'), '2');
  assert.equal(keyLabel('ShiftLeft'), 'Shift');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('ArrowUp'), 'Up');
  assert.equal(keyLabel('Numpad5'), 'Num 5');
  assert.equal(keyLabel('Tab'), 'Tab');
});

test('three element keys, 1 to 3, by default', () => {
  assert.deepEqual(defaultBindings().elements, ['Digit1', 'Digit2', 'Digit3']);
  assert.equal(ACTIONS.filter((a) => a.id.startsWith('element')).length, 3);
});

test('a binding set saved with four element keys loads with the first three', () => {
  const s = store();
  const old = { ...defaultBindings(), elements: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], jump: 'KeyX' };
  s.setItem('conflux.keys', JSON.stringify(old));
  const b = loadBindings(s);
  assert.deepEqual(b.elements, ['Digit1', 'Digit2', 'Digit3']);
  assert.equal(b.jump, 'KeyX');
});
