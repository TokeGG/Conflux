import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devEnabled, setDevFlag } from '../src/dev/access.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test('without ?dev or a saved flag there is no dev panel', () => {
  assert.equal(devEnabled(new URL('https://x.test/'), store()), false);
});

test('?dev turns it on and remembers it, so it is there next time without the parameter', () => {
  const s = store();
  assert.equal(devEnabled(new URL('https://x.test/?dev'), s), true);
  assert.equal(devEnabled(new URL('https://x.test/'), s), true);
});

test('?dev=0 turns it off again', () => {
  const s = store();
  devEnabled(new URL('https://x.test/?dev'), s);
  assert.equal(devEnabled(new URL('https://x.test/?dev=0'), s), false);
  assert.equal(devEnabled(new URL('https://x.test/'), s), false);
});

test('setDevFlag saves and clears the flag (the start page checkbox uses it), and blocked storage does not throw', () => {
  const s = store();
  setDevFlag(s, true);
  assert.equal(devEnabled(new URL('https://x.test/'), s), true);
  setDevFlag(s, false);
  assert.equal(devEnabled(new URL('https://x.test/'), s), false);
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => { throw new Error('no'); } };
  assert.doesNotThrow(() => setDevFlag(broken, true));
  assert.equal(devEnabled(new URL('https://x.test/?dev'), broken), true);
});
