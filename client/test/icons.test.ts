import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_COLOUR, elementColour, elementIcon, roomIcon, shapeIcon, statusArt } from '../src/hud/icons.ts';
import { PREVIEW_BACKDROPS } from '../src/crosshair.ts';
import { MARK_IDS, STATUS_IDS, SHAPE_TYPES, ELEMENTS } from '@conflux/shared';

const TEN = ['fire', 'water', 'earth', 'wind', 'lightning', 'light', 'dark', 'metal', 'poison', 'time'];

test('every one of the ten elements has its own colour and its own icon', () => {
  assert.equal(new Set(TEN.map(elementColour)).size, 10);
  assert.equal(new Set(TEN.map(elementIcon)).size, 10);
  for (const e of ELEMENTS) assert.ok(ELEMENT_COLOUR[e], e);
  for (const e of TEN) assert.match(elementIcon(e), /^<svg /);
});

test('an unknown element still gets a colour and an icon', () => {
  assert.match(elementColour('nope'), /^#[0-9a-f]{6}$/i);
  assert.match(elementIcon(undefined), /^<svg /);
});

test('every status, mark, skill shape and room kind has an icon of its own', () => {
  for (const id of [...STATUS_IDS, ...MARK_IDS]) assert.match(statusArt(id), /^<svg /, id);
  for (const s of SHAPE_TYPES) assert.notEqual(shapeIcon(s), shapeIcon('nonsense'), s);
  const kinds = ['fight', 'elite', 'boss', 'shop', 'shrine', 'rest', 'souls', 'depth', 'augment', 'heal'];
  assert.equal(new Set(kinds.map(roomIcon)).size, kinds.length);
});

test('the crosshair preview shows three different floors', () => {
  assert.equal(new Set(PREVIEW_BACKDROPS.map((b) => b.colour)).size, 3);
});
