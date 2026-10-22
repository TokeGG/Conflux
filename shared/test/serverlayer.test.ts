import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayers } from '../src/layers.ts';
import { defaultData } from '../src/files.ts';

test('the server layer (tuning the dev accounts published) applies under the player\'s own edits and marks the data modified', () => {
  const layers = new DataLayers(defaultData());
  assert.equal(layers.isModified(), false);
  const errors = layers.setServer([{ path: 'player.health', value: 150 }, { path: 'nope.x', value: 1 }]);
  assert.equal(errors.length, 1);
  assert.equal(layers.current().player.health, 150);
  assert.equal(layers.isModified(), true);
  assert.deepEqual(layers.serverPatches(), [{ path: 'player.health', value: 150 }]);
  layers.setRun([{ path: 'player.health', value: 200 }]);
  assert.equal(layers.current().player.health, 200);
  // the server layer is not copied into the session by the dev panel's "keep": patches() is the player's own
  assert.deepEqual(layers.patches(), [{ path: 'player.health', value: 200 }]);
  layers.reset();
  assert.equal(layers.current().player.health, 150);
  assert.ok(layers.changes().some((c) => c.path === 'player.health' && c.layer === 'server' || c.layer === 'run'));
});
