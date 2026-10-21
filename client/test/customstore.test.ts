import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { DataLayers, defaultData, validateData } from '@conflux/shared';
import { CustomContentStore, removeMob, type CustomMob } from '../src/dev/import/store.ts';
import { applyElement, defaultEnemyFrom, matchClips } from '../src/dev/import/mobForm.ts';
import { readExportZip } from '../src/dev/import/exportZip.ts';
import type { ModelReport } from '../src/dev/import/inspect.ts';

const base = defaultData();
const humanoid: ModelReport = { meshes: 1, triangles: 9000, hasSkin: true, bones: ['Hips'], clips: [], textures: [], size: { x: 0.7, y: 1.8, z: 0.4 }, min: { x: -0.35, y: 0, z: -0.2 }, warnings: [] };

function mobNamed(name: string, pools: string[] = Object.keys(base.biomes)): CustomMob {
  const enemy = defaultEnemyFrom(humanoid, name);
  const slug = enemy.id.replace('enemy.custom.', '');
  return { id: enemy.id, name, glbKey: `model.custom.${slug}`, enemy, pools, licence: { author: '', licence: '', source: '', verified: false } };
}
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

async function open() {
  const s = await CustomContentStore.open();
  assert.ok(s, 'IndexedDB is there');
  return s;
}

test('put then get round-trips the model bytes and the mob', async () => {
  const store = await open();
  const mob = mobNamed('Round Trip');
  const glb = bytes(5000);
  await store.put(mob, glb);
  const back = await store.get(mob.id);
  assert.ok(back);
  assert.deepEqual(back.mob, mob);
  assert.deepEqual(back.glb, glb);
  assert.equal(await store.get('enemy.custom.nobody'), null);
});

test('list returns the saved mobs', async () => {
  const store = await open();
  await store.put(mobNamed('List One'), bytes(10));
  await store.put(mobNamed('List Two'), bytes(10));
  const ids = (await store.list()).map((m) => m.id);
  assert.ok(ids.includes('enemy.custom.list_one') && ids.includes('enemy.custom.list_two'));
});

test('removing a mob deletes its model and takes it out of every biome pool', async () => {
  const store = await open();
  const layers = new DataLayers(base);
  const mob = mobNamed('Doomed');
  await store.put(mob, bytes(20));
  layers.addCustom({ id: mob.id, enemy: mob.enemy, pools: mob.pools });
  assert.ok(Object.values(layers.current().biomes).every((b) => b.enemyPool.includes(mob.id)));
  await removeMob(store, layers, mob.id);
  assert.equal(await store.get(mob.id), null);
  assert.ok(!(await store.list()).some((m) => m.id === mob.id));
  assert.ok(Object.values(layers.current().biomes).every((b) => !b.enemyPool.includes(mob.id)));
  assert.equal(layers.current().enemies[mob.id], undefined);
});

test('the export zip has the model, the enemy, the licence stub and the pools, and loads back identically', async () => {
  const store = await open();
  const mob = mobNamed('Zipped One');
  const glb = bytes(3333);
  await store.put(mob, glb);
  const zip = await store.exportZip();
  const names = Object.keys(unzipSync(zip));
  for (const want of ['models/zipped_one.glb', 'enemies/zipped_one.json', 'licenses/zipped_one.json']) assert.ok(names.includes(want), `${want} in ${names.join(', ')}`);
  const back = readExportZip(zip).find((m) => m.slug === 'zipped_one')!;
  assert.deepEqual(back.glb, glb);
  assert.deepEqual(back.enemy, mob.enemy);
  assert.deepEqual(back.pools, mob.pools);
  assert.deepEqual(back.licence, mob.licence);
});

test('the licence stub starts blank and unverified', async () => {
  const mob = mobNamed('Stub');
  assert.deepEqual(mob.licence, { author: '', licence: '', source: '', verified: false });
});

test('a default enemy from a 1.8 m humanoid has a slim capsule about as tall as it', () => {
  const e = defaultEnemyFrom(humanoid, 'Tall Guy');
  assert.equal(e.id, 'enemy.custom.tall_guy');
  assert.equal(e.model, 'model.custom.tall_guy');
  const h = e.hurtboxes[0];
  assert.ok(h.r > 0 && h.r < 1, `radius ${h.r}`);
  const top = Math.max(h.a[1], h.b[1]) + h.r;
  assert.ok(Math.abs(top - 1.8) < 0.1, `top ${top}`);
  assert.ok(h.a[1] - h.r >= -1e-9, 'the capsule starts on the ground');
});

test('a default enemy passes validateData once its model id is registered', () => {
  const e = defaultEnemyFrom(humanoid, 'Valid Bat');
  const layers = new DataLayers(base);
  layers.addCustom({ id: e.id, enemy: e, pools: Object.keys(base.biomes) });
  const modelIds = new Set([...Object.values(base.enemies).map((x) => x.model), e.model]);
  assert.deepEqual(validateData(layers.current(), { modelIds }), []);
});

test('a model with clips of its own gets them mapped by name, one without gets a procedural preset', () => {
  const withClips: ModelReport = { ...humanoid, clips: ['Idle_Loop', 'Walk_Forward', 'Run', 'Attack_01', 'Attack_02', 'Block', 'Hit_React', 'Death'].map((name) => ({ name, duration: 1 })) };
  const e = defaultEnemyFrom(withClips, 'Mapped');
  assert.equal(e.rig.type, 'own');
  assert.equal(e.rig.clips!.idle, 'Idle_Loop');
  assert.equal(e.rig.clips!.walk, 'Walk_Forward');
  assert.deepEqual(e.rig.clips!.attack, ['Attack_01', 'Attack_02']);
  assert.deepEqual(e.rig.clips!.guard, ['Block']);
  const plain = defaultEnemyFrom(humanoid, 'Plain');
  assert.equal(plain.rig.type, 'procedural');
  assert.ok(plain.rig.preset);
});

test('matchClips falls back to run for walk, and finds nothing when nothing matches', () => {
  assert.equal(matchClips(['Idle', 'Run']).walk, 'Run');
  assert.deepEqual(matchClips(['Dance']), {});
});

test('applyElement fills weak and resist from the cycle and keeps the rest', () => {
  const e = defaultEnemyFrom(humanoid, 'Elemental');
  const fire = applyElement(e, 'fire');
  assert.equal(fire.element, 'fire');
  assert.deepEqual(fire.weak, ['water']);
  assert.deepEqual(fire.resist, ['wind']);
  assert.equal(fire.hp, e.hp);
  assert.deepEqual(applyElement(fire, 'none').weak, []);
});

test('open returns null when IndexedDB is not available', async () => {
  const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  try {
    assert.equal(await CustomContentStore.open(), null);
  } finally {
    (globalThis as { indexedDB?: unknown }).indexedDB = saved;
  }
});
