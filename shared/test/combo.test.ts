import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateData, type ValidationContext } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { castSkill } from '../src/sim/skills.ts';
import type { Sim } from '../src/sim/sim.ts';
import type { SimEvent } from '../src/types.ts';
import { BTN, idle, input, makeSim } from './helpers.ts';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const ctx: ValidationContext = {
  fxIds: new Set<string>(json('../data/fxIds.json')),
  clipNames: new Set<string>(json('../../client/public/assets/clips/wizardpack/index.json').clips.map((c: { name: string }) => c.name)),
  modelIds: new Set((json('../../client/public/assets/assets.json') as { id: string }[]).filter((a) => a.id.startsWith('model.')).map((a) => a.id)),
};

const TWELVE = [
  'fire.fireball', 'fire.flame_cone', 'fire.flame_dash',
  'water.water_bolt', 'water.tidal_stream', 'water.bubble_shield',
  'earth.boulder', 'earth.spike_field', 'earth.stone_skin',
  'wind.gust_volley', 'wind.cyclone', 'wind.air_dash',
];

const at = (x: number, z: number) => ({ x, y: 0, z });
const lost = (e: EnemyState) => 1000 - e.hp;

/** Looks at an enemy from the player's eyes, the way a player lines up the crosshair. */
function lookAt(sim: Sim, e: EnemyState, buttons = 0, swapTo = -1) {
  const cam = { x: sim.player.pos.x, y: 1.6, z: sim.player.pos.z };
  const dx = e.pos.x - cam.x;
  const dz = e.pos.z - cam.z;
  return input({ aimYaw: Math.atan2(dx, dz), aimPitch: Math.atan2(0.9 - cam.y, Math.hypot(dx, dz)), camOrigin: cam, buttons, swapTo });
}

/** Runs the sim with one input for a tick, then idle-looks at the enemy for `seconds`; returns every event. */
function press(sim: Sim, e: EnemyState, buttons: number, swapTo: number, seconds: number): SimEvent[] {
  const out = sim.step([lookAt(sim, e, buttons, swapTo)]);
  for (let i = 1; i < Math.round(seconds * 60); i++) out.push(...sim.step([lookAt(sim, e)]));
  return out;
}

test('the shipped data with all 12 starting skills validates', () => {
  const d = defaultData();
  for (const id of TWELVE) assert.ok(d.skills[id], `${id} exists`);
  assert.deepEqual(validateData(d, ctx), []);
  const slots = (el: string) => TWELVE.filter((id) => id.startsWith(`${el}.`)).map((id) => d.skills[id].slot).sort();
  for (const el of ['fire', 'water', 'earth', 'wind']) assert.deepEqual(slots(el), ['basic', 'secondary', 'utility'], el);
});

test('the owner\'s combo: water on A, earth on B, fire on A steams, wind on B whips up a sandstorm', () => {
  const sim = makeSim();
  const a = spawnEnemy(sim, 'enemy.dummy', at(-4, 10));
  const b = spawnEnemy(sim, 'enemy.dummy', at(4, 10));
  const ev: SimEvent[] = [];
  ev.push(...press(sim, a, 0, 1, 0.1)); // swap to water
  ev.push(...press(sim, a, BTN.LMB, -1, 0.9)); // water bolt on A
  assert.ok(a.statuses.soaked, 'A is soaked');
  ev.push(...press(sim, b, 0, 2, 0.5)); // swap to earth
  ev.push(...press(sim, b, BTN.LMB, -1, 1.2)); // boulder on B
  assert.ok(b.statuses.rocked, 'B is rocked');
  ev.push(...press(sim, a, 0, 0, 0.5)); // swap to fire
  ev.push(...press(sim, a, BTN.LMB, -1, 0.9)); // fireball on A
  sim.player.equipped[2] = 'wind'; // the bench: earth is done with, wind takes its key
  ev.push(...press(sim, b, 0, 2, 0.5)); // swap to wind
  ev.push(...press(sim, b, BTN.LMB, -1, 1.0)); // gust volley on B
  const reactions = ev.filter((e) => e.type === 'reaction');
  assert.deepEqual(reactions.map((e) => [e.id, e.enemyId]), [['steam', a.id], ['sandstorm', b.id]]);
  const water = ev.findIndex((e) => e.type === 'hit' && String(e.skillId).startsWith('water.') && e.id === a.id);
  const boulder = ev.findIndex((e) => e.type === 'hit' && e.skillId === 'earth.boulder' && e.id === b.id);
  const steam = ev.findIndex((e) => e.type === 'reaction' && e.id === 'steam');
  const sand = ev.findIndex((e) => e.type === 'reaction' && e.id === 'sandstorm');
  assert.ok(water >= 0 && water < boulder && boulder < steam && steam < sand, `order water ${water}, boulder ${boulder}, steam ${steam}, sandstorm ${sand}`);
  assert.ok(sim.zones.some((z) => z.kind === 'sandstorm'), 'the sandstorm is on B');
  assert.ok(lost(a) > 0 && lost(b) > 0);
});

