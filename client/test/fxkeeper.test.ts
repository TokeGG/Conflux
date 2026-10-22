import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxKeeper, statusFxFor, zoneFxFor, type KeptFx } from '../src/fx/keeper.ts';

function harness() {
  const spawned: { id: string; scale: number; handle: { done: boolean; stopped: boolean; stop(): void }; at: () => { x: number; y: number; z: number } | null }[] = [];
  const keeper = new FxKeeper((id, _pos, opts) => {
    const handle = { done: false, stopped: false, stop() { this.stopped = true; } };
    spawned.push({ id, scale: opts.scale ?? 1, handle, at: opts.follow ?? (() => null) });
    return Promise.resolve(handle);
  });
  return { keeper, spawned };
}
const at = (x: number): KeptFx => ({ id: 'fx.leaf_cyclone', pos: { x, y: 0, z: 0 }, scale: 1 });

test('an effect starts once for a key that stays, and follows its latest position', async () => {
  const { keeper, spawned } = harness();
  await keeper.sync(new Map([['a', at(1)]]));
  await keeper.sync(new Map([['a', at(5)]]));
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].at()!.x, 5);
});

test('an effect that played out is started again while its key is still there', async () => {
  const { keeper, spawned } = harness();
  await keeper.sync(new Map([['a', at(0)]]));
  spawned[0].handle.done = true;
  await keeper.sync(new Map([['a', at(0)]]));
  assert.equal(spawned.length, 2);
});

test('an effect is stopped when its key goes away, and not started again', async () => {
  const { keeper, spawned } = harness();
  await keeper.sync(new Map([['a', at(0)]]));
  await keeper.sync(new Map());
  assert.equal(spawned[0].handle.stopped, true);
  await keeper.sync(new Map());
  assert.equal(spawned.length, 1);
});

test('each key keeps its own effect', async () => {
  const { keeper, spawned } = harness();
  await keeper.sync(new Map([['a', at(0)], ['b', { ...at(0), id: 'fx.campfire_loop' }]]));
  assert.deepEqual(spawned.map((s) => s.id), ['fx.leaf_cyclone', 'fx.campfire_loop']);
});

test('a zone shows its skill\'s zone effect, then its trail effect, then the reaction table\'s', () => {
  assert.equal(zoneFxFor('wind.cyclone', { 'wind.cyclone': { fx: { zone: 'fx.leaf_cyclone' } } as never })?.id, 'fx.leaf_cyclone');
  assert.equal(zoneFxFor('fire.flame_dash', { 'fire.flame_dash': { fx: { trail: 'fx.burning_ground' } } as never })?.id, 'fx.burning_ground');
  assert.equal(zoneFxFor('fire_tornado', {})?.id, 'fx.fire_tornado');
  assert.equal(zoneFxFor('nonsense', {}), null);
});

test('a gust, a fire, a soaking and a rock status each show an effect around the enemy', () => {
  for (const s of ['gusted', 'burning', 'soaked', 'rocked']) assert.ok(statusFxFor(s)?.id.startsWith('fx.'), s);
  assert.equal(statusFxFor('nothing'), null);
});
