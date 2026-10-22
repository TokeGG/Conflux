import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, safeEqual, newToken, randomBytes, PBKDF2_ITERATIONS } from '../../api/src/crypto.ts';
import { KvStore, MemoryStore, fakeKv } from '../../api/src/store.ts';
import { FileStore } from '../../api/src/fileStore.ts';
import { Limiter } from '../../api/src/limiter.ts';
import { createApi } from '../../api/src/handler.ts';

const OWNER_CODE = 'correct horse battery';
const make = (now = { t: 1_000_000 }) => {
  const store = new MemoryStore(() => now.t);
  const api = createApi({ store, env: { OWNER_CODE, OWNER_NAMES: 'Boss,Chief' }, now: () => now.t });
  const call = async (method: string, url: string, body?: unknown, token?: string, ip = '1.1.1.1') => {
    const res = await api(new Request(`https://game.test${url}`, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  return { store, call, now };
};

test('passwords: PBKDF2 with a salt, same input same hash, different salt different hash, iterations >= 100000', async () => {
  assert.ok(PBKDF2_ITERATIONS >= 100_000);
  const salt = randomBytes(16);
  const a = await hashPassword('hunter22', salt);
  assert.equal(a, await hashPassword('hunter22', salt));
  assert.notEqual(a, await hashPassword('hunter22', randomBytes(16)));
  assert.notEqual(a, await hashPassword('hunter23', salt));
  assert.ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd'));
  assert.notEqual(newToken(), newToken());
});

test('register, login, me: a session token identifies the account; the password is never returned', async () => {
  const { call } = make();
  const r = await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token && r.body.account.name === 'Ann' && r.body.account.role === 'player');
  assert.doesNotMatch(JSON.stringify(r.body), /hash|salt|longenough1/);
  assert.equal((await call('GET', '/api/me', undefined, r.body.token)).body.account.name, 'Ann');
  assert.equal((await call('GET', '/api/me')).status, 401);
  const l = await call('POST', '/api/login', { name: 'ann', password: 'longenough1' });
  assert.equal(l.status, 200);
  assert.equal((await call('POST', '/api/login', { name: 'ann', password: 'nope-nope' })).status, 401);
  assert.equal((await call('POST', '/api/register', { name: 'ANN', password: 'longenough1' })).status, 409);
  assert.equal((await call('POST', '/api/register', { name: 'x', password: 'longenough1' })).status, 400);
  assert.equal((await call('POST', '/api/register', { name: 'Bob', password: 'short' })).status, 400);
});

test('sessions end on logout and after their lifetime', async () => {
  const { call, now } = make();
  const { body } = await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' });
  await call('POST', '/api/logout', {}, body.token);
  assert.equal((await call('GET', '/api/me', undefined, body.token)).status, 401);
  const l = await call('POST', '/api/login', { name: 'Ann', password: 'longenough1' });
  now.t += 31 * 24 * 3600 * 1000;
  assert.equal((await call('GET', '/api/me', undefined, l.body.token)).status, 401);
});

test('reserved owner names need the owner code; with it the account is the owner', async () => {
  const { call } = make();
  assert.equal((await call('POST', '/api/register', { name: 'boss', password: 'longenough1' })).status, 403);
  assert.equal((await call('POST', '/api/register', { name: 'boss', password: 'longenough1', code: 'wrong' })).status, 403);
  const ok = await call('POST', '/api/register', { name: 'Boss', password: 'longenough1', code: OWNER_CODE });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.account.role, 'owner');
  assert.equal(ok.body.account.dev, true);
  // an ordinary name does not become owner by sending the code
  const p = await call('POST', '/api/register', { name: 'Pat', password: 'longenough1', code: OWNER_CODE });
  assert.equal(p.body.account.role, 'player');
});

test('with no owner code configured, a reserved name cannot be registered at all', async () => {
  const store = new MemoryStore();
  const api = createApi({ store, env: { OWNER_NAMES: 'boss' } });
  const res = await api(new Request('https://x.test/api/register', { method: 'POST', body: JSON.stringify({ name: 'boss', password: 'longenough1', code: '' }) }));
  assert.equal(res.status, 403);
});

test('grants: only the owner grants dev; a dev account sees dev, a plain one does not; revoking works', async () => {
  const { call } = make();
  const owner = (await call('POST', '/api/register', { name: 'Boss', password: 'longenough1', code: OWNER_CODE })).body.token;
  const ann = (await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' })).body;
  assert.equal(ann.account.dev, false);
  assert.equal((await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'dev', on: true }, ann.token)).status, 403);
  assert.equal((await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'dev', on: true })).status, 401);
  assert.equal((await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'dev', on: true }, owner)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, ann.token)).body.account.dev, true);
  assert.equal((await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'wizard', on: true }, owner)).status, 400);
  await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'dev', on: false }, owner);
  assert.equal((await call('GET', '/api/me', undefined, ann.token)).body.account.dev, false);
  assert.equal((await call('POST', '/api/admin/grant', { name: 'Nobody', grant: 'dev', on: true }, owner)).status, 404);
});

