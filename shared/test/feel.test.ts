import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPatches, resolvePath, validatePatch } from '../src/patch.ts';
import { fieldFor } from '../src/fields.ts';
import { DataLayers } from '../src/layers.ts';
import { defaultData } from '../src/files.ts';
import { CAST_ARCHETYPES } from '../src/types.ts';

const base = defaultData();
const manifest = JSON.parse(readFileSync(new URL('../../client/public/assets/assets.json', import.meta.url), 'utf8')) as { id: string }[];
const castMap = JSON.parse(readFileSync(new URL('../../client/src/anim/castMap.json', import.meta.url), 'utf8')) as Record<string, string>;

test('the camera data is loaded and every camera number is an editable, labelled value', () => {
  assert.equal(base.camera.distance, 4.2);
  for (const k of Object.keys(base.camera)) {
    const f = fieldFor(`camera.${k}`);
    assert.ok(f, `camera.${k} has a label`);
    assert.equal(validatePatch(base, { path: `camera.${k}`, value: (base.camera as unknown as Record<string, number>)[k] }), null, `camera.${k} accepts the file value`);
  }
  assert.match(validatePatch(base, { path: 'camera.distance', value: 99 }) ?? '', /between/);
  assert.match(validatePatch(base, { path: 'camera.fov', value: 5 }) ?? '', /between/);
});

test('animation.json maps every locomotion state and every cast archetype to a baked clip, for both player rigs', () => {
  for (const rig of ['wizardpack', 'oldwizard']) {
    const a = base.animation.rigs[rig];
    assert.ok(a, `rig ${rig}`);
    assert.equal(Object.keys(a.states).length, 15);
    for (const clip of [...Object.values(a.states), ...Object.values(a.cast)]) assert.ok(manifest.some((m) => m.id === `clip.${rig}.${clip}`), `${rig} has clip ${clip}`);
    for (const arch of CAST_ARCHETYPES) assert.ok(a.cast[arch], `${rig} maps ${arch}`);
  }
});

test('animation.json cast mapping matches castMap.json (the client default), so neither drifts', () => {
  for (const [arch, clip] of Object.entries(castMap)) assert.equal(base.animation.rigs.wizardpack.cast[arch], clip, arch);
});

test('a clip name is a text edit: it applies, an odd name or a long one is refused, and the number rows are untouched', () => {
  const path = 'animation.rigs.wizardpack.states.idle';
  assert.equal(validatePatch(base, { path, value: 'loco_standing_walk_forward' }), null);
  assert.match(validatePatch(base, { path, value: 5 }) ?? '', /text/);
  assert.match(validatePatch(base, { path, value: 'a b; drop' }) ?? '', /letters/);
  assert.match(validatePatch(base, { path, value: 'x'.repeat(200) }) ?? '', /long/);
  const { data } = applyPatches(base, [{ path, value: 'loco_standing_walk_forward' }]);
  assert.equal(data.animation.rigs.wizardpack.states.idle, 'loco_standing_walk_forward');
  assert.equal(base.animation.rigs.wizardpack.states.idle, 'loco_standing_idle', 'the original is a copy');
});

test('a skill\'s cast clip and archetype can be edited; the archetype must be a real one; an empty clip means the archetype default', () => {
  assert.equal(validatePatch(base, { path: 'skills.fire.fireball.cast.clip', value: 'cast_two_hand_spell_casting' }), null);
  assert.equal(validatePatch(base, { path: 'skills.fire.fireball.cast.clip', value: '' }), null);
  assert.equal(validatePatch(base, { path: 'skills.fire.fireball.cast.archetype', value: 'slam' }), null);
  assert.match(validatePatch(base, { path: 'skills.fire.fireball.cast.archetype', value: 'dance' }) ?? '', /one of/);
});

test('cast blend and fireAt are optional: they can be set on a skill that does not have them yet and are bounded', () => {
  assert.equal(resolvePath(base, 'skills.fire.fireball.cast.blend'), null);
  assert.equal(validatePatch(base, { path: 'skills.fire.fireball.cast.blend', value: 0.5 }), null);
  assert.equal(validatePatch(base, { path: 'skills.fire.fireball.cast.fireAt', value: 0.4 }), null);
  assert.match(validatePatch(base, { path: 'skills.fire.fireball.cast.blend', value: 2 }) ?? '', /between/);
  assert.match(validatePatch(base, { path: 'skills.fire.nope.cast.blend', value: 0.5 }) ?? '', /unknown path/);
  const { data, undo } = applyPatches(base, [{ path: 'skills.fire.fireball.cast.fireAt', value: 0.4 }]);
  assert.equal(data.skills['fire.fireball'].cast.fireAt, 0.4);
  assert.equal(applyPatches(data, undo).data.skills['fire.fireball'].cast.fireAt, base.skills['fire.fireball'].cast.fireAt, 'undo puts the old value back');
});

test('the layers carry animation and camera edits through the run layer and back', () => {
  const layers = new DataLayers(defaultData());
  assert.deepEqual(layers.setRun([{ path: 'animation.rigs.wizardpack.states.run_forward', value: 'loco_standing_walk_forward' }, { path: 'camera.height', value: 2 }]), []);
  assert.equal(layers.current().animation.rigs.wizardpack.states.run_forward, 'loco_standing_walk_forward');
  assert.equal(layers.current().camera.height, 2);
  assert.ok(layers.isModified(), 'a tuned run is marked tuned');
  layers.revert('camera.height');
  assert.equal(layers.current().camera.height, 1.6);
});

test('enemy clip names are text edits too', () => {
  const id = Object.keys(base.enemies).find((k) => base.enemies[k].rig.clips && typeof base.enemies[k].rig.clips!.idle === 'string')!;
  assert.ok(id);
  assert.equal(validatePatch(base, { path: `enemies.${id}.rig.clips.idle`, value: 'Walk' }), null);
});