test('Cyclone applies gusted', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  castSkill(sim, sim.player, 'wind.cyclone', { x: 0, y: 0, z: 8 });
  for (let i = 0; i < 45; i++) sim.step([idle()]);
  assert.ok(e.statuses.gusted, 'gusted');
});

test('Bubble Shield soaks its damage, then pops with a splash event that soaks nearby enemies', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 2));
  castSkill(sim, sim.player, 'water.bubble_shield', { x: 0, y: 1.4, z: 9 });
  for (let i = 0; i < 20; i++) sim.step([idle()]);
  const cap = sim.data.skills['water.bubble_shield'].shape.absorb!;
  sim.hurtPlayer(cap - 1);
  assert.equal(sim.player.hp, 100, 'all of it was absorbed');
  assert.equal(sim.step([idle()]).some((x) => x.type === 'shield_pop'), false);
  sim.hurtPlayer(5);
  assert.equal(sim.player.hp, 100 - 4, 'the overflow gets through');
  const pop = sim.step([idle()]).filter((x) => x.type === 'shield_pop');
  assert.equal(pop.length, 1);
  assert.ok(e.statuses.soaked, 'the splash soaked the enemy');
  assert.equal(sim.player.buff, null);
});

test('Stone Skin cuts damage taken and speed while it lasts', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'earth.stone_skin', { x: 0, y: 1.4, z: 9 });
  for (let i = 0; i < 20; i++) sim.step([idle()]);
  const s = sim.data.skills['earth.stone_skin'].shape;
  sim.hurtPlayer(10);
  assert.ok(Math.abs(sim.player.hp - (100 - 10 * s.damageTakenMul!)) < 1e-9);
  const z0 = sim.player.pos.z;
  for (let i = 0; i < 60; i++) sim.step([input({ moveZ: 1 })]);
  assert.ok(Math.abs(sim.player.pos.z - z0 - 6 * s.speedMul! * 1) < 0.2, `moved ${sim.player.pos.z - z0}`);
});

test('Flame Dash leaves burning ground behind', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 3));
  castSkill(sim, sim.player, 'fire.flame_dash', { x: 0, y: 1.4, z: 30 });
  for (let i = 0; i < 40; i++) sim.step([idle()]);
  assert.ok(sim.player.pos.z > 4, `dashed (${sim.player.pos.z})`);
  assert.ok(e.statuses.burning, 'the enemy in the trail caught fire');
});

test('Air Dash gives a brief dodge window', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'wind.air_dash', { x: 0, y: 1.4, z: 30 });
  for (let i = 0; i < 3; i++) sim.step([idle()]);
  assert.equal(sim.hurtPlayer(10), false);
  for (let i = 0; i < 40; i++) sim.step([idle()]);
  assert.equal(sim.hurtPlayer(10), true);
});

test('Flame Cone, Tidal Stream, Spike Field and Gust Volley each hurt an enemy in front', () => {
  for (const [id, z] of [['fire.flame_cone', 4], ['water.tidal_stream', 5], ['earth.spike_field', 8], ['wind.gust_volley', 8]] as const) {
    const sim = makeSim();
    const e = spawnEnemy(sim, 'enemy.dummy', at(0, z));
    castSkill(sim, sim.player, id, { x: 0, y: 0.9, z });
    for (let i = 0; i < 120; i++) sim.step([lookAt(sim, e)]);
    assert.ok(lost(e) > 0, `${id} did damage`);
  }
});