test('admin lists accounts and the log (owner only); the log records grants and logins without secrets', async () => {
  const { call } = make();
  const owner = (await call('POST', '/api/register', { name: 'Boss', password: 'longenough1', code: OWNER_CODE })).body.token;
  const ann = (await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' })).body.token;
  await call('POST', '/api/admin/grant', { name: 'Ann', grant: 'dev', on: true }, owner);
  assert.equal((await call('GET', '/api/admin/accounts', undefined, ann)).status, 403);
  const list = (await call('GET', '/api/admin/accounts', undefined, owner)).body.accounts as { name: string; grants: string[] }[];
  assert.deepEqual(list.map((a) => a.name).sort(), ['Ann', 'Boss']);
  assert.deepEqual(list.find((a) => a.name === 'Ann')!.grants, ['dev']);
  const log = (await call('GET', '/api/admin/log', undefined, owner)).body.log as { text: string }[];
  assert.ok(log.some((e) => /granted dev to Ann/.test(e.text)));
  assert.doesNotMatch(JSON.stringify(log), /longenough1|hash/);
});

test('rate limiting: repeated wrong passwords lock the login, registration is limited per address', async () => {
  const { call, now } = make();
  await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' }, undefined, '9.9.9.9');
  for (let i = 0; i < 6; i++) assert.equal((await call('POST', '/api/login', { name: 'Ann', password: 'bad-bad-bad' }, undefined, '2.2.2.2')).status, 401);
  assert.equal((await call('POST', '/api/login', { name: 'Ann', password: 'longenough1' }, undefined, '2.2.2.2')).status, 429);
  now.t += 11 * 60 * 1000;
  assert.equal((await call('POST', '/api/login', { name: 'Ann', password: 'longenough1' }, undefined, '2.2.2.2')).status, 200);
  const r = make();
  for (let i = 0; i < 5; i++) assert.equal((await r.call('POST', '/api/register', { name: `User${i}`, password: 'longenough1' }, undefined, '3.3.3.3')).status, 200);
  assert.equal((await r.call('POST', '/api/register', { name: 'User9', password: 'longenough1' }, undefined, '3.3.3.3')).status, 429);
});

test('the limiter counts hits inside its window only', async () => {
  const t = { v: 0 };
  const l = new Limiter(new MemoryStore(() => t.v), () => t.v);
  assert.ok(await l.allowed('k', 2, 1000));
  await l.hit('k', 1000);
  await l.hit('k', 1000);
  assert.ok(!(await l.allowed('k', 2, 1000)));
  t.v = 2000;
  assert.ok(await l.allowed('k', 2, 1000));
});

test('tuning: anyone reads it, only dev accounts write it, bad patches are refused, and it is kept', async () => {
  const { call } = make();
  const owner = (await call('POST', '/api/register', { name: 'Boss', password: 'longenough1', code: OWNER_CODE })).body.token;
  const ann = (await call('POST', '/api/register', { name: 'Ann', password: 'longenough1' })).body.token;
  assert.deepEqual((await call('GET', '/api/tuning')).body.patches, []);
  const patch = { path: 'player.health', value: 150 };
  assert.equal((await call('PUT', '/api/tuning', { patches: [patch] }, ann)).status, 403);
  assert.equal((await call('PUT', '/api/tuning', { patches: [{ path: 'nope.nothing', value: 1 }] }, owner)).status, 400);
  assert.equal((await call('PUT', '/api/tuning', { patches: [{ path: 'player.health', value: 'x' }] }, owner)).status, 400);
  assert.equal((await call('PUT', '/api/tuning', { patches: [patch] }, owner)).status, 200);
  assert.deepEqual((await call('GET', '/api/tuning')).body.patches, [patch]);
});

test('unknown routes are 404, wrong methods 405, a missing store is a 503 the client treats as guest', async () => {
  const { call } = make();
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  assert.equal((await call('GET', '/api/login')).status, 405);
  assert.equal((await call('GET', '/api/health')).status, 200);
  const none = createApi({ store: null, env: {} });
  assert.equal((await none(new Request('https://x.test/api/me'))).status, 503);
});

test('stores: file backend persists, KV backend pages through keys and expires, ttl and prefix listing work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfx-'));
  const file = path.join(dir, 'store.json');
  const a = new FileStore(file);
  await a.put('acct:a', '1');
  await a.put('acct:b', '2');
  await a.put('sess:x', '3');
  const b = new FileStore(file);
  assert.equal(await b.get('acct:a'), '1');
  assert.deepEqual((await b.list('acct:')).sort(), ['acct:a', 'acct:b']);
  await b.delete('acct:a');
  assert.equal(await new FileStore(file).get('acct:a'), null);
  fs.rmSync(dir, { recursive: true });

  const kv = new KvStore(fakeKv(2));
  for (let i = 0; i < 5; i++) await kv.put(`acct:${i}`, String(i));
  await kv.put('other', 'x');
  assert.equal((await kv.list('acct:')).length, 5);
  await kv.put('short', 'x', 5); // below KV's 60 s minimum: raised, not rejected
  const t = { v: 0 };
  const m = new MemoryStore(() => t.v);
  await m.put('k', 'v', 10);
  t.v = 11_000;
  assert.equal(await m.get('k'), null);
});
