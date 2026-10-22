import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData, ROOM_TO_ROOM, emptyLedger } from '@conflux/shared';
import { describeDoor, describeOffer, elementCombos, endSummary, achievementLines } from '../src/hud/runFormat.ts';

const data = defaultData();

test('a skill offer names the skill and its element; an augment names its rarity; a heal says how much', () => {
  assert.deepEqual(describeOffer({ kind: 'skill', id: 'fire.flame_cone', element: 'fire' }, data).title, 'Flame Cone');
  assert.match(describeOffer({ kind: 'skill', id: 'fire.flame_cone', element: 'fire' }, data).tag, /fire/i);
  const aug = describeOffer({ kind: 'augment', id: 'aug.explosive_fireball', rarity: 'rare' }, data);
  assert.equal(aug.title, data.augments['aug.explosive_fireball'].name);
  assert.match(aug.tag, /rare/i);
  const heal = describeOffer({ kind: 'heal', rarity: 'epic' }, data);
  assert.match(heal.title, /heal/i);
  assert.match(heal.detail, /%/);
});

test('a door shows the reward it leads to and the biome, and marks elite and boss rooms', () => {
  const run = ROOM_TO_ROOM.start(1, data);
  const doors = ROOM_TO_ROOM.nextChoices({ ...run, roomIndex: 1 });
  const d = describeDoor(doors[0], data);
  assert.match(d.biome, /forest|dungeon/i);
  assert.ok(['Skill', 'Augment', 'Heal'].includes(d.reward));
  const elite = describeDoor({ ...doors[0], room: { ...doors[0].room, type: 'elite' } }, data);
  assert.match(elite.badge, /elite/i);
  const boss = describeDoor({ ...doors[0], room: { ...doors[0].room, type: 'boss' } }, data);
  assert.match(boss.badge, /boss/i);
});

test('the end summary counts rooms cleared and says win or loss', () => {
  const run = { ...ROOM_TO_ROOM.start(1, data), history: ['a', 'b', 'c'], status: 'defeat' as const };
  assert.match(endSummary(run).headline, /fell|defeat/i);
  assert.match(endSummary(run).lines.join(' '), /3 rooms/);
  assert.match(endSummary({ ...run, status: 'victory' }).headline, /victor/i);
  assert.match(endSummary({ ...run, tuned: true }).lines.join(' '), /tuned/i);
});

test('earned achievements are listed with the content they unlock', () => {
  const lines = achievementLines(['ach.steam_50'], data);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Steam 50 times/);
  assert.match(lines[0], /Slip Dash/);
  assert.deepEqual(achievementLines([], data), []);
  void emptyLedger;
});

test('an element offer names the element and says it takes a key', () => {
  const t = describeOffer({ kind: 'element', element: 'wind' }, data);
  assert.equal(t.title, 'Wind');
  assert.match(t.tag, /element/i);
  assert.match(t.detail, /key/i);
});

test('elementCombos lists the reaction of a benched element with each element you hold, in either order', () => {
  const lines = elementCombos('wind', ['fire', 'water', 'earth'], data);
  assert.deepEqual(lines.map((l) => l.with), ['fire', 'water', 'earth']);
  assert.match(lines[0].text, /Firestorm/);
  assert.match(lines[1].text, /Rain Cloud/);
  assert.match(lines[2].text, /Sandstorm/);
});

test('elementCombos skips an element that has no reaction with it', () => {
  const lines = elementCombos('fire', ['fire', 'water', 'earth'], data);
  assert.deepEqual(lines.map((l) => l.with), ['water', 'earth']);
});
