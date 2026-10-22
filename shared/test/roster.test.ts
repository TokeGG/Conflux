import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateData, type ValidationContext } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { idle, run } from './helpers.ts';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const manifest = json('../../client/public/assets/assets.json') as { id: string }[];
const ctx: ValidationContext = {
  fxIds: new Set<string>(json('../data/fxIds.json')),
  clipNames: new Set<string>(json('../../client/public/assets/clips/wizardpack/index.json').clips.map((c: { name: string }) => c.name)),
  modelIds: new Set(manifest.filter((a) => a.id.startsWith('model.')).map((a) => a.id)),
};
const data = defaultData();
const ROSTER = ['enemy.stump', 'enemy.treefellow', 'enemy.treegolem', 'enemy.golem_fire', 'enemy.golem_water', 'enemy.golem_wind', 'enemy.fire_sprite', 'enemy.wisp', 'enemy.gust', 'boss.maw', 'boss.reaper'];

/** The animation names inside a model file. */
function embeddedClips(modelId: string): string[] {
  const rel = manifest.find((a) => a.id === modelId) as unknown as { files: { chunky: string } };
  const b = readFileSync(new URL(`../../client/public/assets/${rel.files.chunky}`, import.meta.url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  return (j.animations ?? []).map((a: { name: string }) => a.name);
}

test('the real data validates against the real model and effect ids', () => {
  assert.deepEqual(validateData(data, ctx), []);
});

test('the whole roster of section 8.3 and 8.4 exists', () => {
  for (const id of ROSTER) assert.ok(data.enemies[id], id);
});

test('elements, weaknesses, resistances, archetypes and rig types follow the roster table', () => {
  const rows: [string, { element: string; ai: string; rig: string; weak: string[]; resist: string[] }][] = [
    ['enemy.stump', { element: 'earth', ai: 'swarm', rig: 'procedural', weak: ['wind'], resist: ['water'] }],
    ['enemy.treefellow', { element: 'earth', ai: 'tank', rig: 'procedural', weak: ['wind'], resist: ['water'] }],
    ['enemy.treegolem', { element: 'earth', ai: 'tank', rig: 'procedural', weak: ['wind'], resist: ['water'] }],
    ['enemy.golem_fire', { element: 'fire', ai: 'tank', rig: 'own', weak: ['water'], resist: ['wind'] }],
    ['enemy.golem_water', { element: 'water', ai: 'tank', rig: 'own', weak: ['earth'], resist: ['fire'] }],
    ['enemy.golem_wind', { element: 'wind', ai: 'tank', rig: 'own', weak: ['fire'], resist: ['earth'] }],
    ['enemy.fire_sprite', { element: 'fire', ai: 'flyer', rig: 'procedural', weak: ['water'], resist: ['wind'] }],
    ['enemy.wisp', { element: 'wind', ai: 'flyer', rig: 'procedural', weak: ['fire'], resist: ['earth'] }],
    ['enemy.gust', { element: 'wind', ai: 'swarm', rig: 'procedural', weak: ['fire'], resist: ['earth'] }],
    ['boss.maw', { element: 'earth', ai: 'rusher', rig: 'mixamo', weak: ['wind'], resist: ['water'] }],
  ];
  for (const [id, want] of rows) {
    const e = data.enemies[id];
    assert.equal(e.element, want.element, `${id} element`);
    assert.equal(e.ai, want.ai, `${id} ai`);
    assert.equal(e.rig.type, want.rig, `${id} rig`);
    for (const w of want.weak) assert.ok(e.weak.includes(w as never), `${id} weak to ${w}`);
    for (const w of want.resist) assert.ok(e.resist.includes(w as never), `${id} resists ${w}`);
  }
});

test('tanks and golems have a guard block; the others do not; the golems follow the guard numbers of the spec', () => {
  for (const id of ['enemy.treefellow', 'enemy.treegolem', 'enemy.golem_fire', 'enemy.golem_water', 'enemy.golem_wind']) assert.ok(data.enemies[id].guard, id);
  for (const id of ['enemy.stump', 'enemy.fire_sprite', 'enemy.wisp', 'enemy.gust']) assert.equal(data.enemies[id].guard, undefined, id);
  assert.deepEqual(data.enemies['enemy.golem_fire'].guard, { reduction: 0.8, onFor: 3, offFor: 5, staggerOnWeak: 2 });
});

test('the Reaper is weak to water and wind, immune to burning and rocked, and has phases at 66% and 33%', () => {
  const r = data.enemies['boss.reaper'];
  assert.ok(r.weak.includes('water') && r.weak.includes('wind'));
  assert.ok(r.immune!.includes('burning') && r.immune!.includes('rocked'));
  assert.deepEqual(r.phases, [0.66, 0.33]);
  assert.equal(r.rig.type, 'procedural');
  assert.equal(r.rig.preset, 'part_sway');
});

test('Maw has phases at 66% and 33% and keeps its own look (no tint)', () => {
  const m = data.enemies['boss.maw'];
  assert.deepEqual(m.phases, [0.66, 0.33]);
  assert.equal(m.tint, undefined);
});

test('every golem clip the data names exists inside the golem model', () => {
  const have = new Set(embeddedClips('model.golem'));
  for (const id of ['enemy.golem_fire', 'enemy.golem_water', 'enemy.golem_wind']) {
    const clips = data.enemies[id].rig.clips!;
    for (const name of Object.values(clips).flat()) assert.ok(have.has(name), `${id}: ${name}`);
    assert.ok(clips.idle && clips.walk && clips.attack && clips.guard, `${id} has idle, walk, attack and guard clips`);
  }
  for (const name of ['Idle', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Defence1']) assert.ok(have.has(name), name);
});

test('the golems are the same model in three tints', () => {
  const tints = ['enemy.golem_fire', 'enemy.golem_water', 'enemy.golem_wind'].map((id) => data.enemies[id].tint);
  assert.ok(tints.every(Boolean));
  assert.equal(new Set(tints).size, 3);
  assert.equal(new Set(['enemy.golem_fire', 'enemy.golem_water', 'enemy.golem_wind'].map((id) => data.enemies[id].model)).size, 1);
});

test('every enemy has a real body: a hurtbox, health, speed and attacks that exist', () => {
  for (const id of ROSTER) {
    const e = data.enemies[id];
    assert.ok(e.hurtboxes.length > 0 && e.hurtboxes.every((h) => h.r > 0 && h.b[1] > h.a[1] - 1e-9), `${id} hurtboxes`);
    assert.ok(e.hp > 0 && e.speed > 0 && e.scale > 0, `${id} numbers`);
    assert.ok(e.attacks.length > 0 && e.attacks.every((a) => data.attacks[a]), `${id} attacks`);
    assert.ok(id.startsWith('boss.') ? e.cost >= 0 : e.cost > 0, `${id} cost`);
  }
});

test('every enemy can be spawned in a room and fight for ten seconds without trouble', () => {
  for (const id of ROSTER) {
    const sim = createRoomSim(defaultData(), 3, 'forest_clearing');
    const e = spawnEnemy(sim, id, { x: 0, y: 0, z: 2 });
    run(sim, 600, idle());
    assert.ok(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y) && Number.isFinite(e.pos.z), `${id} position`);
    assert.ok(e.hp > 0 || !sim.enemies.includes(e), id);
  }
});
