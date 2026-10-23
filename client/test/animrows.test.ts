import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData, DataLayers, validatePatch } from '@conflux/shared';
import { archetypeRows, castRows, clipChoices, mobClipRows, mobsWithClips, patchesText, stateRows } from '../src/dev/animRows.ts';
import { DevState } from '../src/dev/devstate.ts';

const base = defaultData();
const memory = () => ({ getItem: () => null, setItem() {}, removeItem() {} });

test('there is a row for each of the 15 locomotion states and the 6 cast archetypes, with real patch paths', () => {
  const states = stateRows(base, base, 'wizardpack');
  assert.equal(states.length, 15);
  assert.equal(states[0].path, 'animation.rigs.wizardpack.states.idle');
  assert.equal(states[0].value, 'loco_standing_idle');
  assert.equal(archetypeRows(base, base, 'wizardpack').length, 6);
  for (const r of [...states, ...archetypeRows(base, base, 'oldwizard')]) assert.equal(validatePatch(base, { path: r.path, value: r.value }), null, r.path);
  assert.deepEqual(stateRows(base, base, 'nobody'), []);
});

test('a staged edit shows as the row\'s value and as changed, against the file value', () => {
  const staged = [{ path: 'animation.rigs.wizardpack.states.jump', value: 'loco_standing_idle' }];
  const row = stateRows(base, base, 'wizardpack', staged).find((r) => r.label === 'jump')!;
  assert.equal(row.value, 'loco_standing_idle');
  assert.equal(row.fileValue, 'loco_standing_jump');
  assert.equal(row.live, 'loco_standing_jump');
  assert.equal(row.changed, true);
  assert.equal(stateRows(base, base, 'wizardpack').some((r) => r.changed), false);
});

test('writing a row through the dev state, then trying it, changes what the data says', () => {
  const layers = new DataLayers(defaultData());
  const state = new DevState(layers, memory());
  assert.equal(state.stage({ path: 'animation.rigs.wizardpack.cast.throw', value: 'cast_two_hand_spell_casting' }), null);
  assert.deepEqual(state.tryNow(), []);
  const live = layers.current();
  assert.equal(archetypeRows(live, base, 'wizardpack').find((r) => r.label === 'cast: throw')!.value, 'cast_two_hand_spell_casting');
  assert.equal(state.changesText().includes('cast_two_hand_spell_casting'), true, 'it is exported as a patch');
});

test('clipChoices lists the rig\'s clips and keeps a current value that is not among them, marked', () => {
  assert.deepEqual(clipChoices(['a', 'b'], 'b'), [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]);
  assert.deepEqual(clipChoices(['a'], 'zzz')[0], { value: 'zzz', label: 'zzz (not found)' });
  assert.equal(clipChoices(['a'], '').length, 1);
});

test('mobs with a clips table list one row per clip, arrays by number', () => {
  const ids = mobsWithClips(base);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    const rows = mobClipRows(base, base, id);
    assert.ok(rows.length > 0, id);
    for (const r of rows) assert.equal(validatePatch(base, { path: r.path, value: r.value }), null, r.path);
  }
  assert.deepEqual(mobClipRows(base, base, 'nobody'), []);
});

test('castRows gives the six cast controls with the file values, defaults for the optional ones, and a staged edit marked changed', () => {
  const id = 'fire.fireball';
  const rows = castRows(base, base, id);
  assert.deepEqual(rows.map((r) => r.path.split('.').pop()), ['clip', 'archetype', 'windup', 'fireAt', 'move', 'blend']);
  const by = (k: string) => rows.find((r) => r.path.endsWith(`.${k}`))!;
  assert.equal(by('clip').value, 'cast_1h_magic_attack_02');
  assert.equal(by('windup').value, 0.18);
  assert.equal(by('blend').value, 1, 'the default for a skill without one');
  assert.equal(by('fireAt').value, 0.3, 'the release moment of the throw clip');
  assert.equal(rows.some((r) => r.changed), false);
  const edited = castRows(base, base, id, [{ path: `skills.${id}.cast.blend`, value: 0.5 }]);
  assert.equal(edited.find((r) => r.path.endsWith('.blend'))!.changed, true);
  for (const r of rows) assert.equal(validatePatch(base, { path: r.path, value: r.value }), null, r.path);
  assert.deepEqual(castRows(base, base, 'nope.nope'), []);
});

test('patchesText keeps one patch per path under the prefix, the later list winning, and nothing else', () => {
  const a = [{ path: 'skills.x.cast.windup', value: 0.2 }, { path: 'skills.y.cast.windup', value: 1 }];
  const b = [{ path: 'skills.x.cast.windup', value: 0.3 }, { path: 'skills.x.cast.clip', value: 'c' }, { path: 'skills.xx.cast.clip', value: 'no' }];
  assert.deepEqual(JSON.parse(patchesText('skills.x.cast', a, b)), [{ path: 'skills.x.cast.windup', value: 0.3 }, { path: 'skills.x.cast.clip', value: 'c' }]);
  assert.equal(patchesText('nothing', a, b), '[]');
});
