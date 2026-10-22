import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateData, type ValidationContext } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { idle, run } from './helpers.ts';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const manifest = json('../../client/public/assets/assets.json') as { id: string; files: { chunky: string } }[];
const ctx: ValidationContext = {
  fxIds: new Set<string>(json('../data/fxIds.json')),
  clipNames: new Set<string>(json('../../client/public/assets/clips/wizardpack/index.json').clips.map((c: { name: string }) => c.name)),
  modelIds: new Set(manifest.filter((a) => a.id.startsWith('model.')).map((a) => a.id)),
};
const data = defaultData();
const NEW = ['enemy.skeleton', 'enemy.skeleton_mage', 'enemy.bone_giant', 'enemy.zombie', 'enemy.vampire', 'enemy.ghost', 'enemy.fire_elemental', 'enemy.water_elemental', 'enemy.wraith', 'enemy.book', 'enemy.tome_guardian'];

function embeddedClips(modelId: string): string[] {
  const entry = manifest.find((a) => a.id === modelId)!;
  const b = readFileSync(new URL(`../../client/public/assets/${entry.files.chunky}`, import.meta.url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return (j.animations ?? []).map((a: { name: string }) => a.name);
}

test('the new mobs exist and the data still validates against the real models', () => {
  for (const id of NEW) assert.ok(data.enemies[id], id);
  assert.deepEqual(validateData(data, ctx), []);
});

test('every mob with its own rig names clips that exist inside its model, and can idle and walk', () => {
  for (const id of NEW) {
    const e = data.enemies[id];
    if (e.rig.type !== 'own') continue;
    const have = new Set(embeddedClips(e.model));
    const clips = e.rig.clips!;
    assert.ok(clips.idle && clips.walk, `${id} idles and walks`);
    for (const name of Object.values(clips).flat()) assert.ok(have.has(name), `${id}: ${name} is in ${e.model}`);
  }
});

test('the undead and the elementals are all rigged with clips; only the book is built from parts', () => {
  for (const id of NEW.filter((x) => x !== 'enemy.book' && x !== 'enemy.tome_guardian')) assert.equal(data.enemies[id].rig.type, 'own', id);
  assert.equal(data.enemies['enemy.book'].rig.preset, 'part_sway');
});

test('the new mobs can be met in the dungeon', () => {
  const pool = new Set(data.biomes.dungeon.enemyPool);
  for (const id of NEW) assert.ok(pool.has(id), `${id} is in the dungeon pool`);
});

test('every new mob can be spawned in a room and fight for ten seconds without trouble', () => {
  for (const id of NEW) {
    const sim = createRoomSim(defaultData(), 3, 'forest_clearing');
    const e = spawnEnemy(sim, id, { x: 0, y: 0, z: 2 });
    run(sim, 600, idle());
    assert.ok(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.z), `${id} position`);
  }
});

test('the summoner brings books, and books are not summoned without limit', () => {
  const a = data.attacks[data.enemies['enemy.tome_guardian'].attacks.find((x) => data.attacks[x].template === 'summon')!];
  assert.equal(a.summon!.enemy, 'enemy.book');
  assert.ok(a.summon!.cap && a.summon!.cap <= 6);
});

test('the humanoid mobs stand as tall as the rigged elementals, so the roster reads at one scale', () => {
  const top = (id: string) => {
    const e = data.enemies[id];
    return Math.max(...e.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r)) * e.scale;
  };
  const want = top('enemy.fire_elemental');
  for (const id of ['enemy.skeleton', 'enemy.skeleton_mage', 'enemy.zombie', 'enemy.vampire', 'enemy.ghost', 'enemy.water_elemental', 'enemy.wraith']) {
    assert.ok(Math.abs(top(id) - want) < want * 0.1, `${id} is ${top(id).toFixed(2)} m, the fire elemental is ${want.toFixed(2)} m`);
  }
  assert.ok(top('enemy.bone_giant') > want * 1.4, 'the bone giant towers over them');
});
