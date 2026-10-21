import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimReward, offerRewards, rarityWeights, recordOffers, type RewardOffer } from '../src/run/rewards.ts';
import { ROOM_TO_ROOM, chooseDoor } from '../src/run/roomToRoom.ts';
import type { RunState } from '../src/run/run.ts';
import { defaultData } from '../src/files.ts';
import { makeStreams } from '../src/rng.ts';
import { ELEMENTS, SLOTS, type GameData } from '../src/types.ts';

/** The real data plus eight more skills, so there is something to offer (the full pool comes with the loadout task). */
function withPool(): GameData {
  const d = defaultData();
  let n = 0;
  for (const el of ELEMENTS) {
    for (const slot of SLOTS.slice(0, 2)) {
      const src = Object.values(d.skills).find((s) => s.element === el && s.slot === slot)!;
      const id = `${el}.extra_${slot}`;
      d.skills[id] = { ...structuredClone(src), id };
      n++;
    }
  }
  assert.equal(n, 8);
  return d;
}

/** Plays through the run's rewards: at each cleared room, offer, record, and claim the offer at `pick`. */
function playRewards(seed: number, data: GameData, pick: (offers: RewardOffer[]) => RewardOffer = (o) => o[0]) {
  const streams = makeStreams(seed);
  let state = ROOM_TO_ROOM.start(seed, data);
  const sets: RewardOffer[][] = [];
  for (let i = 0; i < 8; i++) {
    state = ROOM_TO_ROOM.onRoomCleared(state);
    const offers = offerRewards(state, data, streams.reward.fork(`room/${i}`));
    sets.push(offers);
    state = claimReward(recordOffers(state, offers), pick(offers));
    const door = ROOM_TO_ROOM.nextChoices(state)[0];
    if (door) state = chooseDoor(state, door);
  }
  return { sets, state };
}

const fresh = (data: GameData, seed = 1): RunState => ROOM_TO_ROOM.start(seed, data);

test('the rarity weights follow the data: rooms 1 to 3 are 70/27/3 and later rooms are 40/45/15', () => {
  assert.deepEqual(rarityWeights(1), { common: 70, rare: 27, epic: 3 });
  assert.deepEqual(rarityWeights(3), { common: 70, rare: 27, epic: 3 });
  assert.deepEqual(rarityWeights(4), { common: 40, rare: 45, epic: 15 });
  assert.deepEqual(rarityWeights(0), { common: 70, rare: 27, epic: 3 });
  const d = defaultData();
  d.rewards.rarity.late.weights.epic = 99;
  assert.equal(rarityWeights(6, d.rewards).epic, 99);
});

test('there are always three offers, each well formed', () => {
  const data = withPool();
  for (let seed = 1; seed <= 60; seed++) {
    for (const set of playRewards(seed, data).sets) {
      assert.equal(set.length, 3);
      for (const o of set) {
        if (o.kind === 'skill') assert.ok(o.id && data.skills[o.id] && o.element === data.skills[o.id].element);
        if (o.kind === 'augment') assert.ok(o.id && data.augments[o.id] && o.rarity);
        if (o.kind === 'heal') assert.ok(o.rarity);
      }
      const keys = set.map((o) => `${o.kind}|${o.id ?? ''}|${o.rarity ?? ''}`);
      assert.equal(new Set(keys).size, 3, `three different offers: ${keys.join(' / ')}`);
    }
  }
});

test('across 500 seeds a skill has been offered by room 3 in every run', () => {
  const data = withPool();
  for (let seed = 1; seed <= 500; seed++) {
    const { sets } = playRewards(seed, data);
    assert.ok(sets.slice(0, 3).some((set) => set.some((o) => o.kind === 'skill')), `seed ${seed}`);
  }
});

test('a skill that is owned or was offered earlier in the run is never offered again', () => {
  const data = withPool();
  for (let seed = 1; seed <= 100; seed++) {
    const start = fresh(data, seed);
    const owned = new Set(start.ownedSkills);
    const seen = new Set<string>();
    for (const set of playRewards(seed, data, (o) => o[o.length - 1]).sets) {
      for (const o of set) {
        if (o.kind !== 'skill') continue;
        assert.ok(!owned.has(o.id!), `seed ${seed}: ${o.id} is already owned`);
        assert.ok(!seen.has(o.id!), `seed ${seed}: ${o.id} offered twice`);
        seen.add(o.id!);
      }
    }
  }
});

