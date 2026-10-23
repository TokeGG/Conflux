// The Cloudflare Worker entry: /api/* goes to the accounts handler, everything else to the static assets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../index.ts';

const assets = (body: string) => ({ fetch: async () => new Response(body, { status: 200 }) });

test('/api/health is answered by the accounts handler, without a KV binding', async () => {
  const res = await worker.fetch(new Request('https://conflux.test/api/health'), { ASSETS: assets('page') });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, store: 'none' });
});

test('/api/health reports the KV store when it is bound', async () => {
  const kv = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
  const res = await worker.fetch(new Request('https://conflux.test/api/health'), { ASSETS: assets('page'), CONFLUX_KV: kv as never });
  assert.deepEqual(await res.json(), { ok: true, store: 'cloudflare-kv' });
});

test('every other path is served from the static assets', async () => {
  const res = await worker.fetch(new Request('https://conflux.test/'), { ASSETS: assets('the game') });
  assert.equal(await res.text(), 'the game');
});
