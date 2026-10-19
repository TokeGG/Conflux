import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatches, validatePatch, resolvePath, type DataPatch } from '../src/patch.ts';
import { fieldFor } from '../src/fields.ts';
import { DataLayers } from '../src/layers.ts';
import { defaultData } from '../src/files.ts';
import type { GameData } from '../src/types.ts';

const P = (path: string, value: DataPatch['value']): DataPatch => ({ path, value });

test('applying then undoing a patch restores a deep-equal GameData', () => {
  const d = defaultData();
  const { data, undo } = applyPatches(d, [P('skills.fire.fireball.damage', 20), P('player.moveSpeed', 8)]);
  assert.equal(data.skills['fire.fireball'].damage, 20);
  assert.equal(data.player.moveSpeed, 8);
  assert.deepEqual(applyPatches(data, undo).data, d);
});

test('applyPatches never mutates its input', () => {
  const d = defaultData();
  const before = structuredClone(d);
  applyPatches(d, [P('player.health', 50)]);
  assert.deepEqual(d, before);
});

test('paths reach entries with dotted ids and array rows', () => {
  const d = defaultData();
  const out = applyPatches(d, [P('reactions.burning.water.params.radius', 4.5), P('enemies.enemy.dummy.hurtboxes.0.r', 0.7), P('statuses.gusted.canAct', true)]).data;
  assert.equal(out.reactions.find((r) => r.id === 'burning.water')!.params.radius, 4.5);
  assert.equal(out.enemies['enemy.dummy'].hurtboxes[0].r, 0.7);
  assert.equal(out.statuses.gusted.canAct, true);
});

test('resolvePath returns the canonical segments and null for unknown paths', () => {
  const d = defaultData();
  assert.deepEqual(resolvePath(d, 'skills.fire.fireball.damage')!.canonical, ['skills', 'fire.fireball', 'damage']);
  assert.equal(resolvePath(d, 'skills.nope.damage'), null);
  assert.equal(resolvePath(d, 'skills.fire.fireball.nope'), null);
});

test('validatePatch refuses unknown paths, wrong types, out-of-range numbers and fields that are not editable', () => {
  const d = defaultData();
  assert.equal(validatePatch(d, P('skills.fire.fireball.damage', 20)), null);
  assert.match(validatePatch(d, P('skills.nope.damage', 5))!, /unknown|nope/i);
  assert.match(validatePatch(d, P('skills.fire.fireball.nope', 5))!, /unknown|nope/i);
  assert.match(validatePatch(d, P('player.moveSpeed', 'fast'))!, /number/i);
  assert.match(validatePatch(d, P('player.moveSpeed', 999))!, /between|range|max/i);
  assert.match(validatePatch(d, P('player.moveSpeed', NaN))!, /number|finite/i);
  assert.match(validatePatch(d, P('player.moveSpeed', true))!, /number/i);
  assert.match(validatePatch(d, P('statuses.gusted.canAct', 5))!, /yes\/no|boolean/i);
  assert.match(validatePatch(d, P('rooms.forest_clearing.size.0', 40))!, /not editable|edit/i);
  assert.match(validatePatch(d, P('skills.fire.fireball.id', 'x'))!, /not editable|edit/i);
});

test('applyPatches throws on an invalid patch and names it', () => {
  assert.throws(() => applyPatches(defaultData(), [P('player.moveSpeed', 999)]), /player\.moveSpeed/);
});

test('later patches in one list override earlier ones and undo goes back in reverse', () => {
  const d = defaultData();
  const { data, undo } = applyPatches(d, [P('player.health', 150), P('player.health', 200)]);
  assert.equal(data.player.health, 200);
  assert.deepEqual(applyPatches(data, undo).data, d);
});

test('fieldFor gives labels, units and bounds, and null for what is not editable', () => {
  assert.deepEqual(fieldFor('player.moveSpeed'), { label: 'Move speed', unit: 'm/s', min: 1, max: 20, step: 0.1 });
  assert.equal(fieldFor('skills.fire.fireball.shape.angle')!.unit, '°');
  assert.equal(fieldFor('statuses.gusted.canAct')!.kind, 'boolean');
  assert.equal(fieldFor('player.nope'), null);
  assert.equal(fieldFor('rooms.forest_clearing.size.0'), null);
});

