import { test } from 'node:test';
import assert from 'node:assert/strict';
import { augmentPool, offerRewards, skillPool } from '../src/run/rewards.ts';
import { equipElement } from '../src/run/loadout.ts';
import { ENDLESS } from '../src/run/endless.ts';
import { makeStreams } from '../src/rng.ts';
import { defaultData } from '../src/files.ts';
import type { Element } from '../src/types.ts';
import type { RunState } from '../src/run/run.ts';

const data = defaultData();

/** A fresh run holding exactly these three elements, each with the first skill of every slot. */
function holding(...els: [Element, Element, Element]): RunState {
  const s = ENDLESS.start(1, data);
  let l = s.skills;
  for (const [slot, el] of els.entries()) {
    if (!l.equipped.includes(el)) {
      // free the slot first by moving whatever is not wanted out
      const out = l.equipped.find((e) => !els.includes(e) || l.equipped.indexOf(e) !== slot)!;
      l = equipElement(l, l.equipped.indexOf(out), el);
    }
  }
  const slots = { ...l.slots };
  for (const el of els) {
    slots[el] = { ...slots[el] };
    for (const slot of ['basic', 'secondary', 'utility'] as const) {
      const first = Object.keys(data.skills).sort().find((id) => data.skills[id].element === el && data.skills[id].slot === slot);
      if (first) slots[el][slot] = first;
    }
  }
  return { ...s, skills: { ...l, equipped: [...els], slots } };
}

test('no augment is offered for an element you do not hold', () => {
  const run = holding('water', 'earth', 'wind');
  const pool = augmentPool(run, data);
  for (const id of ['aug.hot_hands', 'aug.wide_cone', 'aug.explosive_fireball']) assert.ok(!pool.includes(id), `${id} needs fire`);
  assert.ok(!pool.includes('aug.bigger_steam'), 'the steam reaction needs fire and water both');
});

test('an augment for a skill is offered only while that skill is the one equipped in its slot', () => {
  const run = holding('water', 'earth', 'wind');
  assert.ok(augmentPool(run, data).includes('aug.thick_bubble'), 'water.bubble_shield is the first water utility');
  const swapped = { ...run, skills: { ...run.skills, slots: { ...run.skills.slots, water: { ...run.skills.slots.water, utility: 'water.slip_dash' } } } };
  assert.ok(!augmentPool(swapped, data).includes('aug.thick_bubble'), 'the shield is not equipped any more');
});

test('a reaction augment needs both elements of its reaction', () => {
  assert.ok(augmentPool(holding('fire', 'water', 'earth'), data).includes('aug.bigger_steam'));
  assert.ok(!augmentPool(holding('fire', 'earth', 'wind'), data).includes('aug.bigger_steam'));
});

test('a tag augment needs an equipped skill with the tag; an element augment needs the element', () => {
  assert.ok(augmentPool(holding('fire', 'water', 'earth'), data).includes('aug.long_dash'), 'fire has a dash');
  assert.ok(augmentPool(holding('wind', 'fire', 'water'), data).includes('aug.wind_focus'));
  assert.ok(!augmentPool(holding('fire', 'water', 'earth'), data).includes('aug.wind_focus'));
});

test('an augment you already have is never offered again, and skills of elements you do not hold are not offered', () => {
  const run = holding('fire', 'water', 'earth');
  const owned = { ...run, augments: [{ id: 'aug.hot_hands', rarity: 'common' as const, skill: 'fire.fireball' }] };
  assert.ok(!augmentPool(owned, data).includes('aug.hot_hands'));
  const offeredNow = skillPool(owned, data, new Set());
  if (offeredNow.some((id) => owned.skills.equipped.includes(data.skills[id].element))) for (const id of offeredNow) assert.ok(owned.skills.equipped.includes(data.skills[id].element), `${id} is for an element not held`);
  for (let room = 0; room < 25; room++) {
    const offers = offerRewards({ ...owned, roomIndex: room }, data, makeStreams(7).reward.fork(`r/${room}`));
    for (const o of offers) {
      if (o.kind === 'augment') assert.notEqual(o.id, 'aug.hot_hands');
    }
  }
});
