import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FxSystem, EVENT_LOOP_LIFE_MS } from '../src/fx/sprites.ts';
import { FxKeeper } from '../src/fx/keeper.ts';
import type { FxDef } from '../src/assets/loader.ts';

const sheet = JSON.parse(readFileSync(new URL('../public/assets/fx/spellwoven/fx.json', import.meta.url), 'utf8')) as { effects: FxDef[] };
const defs = new Map(sheet.effects.map((e) => [`fx.${e.id}`, e]));
const loopId = [...defs.entries()].find(([, d]) => d.loop)![0];
const onceId = [...defs.entries()].find(([, d]) => !d.loop)![0];

function system() {
  const scene = new THREE.Scene();
  const loader = { loadFxSheet: async (id: string) => ({ texture: new THREE.Texture(), def: defs.get(id)! }) };
  const fx = new FxSystem(scene, loader as never, 'linear');
  const camera = new THREE.PerspectiveCamera();
  return { fx, scene, camera };
}
const P = { x: 0, y: 0, z: 0 };

test('a looping effect spawned for an event (no follow) ends by itself', async () => {
  const { fx, camera } = system();
  const h = await fx.spawn(loopId, P);
  fx.update(EVENT_LOOP_LIFE_MS / 1000 - 0.2, camera);
  assert.equal(fx.active, 1);
  fx.update(0.4, camera);
  assert.equal(fx.active, 0);
  assert.equal(h.done, true);
});

test('`life` in the options sets the maximum life, and a followed loop stays until stopped', async () => {
  const { fx, camera } = system();
  await fx.spawn(loopId, P, { life: 300 });
  const kept = await fx.spawn(loopId, P, { follow: () => P });
  fx.update(0.5, camera);
  assert.equal(fx.active, 1);
  fx.update(10, camera);
  assert.equal(fx.active, 1, 'followed effects belong to the keeper');
  kept.stop();
  fx.update(0.1, camera);
  assert.equal(fx.active, 0);
});

test('clear() removes every live effect from the scene, followed ones included, and spawns still loading', async () => {
  const { fx, scene, camera } = system();
  await fx.spawn(loopId, P);
  await fx.spawn(onceId, P);
  await fx.spawn(loopId, P, { follow: () => P });
  const pending = fx.spawn(loopId, P);
  fx.clear();
  assert.equal(fx.active, 0);
  assert.equal(scene.children.length, 0);
  const h = await pending;
  assert.equal(fx.active, 0, 'a spawn that was loading when the room changed does not appear');
  assert.equal(h.done, true);
  fx.update(0.1, camera);
  assert.equal(scene.children.length, 0);
  await fx.spawn(onceId, P);
  assert.equal(fx.active, 1, 'effects work again after a clear');
});

test('the keeper stops everything on reset and starts a present key afresh', async () => {
  const stopped: boolean[] = [];
  let n = 0;
  const keeper = new FxKeeper(async () => (n++, { done: false, stop: () => stopped.push(true) }));
  const fxo = { id: 'x', pos: P, scale: 1 };
  await keeper.sync(new Map([['a', fxo]]));
  keeper.reset();
  assert.equal(stopped.length, 1);
  await keeper.sync(new Map([['a', fxo]]));
  assert.equal(n, 2);
});