function leaves(d: GameData): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number' || typeof v === 'boolean') out.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'id') walk(x, `${path}.${k}`);
  };
  for (const root of ['player', 'statuses', 'rewards']) walk((d as any)[root], root);
  walk(d.elements.multipliers, 'elements.multipliers');
  walk(d.reactionCooldown, 'reactionCooldown');
  for (const r of d.reactions) walk(r.params, `reactions.${r.id}.params`);
  for (const root of ['skills', 'augments', 'enemies', 'attacks'] as const) for (const [id, e] of Object.entries(d[root])) walk(e, `${root}.${id}`);
  return out;
}

test('every numeric or yes/no value under the editable roots has a label and bounds', () => {
  const missing = leaves(defaultData()).filter((p) => fieldFor(p) === null);
  assert.deepEqual(missing, [], `unlabelled values:\n${missing.join('\n')}`);
});

test('every value that fieldFor covers also resolves in the data (no dead catalogue entries for the seed data)', () => {
  const d = defaultData();
  for (const p of leaves(d)) assert.ok(resolvePath(d, p), `cannot resolve ${p}`);
});

test('DataLayers lists each changed value from the file value to the current one, with its layer', () => {
  const layers = new DataLayers(defaultData());
  assert.deepEqual(layers.changes(), []);
  assert.deepEqual(layers.setSession([P('skills.fire.fireball.damage', 20)]), []);
  assert.deepEqual(layers.changes(), [{ path: 'skills.fire.fireball.damage', from: 14, to: 20, layer: 'session' }]);
  assert.equal(layers.current().skills['fire.fireball'].damage, 20);
});

test('a run patch overrides a session patch on the same path and shows as one row', () => {
  const layers = new DataLayers(defaultData());
  layers.setSession([P('skills.fire.fireball.damage', 20)]);
  layers.setRun([P('skills.fire.fireball.damage', 25), P('player.health', 150)]);
  assert.equal(layers.current().skills['fire.fireball'].damage, 25);
  const rows = layers.changes();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.path === 'skills.fire.fireball.damage'), { path: 'skills.fire.fireball.damage', from: 14, to: 25, layer: 'run' });
});

test('setRun([]) drops the run layer and keeps the session layer', () => {
  const layers = new DataLayers(defaultData());
  layers.setSession([P('player.health', 150)]);
  layers.setRun([P('player.moveSpeed', 9)]);
  layers.setRun([]);
  assert.equal(layers.current().player.moveSpeed, 6);
  assert.equal(layers.current().player.health, 150);
});

test('reset clears both layers and revert removes one path', () => {
  const layers = new DataLayers(defaultData());
  layers.setSession([P('player.health', 150), P('player.moveSpeed', 9)]);
  layers.revert('player.health');
  assert.equal(layers.current().player.health, 100);
  assert.equal(layers.current().player.moveSpeed, 9);
  layers.reset();
  assert.deepEqual(layers.changes(), []);
  assert.equal(layers.current().player.moveSpeed, 6);
});

test('invalid patches are ignored and reported, valid ones in the same list still apply', () => {
  const layers = new DataLayers(defaultData());
  const errors = layers.setSession([P('skills.removed.damage', 5), P('player.health', 150)]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /removed/);
  assert.equal(layers.current().player.health, 150);
});

test('current() is stable until something changes, and the base data is never touched', () => {
  const base = defaultData();
  const frozen = structuredClone(base);
  const layers = new DataLayers(base);
  const a = layers.current();
  assert.equal(layers.current(), a);
  layers.setSession([P('player.health', 150)]);
  assert.notEqual(layers.current(), a);
  assert.deepEqual(base, frozen);
});

test('a version counter changes whenever the layers do', () => {
  const layers = new DataLayers(defaultData());
  const v0 = layers.version;
  layers.setRun([P('player.health', 120)]);
  assert.notEqual(layers.version, v0);
});

test('patches() lists the effective patches, one per path, run over session', () => {
  const layers = new DataLayers(defaultData());
  layers.setSession([P('player.health', 150), P('player.moveSpeed', 8)]);
  layers.setRun([P('player.health', 200)]);
  assert.deepEqual(layers.patches(), [P('player.moveSpeed', 8), P('player.health', 200)]);
  assert.deepEqual(layers.sessionPatches(), [P('player.health', 150), P('player.moveSpeed', 8)]);
  assert.deepEqual(layers.runPatches(), [P('player.health', 200)]);
});
