import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayers, defaultData, fieldFor, resolvePath } from '@conflux/shared';
import { buildForm, patchFor, rowIsChanged } from '../src/dev/form.ts';
import { DevState } from '../src/dev/devstate.ts';
import { clipsForRig, reactionLine, scrubTime } from '../src/dev/tools.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const base = defaultData();

test('buildForm lists damage, cooldown and every shape number of the fireball with the file\'s values', () => {
  const groups = buildForm(base, 'skills.fire.fireball');
  const rows = groups.flatMap((g) => g.rows);
  const by = (path: string) => rows.find((r) => r.path === path);
  for (const leaf of ['damage', 'cooldown', 'shape.speed', 'shape.radius', 'shape.gravity', 'shape.lifetime']) {
    const row = by(`skills.fire.fireball.${leaf}`);
    assert.ok(row, `a row for ${leaf}`);
    assert.equal(row.fileValue, resolvePath(base, row.path)!.value, `${leaf} shows the file's value`);
    assert.equal(row.value, row.fileValue);
    const info = fieldFor(row.path)!;
    assert.equal(row.label, info.label);
    assert.equal(row.unit, info.unit);
    assert.equal(row.min, info.min);
    assert.equal(row.max, info.max);
    assert.equal(row.step, info.step);
  }
  assert.ok(groups.some((g) => g.title === 'shape'), 'shape numbers are grouped');
});

test('buildForm leaves out values the catalogue does not let you edit', () => {
  const rows = buildForm(base, 'skills.fire.fireball').flatMap((g) => g.rows);
  for (const r of rows) assert.ok(fieldFor(r.path), r.path);
  assert.equal(rows.some((r) => r.path.endsWith('.element') || r.path.endsWith('.id')), false);
});

test('buildForm shows the live value next to the file value when a layer changed it', () => {
  const layers = new DataLayers(base);
  layers.setRun([{ path: 'skills.fire.fireball.damage', value: 30 }]);
  const row = buildForm(layers.current(), 'skills.fire.fireball', base).flatMap((g) => g.rows).find((r) => r.path.endsWith('.damage'))!;
  assert.equal(row.value, 30);
  assert.equal(row.fileValue, 14);
  assert.equal(rowIsChanged(row), true);
  const same = buildForm(base, 'skills.fire.fireball').flatMap((g) => g.rows)[0];
  assert.equal(rowIsChanged(same), false);
});

test('buildForm works for the player, a status and a reaction row (ids with dots, array rows)', () => {
  assert.ok(buildForm(base, 'player').flatMap((g) => g.rows).some((r) => r.path === 'player.dodge.cooldown'));
  assert.ok(buildForm(base, 'statuses.burning').flatMap((g) => g.rows).some((r) => r.path === 'statuses.burning.duration'));
  const rows = buildForm(base, 'reactions.steam').flatMap((g) => g.rows);
  assert.ok(rows.some((r) => r.path === 'reactions.steam.params.radius'), rows.map((r) => r.path).join(', '));
});

test('buildForm for a path that does not exist is empty rather than an error', () => {
  assert.deepEqual(buildForm(base, 'skills.nothing.here'), []);
});

test('editing a row makes a valid patch that stages, tries and undoes', () => {
  const layers = new DataLayers(base);
  const state = new DevState(layers, memory());
  const row = buildForm(base, 'skills.fire.fireball').flatMap((g) => g.rows).find((r) => r.path.endsWith('.damage'))!;
  const patch = patchFor(row, '40');
  assert.deepEqual(patch, { path: 'skills.fire.fireball.damage', value: 40 });
  assert.equal(state.stage(patch as { path: string; value: number }), null);
  assert.deepEqual(state.tryNow(), []);
  assert.equal(layers.current().skills['fire.fireball'].damage, 40);
  assert.equal(layers.changes().length, 1);
  layers.revert(row.path);
  assert.equal(layers.current().skills['fire.fireball'].damage, 14);
});

test('patchFor refuses text that is not a number and numbers outside the bounds the catalogue allows', () => {
  const row = buildForm(base, 'skills.fire.fireball').flatMap((g) => g.rows).find((r) => r.path.endsWith('.damage'))!;
  assert.equal(typeof patchFor(row, 'lots'), 'string');
  assert.equal(typeof patchFor(row, ''), 'string');
  const bad = patchFor(row, '99999999');
  assert.deepEqual(bad, { path: row.path, value: 99999999 }, 'bounds are checked when staging, with the catalogue\'s message');
  const state = new DevState(new DataLayers(base), memory());
  assert.match(state.stage(bad as { path: string; value: number })!, /between/);
});

test('unstage drops a staged edit and revertPath puts a tried one back', () => {
  const layers = new DataLayers(base);
  const state = new DevState(layers, memory());
  state.stage({ path: 'skills.fire.fireball.damage', value: 40 });
  state.stage({ path: 'skills.fire.fireball.cooldown', value: 2 });
  state.unstage('skills.fire.fireball.damage');
  assert.deepEqual(state.staged.map((p) => p.path), ['skills.fire.fireball.cooldown']);
  state.tryNow();
  assert.equal(layers.changes().length, 1);
  state.revertPath('skills.fire.fireball.cooldown');
  assert.equal(layers.changes().length, 0);
  assert.equal(layers.current().skills['fire.fireball'].cooldown, 0.45);
});

test('clipsForRig lists the baked clips of a rig from the manifest, sorted', () => {
  const manifest = [
    { id: 'clip.wizardpack.b_run', files: {}, licence: '' },
    { id: 'clip.wizardpack.a_idle', files: {}, licence: '' },
    { id: 'clip.oldwizard.x', files: {}, licence: '' },
    { id: 'model.wizardpack', files: {}, licence: '' },
  ];
  assert.deepEqual(clipsForRig(manifest as never, 'wizardpack'), ['a_idle', 'b_run']);
  assert.deepEqual(clipsForRig(manifest as never, 'nobody'), []);
});

test('scrubTime maps the slider to a time inside the clip', () => {
  assert.equal(scrubTime(0, 2), 0);
  assert.equal(scrubTime(1, 2), 2);
  assert.equal(scrubTime(0.25, 2), 0.5);
  assert.equal(scrubTime(-1, 2), 0);
  assert.equal(scrubTime(7, 2), 2);
});

test('reactionLine turns a reaction event into a log line with the row, the target and the time', () => {
  const line = reactionLine({ t: 12.34, type: 'reaction', id: 'steam', effect: 'steam', enemyId: 3, pos: { x: 1, y: 0, z: 2 } });
  assert.match(line, /12\.3/);
  assert.match(line, /steam/);
  assert.match(line, /#3/);
});
