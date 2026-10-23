import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxKeeper, statusFxLayers, statusCopies, statusFxFor, zoneFxFor, type KeptFx } from '../src/fx/keeper.ts';

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

test('every status shows big (scale 1.6 to 2.2 for a normal mob), in more copies on a taller mob, scaled to its height', () => {
  for (const s of ['burning', 'soaked', 'rocked', 'gusted', 'shocked', 'exposed', 'cursed', 'rent', 'poisoned', 'dilated', 'stasis', 'petrified']) {
    const mid = statusFxLayers(s, 2);
    assert.ok(mid.length >= 2, `${s} has copies`);
    for (const l of mid) assert.ok(l.id.startsWith('fx.') && l.scale >= 1.6 && l.scale <= 2.2, `${s} ${l.scale}`);
    const tall = statusFxLayers(s, 3.4);
    assert.ok(tall.length > mid.length);
    assert.ok(Math.max(...tall.map((l) => l.scale)) > Math.max(...mid.map((l) => l.scale)));
    assert.ok(Math.max(...tall.map((l) => l.y)) > Math.max(...mid.map((l) => l.y)), 'spread up the tall body');
    for (const l of [...mid, ...tall]) assert.ok(Number.isFinite(l.scale) && Number.isFinite(l.y) && l.y > 0);
  }
  assert.equal(statusCopies(1.2), 1);
  assert.deepEqual(statusFxLayers('nothing', 2), []);
  assert.ok(statusFxLayers('burning', NaN).length > 0, 'a bad height falls back to the reference mob');
});
