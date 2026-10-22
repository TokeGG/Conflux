import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData, ROOM_TO_ROOM, ENDLESS, emptyLedger } from '@conflux/shared';
import { wareText, describeDoor, describeGate, describeOffer, elementCombos, endSummary, achievementLines } from '../src/hud/runFormat.ts';

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

test('a gate label names the room style, what waits there and the reward, and flags elite and boss rooms', async () => {
  const { ENDLESS, planRoomAt } = await import('@conflux/shared');
  const room = planRoomAt(data, 5, 1, 4);
  const t = describeGate({ room, reward: 'heal', biome: room.biome }, data);
  assert.equal(t.kind, 'boss');
  assert.match(t.title, /boss/i);
  assert.match(t.sub, /heal/i);
  const plain = planRoomAt(data, 5, 1, 1);
  const p = describeGate({ room: plain, reward: 'skill', biome: plain.biome }, data);
  assert.equal(p.kind, 'fight');
  assert.ok(p.title.length > 0 && /skill/i.test(p.sub));
  assert.ok(ENDLESS);
});

test('the end of a daily run says it was the daily and how it compares with the best of the day', () => {
  const run = { ...ENDLESS.start(1, data), daily: true, history: ['a', 'b', 'c'] };
  const s = endSummary(run, 5);
  assert.ok(s.lines.some((l) => /daily/i.test(l)));
  assert.ok(s.lines.some((l) => /best.*5/i.test(l)));
  const record = endSummary(run, 3);
  assert.ok(record.lines.some((l) => /new best/i.test(l)));
});

test('every gate sign says which kind of room is behind it', () => {
  const run = ENDLESS.start(1, data);
  const base = ENDLESS.nextChoices(run)[0];
  for (const type of ['combat', 'elite', 'boss', 'shop', 'shrine', 'rest'] as const) {
    const t = describeGate({ ...base, room: { ...base.room, type } }, data);
    assert.equal(t.kind, type === 'combat' ? 'fight' : type);
    assert.ok(t.title.length > 0 && t.sub.length > 0);
  }
  assert.match(describeGate({ ...base, room: { ...base.room, type: 'shop' } }, data).title, /shop/i);
  assert.match(describeGate({ ...base, descends: true, room: { ...base.room, index: 8 } }, data).sub, /depth 2/i);
});

test('the death screen shows depth reached, souls banked, rooms cleared and the daily comparison', () => {
  const run = { ...ENDLESS.start(1, data), roomIndex: 9, history: ['a', 'b', 'c'], soulsEarned: 120, status: 'defeat' as const };
  const lines = endSummary(run).lines.join(' | ');
  assert.match(lines, /depth 2/i);
  assert.match(lines, /120 souls/i);
  assert.match(lines, /3 rooms cleared/);
});

test('a ware reads as its goods, its price and whether it can be afforded', () => {
  const t = wareText({ kind: 'augment', offer: { kind: 'augment', id: 'aug.explosive_fireball', rarity: 'rare' }, price: 80, sold: false }, 50, data);
  assert.match(t.price, /80/);
  assert.equal(t.afford, false);
  assert.equal(wareText({ kind: 'rest', price: 0, sold: false, healFraction: 0.6 }, 0, data).price, 'Free');
  assert.match(wareText({ kind: 'trade', price: 0, sold: false, hpCost: 30, gain: 45 }, 0, data).detail, /45/);
});
