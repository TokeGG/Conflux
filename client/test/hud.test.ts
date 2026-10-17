import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCooldown, skillLabel, statusRing } from '../src/hud/format.ts';
import { STATUS_ICONS, MARK_ICONS } from '../src/hud/statusIcons.ts';
import { MARK_IDS, STATUS_IDS } from '@conflux/shared';

test('formatCooldown is empty at 0, one decimal under 10 s and whole seconds from 10', () => {
  assert.equal(formatCooldown(0), '');
  assert.equal(formatCooldown(-1), '');
  assert.equal(formatCooldown(0.44), '0.4');
  assert.equal(formatCooldown(9.94), '9.9');
  assert.equal(formatCooldown(12.3), '12');
  assert.equal(formatCooldown(10), '10');
});

test('formatCooldown rounds a hair above zero up so a skill never shows 0.0 while it is still cooling down', () => {
  assert.equal(formatCooldown(0.02), '0.1');
});

test('statusRing is the share of the time left, clamped to 0 and 1', () => {
  assert.equal(statusRing(4, 8), 0.5);
  assert.equal(statusRing(-1, 8), 0);
  assert.equal(statusRing(9, 8), 1);
  assert.equal(statusRing(3, 0), 0);
});

test('skillLabel turns a skill id into a readable name', () => {
  assert.equal(skillLabel('fire.flame_cone'), 'Flame Cone');
  assert.equal(skillLabel('water.water_bolt'), 'Water Bolt');
  assert.equal(skillLabel(''), '');
});

test('every status and mark has an icon and colour', () => {
  for (const s of STATUS_IDS) assert.ok(STATUS_ICONS[s].glyph && STATUS_ICONS[s].color, s);
  for (const m of MARK_IDS) assert.ok(MARK_ICONS[m].glyph && MARK_ICONS[m].color, m);
});
