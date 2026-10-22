import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountSession, apiBase, type AccountInfo } from '../src/account/session.ts';
import { adminPageAllowed, chipText, devPanelAllowed, formError } from '../src/account/logic.ts';
import { createApi } from '../../api/src/handler.ts';
import { MemoryStore } from '../../api/src/store.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const acct = (o: Partial<AccountInfo> = {}): AccountInfo => ({ name: 'Ann', role: 'player', grants: [], dev: false, admin: false, ...o });

test('who sees the dev panel: dev or owner accounts; ?dev only counts in local development', () => {
  assert.equal(devPanelAllowed(null, false, true), false);
  assert.equal(devPanelAllowed(null, true, true), true);
  assert.equal(devPanelAllowed(null, true, false), false);
  assert.equal(devPanelAllowed(acct(), false, true), false);
  assert.equal(devPanelAllowed(acct({ dev: true }), false, false), true);
  assert.equal(devPanelAllowed(acct({ role: 'owner', dev: true, admin: true }), false, false), true);
});

test('the Admin page is the owner\'s only; the chip says who you are', () => {
  assert.equal(adminPageAllowed(acct({ dev: true, admin: true })), false);
  assert.equal(adminPageAllowed(acct({ role: 'owner' })), true);
  assert.equal(chipText(null, false), 'Guest');
  assert.equal(chipText(null, true), 'Sign in');
  assert.equal(chipText(acct(), true), 'Ann');
  assert.equal(chipText(acct({ dev: true }), true), 'Ann (dev)');
  assert.equal(chipText(acct({ role: 'owner' }), true), 'Ann (owner)');
});

test('the sign-in form is checked before sending', () => {
  assert.ok(formError('login', 'a', 'x'));
  assert.ok(formError('register', 'Ann', 'short'));
  assert.equal(formError('register', 'Ann', 'longenough1'), null);
  assert.ok(formError('login', 'Ann', ''));
});

test('the API base is empty (same origin) unless VITE_API_URL is set', () => {
  assert.equal(apiBase({}), '');
  assert.equal(apiBase({ VITE_API_URL: 'http://x.test/' }), 'http://x.test');
});

test('a session registers, resumes after a reload, and signs out, against the real handler', async () => {
  const api = createApi({ store: new MemoryStore(), env: { OWNER_CODE: 'sesame', OWNER_NAMES: 'boss' } });
  const fetcher = (url: string, init?: RequestInit) => api(new Request(`https://game.test${url}`, init));
  const tokens = store();
  const a = new AccountSession(tokens, fetcher);
  const bad = await a.register('boss', 'longenough1');
  assert.equal(bad.ok, false);
  const ok = await a.register('boss', 'longenough1', 'sesame');
  assert.ok(ok.ok && ok.value.role === 'owner');
  const again = new AccountSession(tokens, fetcher); // a new page load with the same storage
  assert.equal((await again.resume())?.name, 'boss');
  await again.logout();
  assert.equal(await new AccountSession(tokens, fetcher).resume(), null);
});

test('with no answer (network down, or the static site replying with HTML) the player is a guest and the stored token is kept', async () => {
  const tokens = store();
  tokens.setItem('conflux.token', 'abc');
  const down = new AccountSession(tokens, async () => { throw new Error('offline'); });
  assert.equal(await down.resume(), null);
  assert.equal(tokens.getItem('conflux.token'), 'abc');
  const html = new AccountSession(tokens, async () => new Response('<html></html>', { status: 200 }));
  assert.equal(await html.resume(), null);
  const r = await html.login('Ann', 'longenough1');
  assert.ok(!r.ok && r.offline);
  assert.deepEqual(await html.fetchTuning(), []);
});

test('a token the server no longer knows is dropped', async () => {
  const api = createApi({ store: new MemoryStore(), env: {} });
  const tokens = store();
  tokens.setItem('conflux.token', 'stale');
  const s = new AccountSession(tokens, (u, i) => api(new Request(`https://game.test${u}`, i)));
  assert.equal(await s.resume(), null);
  assert.equal(tokens.getItem('conflux.token'), null);
});
