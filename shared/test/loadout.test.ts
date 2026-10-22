import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLoadout, startingLoadout, swapIn } from '../src/run/loadout.ts';
import { claimReward } from '../src/run/rewards.ts';
import { ROOM_TO_ROOM } from '../src/run/roomToRoom.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { Rng } from '../src/rng.ts';
import { castSkill } from '../src/sim/skills.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { ELEMENTS, SLOTS } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

const data = defaultData();

test('there are 38 skills: 5 for each of the four first elements and 3 for each of the six newer ones, with every slot covered', () => {
  assert.equal(Object.keys(data.skills).length, 38);
  for (const el of ELEMENTS) {
    const mine = Object.values(data.skills).filter((s) => s.element === el);
    assert.equal(mine.length, ['fire', 'water', 'earth', 'wind'].includes(el) ? 5 : 3, `${el} count`);
    for (const slot of SLOTS) {
      const n = mine.filter((s) => s.slot === slot).length;
      assert.ok(n >= 1 && n <= 3, `${el} ${slot}: ${n}`);
    }
  }
  assert.deepEqual(validateData(data), []);
});

test('a starting loadout has one skill per slot per element, each from that element\'s pool', () => {
  const l = startingLoadout(data, new Rng(1));
  assert.equal(l.pool.length, 30);
  for (const el of ELEMENTS) {
    for (const slot of SLOTS) {
      const id = l.slots[el][slot];
      assert.ok(data.skills[id], `${el} ${slot}`);
      assert.equal(data.skills[id].element, el);
      assert.equal(data.skills[id].slot, slot);
      assert.ok(l.pool.includes(id));
    }
  }
});

test('different seeds give different loadouts in at least 80 of 100 pairs, and a seed always gives the same one', () => {
  const key = (seed: number) => JSON.stringify(startingLoadout(data, new Rng(seed).fork('loadout')).slots);
  let differ = 0;
  for (let i = 0; i < 100; i++) if (key(100 + i) !== key(900 + i * 3)) differ++;
  assert.ok(differ >= 80, `${differ} of 100 differ`);
  assert.equal(key(7), key(7));
});

test('swapIn puts an owned skill of the right element and slot on the slot and keeps the old one in the pool', () => {
  const l = startingLoadout(data, new Rng(2));
  const spare = Object.values(data.skills).find((s) => s.element === 'fire' && s.slot === 'basic' && s.id !== l.slots.fire.basic)!;
  const owned = { ...l, pool: [...l.pool, spare.id] };
  const next = swapIn(owned, 'fire', 'basic', spare.id, data);
  assert.equal(next.slots.fire.basic, spare.id);
  assert.ok(next.pool.includes(l.slots.fire.basic), 'the skill that was swapped out is still owned');
  assert.equal(owned.slots.fire.basic, l.slots.fire.basic, 'the old loadout is untouched');
  assert.equal(swapIn(next, 'fire', 'basic', l.slots.fire.basic, data).slots.fire.basic, l.slots.fire.basic, 'and it can be swapped back');
});

test('swapIn rejects a skill of the wrong element, the wrong slot, one that is not owned, and one that does not exist', () => {
  const l = startingLoadout(data, new Rng(3));
  const water = Object.values(data.skills).find((s) => s.element === 'water' && s.slot === 'basic')!;
  const all = { ...l, pool: Object.keys(data.skills) };
  assert.throws(() => swapIn(all, 'fire', 'basic', water.id, data), /element/);
  assert.throws(() => swapIn(all, 'water', 'secondary', water.id, data), /slot/);
  const unowned = Object.values(data.skills).find((s) => s.element === 'earth' && s.slot === 'basic' && !l.pool.includes(s.id))!;
  assert.throws(() => swapIn(l, 'earth', 'basic', unowned.id, data), /own/);
  assert.throws(() => swapIn(all, 'fire', 'basic', 'fire.nothing', data), /fire\.nothing/);
});

test('a run starts with a loadout whose pool grows when a skill is claimed', () => {
  const s = ROOM_TO_ROOM.start(4, data);
  assert.equal(s.skills.pool.length, 30);
  const extra = Object.keys(data.skills).find((id) => !s.skills.pool.includes(id))!;
  const next = claimReward(s, { kind: 'skill', id: extra, element: data.skills[extra].element });
  assert.ok(next.skills.pool.includes(extra));
  assert.deepEqual(next.skills.slots, s.skills.slots, 'claiming does not change what is equipped');
});

test('applyLoadout puts the loadout on the player', () => {
  const sim = makeSim();
  const l = startingLoadout(data, new Rng(5));
  applyLoadout(sim, l);
  assert.deepEqual(sim.player.loadout, l.slots);
  assert.deepEqual(sim.snapshot().players[0].slots.map((s) => s.skillId), SLOTS.map((slot) => l.slots[l.equipped[0]][slot]));
  l.slots.fire.basic = 'changed';
  assert.notEqual(sim.player.loadout.fire.basic, 'changed', 'the player has its own copy');
});

const NEW = Object.keys(data.skills).filter((id) => !['fire.fireball', 'fire.flame_cone', 'fire.flame_dash', 'water.water_bolt', 'water.tidal_stream', 'water.bubble_shield', 'earth.boulder', 'earth.spike_field', 'earth.stone_skin', 'wind.gust_volley', 'wind.cyclone', 'wind.air_dash'].includes(id) && ['fire', 'water', 'earth', 'wind'].includes(id.split('.')[0]));

test('the eight new skills each do something when cast at a dummy', () => {
  assert.equal(NEW.length, 8);
  for (const id of NEW) {
    const sim = makeSim();
    const dummy = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 3 });
    const z0 = sim.player.pos.z;
    assert.equal(castSkill(sim, sim.player, id, { x: 0, y: 0.9, z: 3 }).ok, true, id);
    run(sim, 150);
    const s = data.skills[id];
    const did = dummy.hp < 1000 || sim.player.buff !== null || sim.player.pos.z - z0 > 1 || (s.damage === 0 && s.shape.type === 'wall');
    assert.ok(did, `${id} (${s.shape.type}) had no effect`);
  }
});

test('the new skills use existing shapes and clips, and each has fx', () => {
  for (const id of NEW) {
    const s = data.skills[id];
    assert.ok(['projectile', 'cone', 'stream', 'zone', 'wall', 'self', 'dash'].includes(s.shape.type));
    assert.ok(Object.keys(s.fx).length > 0, `${id} fx`);
    assert.ok(s.tags.length > 0, `${id} tags`);
  }
});
