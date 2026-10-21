import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayers, type CustomMobData } from '../src/layers.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';

const base = defaultData();
const biome = Object.keys(base.biomes)[0];

function mob(id = 'enemy.custom.bat', pools: string[] = [biome]): CustomMobData {
  const enemy = { ...structuredClone(base.enemies['enemy.stump']), id, name: 'Bat' };
  return { id, enemy, pools };
}

test('custom mobs join the data after the files: the enemy exists and sits in the chosen pools', () => {
  const layers = new DataLayers(base);
  layers.setCustom([mob()]);
  const d = layers.current();
  assert.equal(d.enemies['enemy.custom.bat'].name, 'Bat');
  assert.ok(d.biomes[biome].enemyPool.includes('enemy.custom.bat'));
  assert.equal(base.enemies['enemy.custom.bat'], undefined, 'the file data is untouched');
  assert.equal(base.biomes[biome].enemyPool.includes('enemy.custom.bat'), false);
  assert.deepEqual(validateData(d), []);
});

test('a pool that does not exist is ignored, and an id is never listed twice', () => {
  const layers = new DataLayers(base);
  layers.setCustom([mob('enemy.custom.bat', [biome, biome, 'biome.nowhere'])]);
  const pool = layers.current().biomes[biome].enemyPool;
  assert.equal(pool.filter((x) => x === 'enemy.custom.bat').length, 1);
  assert.deepEqual(validateData(layers.current()), []);
});

test('removing a mob takes it out of every pool and tells the listeners', () => {
  const layers = new DataLayers(base);
  const gone: string[] = [];
  layers.onCustomRemoved((id) => gone.push(id));
  layers.setCustom([mob('enemy.custom.bat', Object.keys(base.biomes))]);
  assert.ok(Object.values(layers.current().biomes).every((b) => b.enemyPool.includes('enemy.custom.bat')));
  layers.removeCustom('enemy.custom.bat');
  const d = layers.current();
  assert.equal(d.enemies['enemy.custom.bat'], undefined);
  assert.ok(Object.values(d.biomes).every((b) => !b.enemyPool.includes('enemy.custom.bat')));
  assert.deepEqual(gone, ['enemy.custom.bat']);
  layers.removeCustom('enemy.custom.bat');
  assert.deepEqual(gone, ['enemy.custom.bat'], 'removing twice says nothing more');
});

test('a mob shows in the Changes list as an addition, and its undo removes it', () => {
  const layers = new DataLayers(base);
  const gone: string[] = [];
  layers.onCustomRemoved((id) => gone.push(id));
  layers.addCustom(mob());
  const rows = layers.changes();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].path, rows[0].layer], ['enemies.enemy.custom.bat', 'custom']);
  layers.revert(rows[0].path);
  assert.equal(layers.changes().length, 0);
  assert.deepEqual(gone, ['enemy.custom.bat']);
});

test('numbers of a custom mob can be tuned with patches, and "put all back" leaves the mob itself', () => {
  const layers = new DataLayers(base);
  layers.addCustom(mob());
  assert.deepEqual(layers.setRun([{ path: 'enemies.enemy.custom.bat.hp', value: 77 }]), []);
  assert.equal(layers.current().enemies['enemy.custom.bat'].hp, 77);
  layers.reset();
  assert.equal(layers.current().enemies['enemy.custom.bat'].hp, mob().enemy.hp);
  assert.equal(layers.customMobs().length, 1);
});

test('adding a mob with an id that already exists replaces it, and cannot replace a built-in enemy', () => {
  const layers = new DataLayers(base);
  layers.addCustom(mob());
  const second = mob();
  second.enemy.name = 'Bat 2';
  layers.addCustom(second);
  assert.equal(layers.customMobs().length, 1);
  assert.equal(layers.current().enemies['enemy.custom.bat'].name, 'Bat 2');
  assert.throws(() => layers.addCustom(mob('enemy.stump')), /enemy\.stump/);
});

test('the version changes whenever the custom content does', () => {
  const layers = new DataLayers(base);
  const v = layers.version;
  layers.addCustom(mob());
  assert.ok(layers.version > v);
});