test('when every skill of the pool is owned, the offers fall back to augments and heals: still three, none a skill', () => {
  const data = defaultData(); // the twelve starting skills are all owned
  for (let seed = 1; seed <= 50; seed++) {
    for (const set of playRewards(seed, data).sets) {
      assert.equal(set.length, 3);
      assert.ok(set.every((o) => o.kind !== 'skill'), 'no skill to offer');
    }
  }
});

test('claiming a skill adds it to the pool and keeps the old one; claiming it twice adds it once', () => {
  const data = withPool();
  const s = fresh(data);
  const before = s.skills.fire.basic;
  const next = claimReward(s, { kind: 'skill', id: 'fire.extra_basic', element: 'fire' });
  assert.ok(next.ownedSkills.includes('fire.extra_basic') && next.ownedSkills.includes(before));
  assert.equal(next.skills.fire.basic, before, 'the active loadout is not changed by claiming');
  assert.equal(claimReward(next, { kind: 'skill', id: 'fire.extra_basic', element: 'fire' }).ownedSkills.filter((x) => x === 'fire.extra_basic').length, 1);
  assert.ok(!s.ownedSkills.includes('fire.extra_basic'), 'the old state is untouched');
});

test('claiming an augment adds it with its rarity', () => {
  const data = defaultData();
  const next = claimReward(fresh(data), { kind: 'augment', id: 'aug.hot_hands', rarity: 'rare' });
  assert.deepEqual(next.augments, [{ id: 'aug.hot_hands', rarity: 'rare' }]);
});

test('claiming a heal restores a share of health, more for a higher rarity, and never past the maximum', () => {
  const data = defaultData();
  const hurt = { ...fresh(data), hp: 40 };
  const common = claimReward(hurt, { kind: 'heal', rarity: 'common' });
  assert.ok(Math.abs(common.hp - (40 + data.rewards.healFraction * data.player.health)) < 1e-9, `${common.hp}`);
  const epic = claimReward(hurt, { kind: 'heal', rarity: 'epic' });
  assert.ok(epic.hp > common.hp);
  assert.equal(claimReward({ ...hurt, hp: 95 }, { kind: 'heal', rarity: 'epic' }).hp, data.player.health);
});

test('the offers come from the reward stream alone: the combat stream does not move, and the same stream gives the same offers', () => {
  const data = withPool();
  const state = fresh(data, 4);
  const a = makeStreams(4);
  const combatBefore = a.combat.state();
  const first = offerRewards(state, data, a.reward);
  assert.deepEqual(a.combat.state(), combatBefore);
  assert.deepEqual(a.map.state(), makeStreams(4).map.state());
  assert.deepEqual(offerRewards(state, data, makeStreams(4).reward), first);
  assert.notDeepEqual(offerRewards(state, data, makeStreams(5).reward), first);
});

test('the first offer matches the kind shown on the door when it can', () => {
  const data = withPool();
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const cleared = ROOM_TO_ROOM.onRoomCleared(fresh(data, seed));
    for (const door of ROOM_TO_ROOM.nextChoices(cleared)) {
      const inside = chooseDoor(cleared, door);
      assert.equal(inside.reward, door.reward);
      const offers = offerRewards(ROOM_TO_ROOM.onRoomCleared(inside), data, makeStreams(seed).reward);
      assert.equal(offers[0].kind, door.reward, `seed ${seed}`);
      kinds.add(door.reward);
    }
  }
  assert.equal(kinds.size, 3, 'all three kinds of door were tried');
});

test('rarities in the offers follow the weights: mostly common early, more rare and epic late', () => {
  const data = defaultData();
  const count = (index: number) => {
    const tally = { common: 0, rare: 0, epic: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const s = { ...fresh(data, seed), roomIndex: index };
      for (const o of offerRewards(s, data, makeStreams(seed).reward)) if (o.rarity) tally[o.rarity]++;
    }
    return tally;
  };
  const early = count(1);
  const late = count(6);
  assert.ok(early.common > early.rare && early.rare > early.epic, JSON.stringify(early));
  assert.ok(late.epic / (late.common + late.rare + late.epic) > early.epic / (early.common + early.rare + early.epic));
});
