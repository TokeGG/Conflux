import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAugments, canSocket, MAX_SOCKETS } from '../src/run/augments.ts';
import { claimReward, offerRewards } from '../src/run/rewards.ts';
import { ROOM_TO_ROOM } from '../src/run/roomToRoom.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { makeStreams } from '../src/rng.ts';
import { castSkill } from '../src/sim/skills.ts';
import { applyStatus } from '../src/sim/statuses.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { triggerReaction } from '../src/sim/reactions.ts';
import { trySwap } from '../src/sim/swap.ts';
import type { OwnedAugment } from '../src/run/run.ts';
import type { AugmentDef, SkillDef } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

const data = defaultData();
const defs = data.augments;
const own = (id: string, rarity: OwnedAugment['rarity'], skill: string): OwnedAugment => ({ id, rarity, skill });
const apply = (skillId: string, owned: OwnedAugment[]) => applyAugments(data.skills[skillId], owned, defs);
const at = (x: number, z: number) => ({ x, y: 0, z });

test('there are 12 augments and every one passes validateData', () => {
  assert.equal(Object.keys(defs).length, 12);
  assert.deepEqual(validateData(data), []);
});

test('Wide Cone adds its rarity\'s degrees: 45 becomes 55, 60 or 70', () => {
  assert.equal(data.skills['fire.flame_cone'].shape.angle, 45);
  for (const [rarity, angle] of [['common', 55], ['rare', 60], ['epic', 70]] as const) {
    assert.equal(apply('fire.flame_cone', [own('aug.wide_cone', rarity, 'fire.flame_cone')]).shape.angle, angle, rarity);
  }
});

test('Twin Stream adds a stream: count 1 becomes 2', () => {
  assert.equal(data.skills['water.tidal_stream'].shape.count, 1);
  assert.equal(apply('water.tidal_stream', [own('aug.twin_stream', 'rare', 'water.tidal_stream')]).shape.count, 2);
  assert.equal(apply('water.tidal_stream', [own('aug.twin_stream', 'epic', 'water.tidal_stream')]).shape.count, 3);
});

test('Explosive Fireball makes fireballs explode, in a radius of 2 at rare', () => {
  const s = apply('fire.fireball', [own('aug.explosive_fireball', 'rare', 'fire.fireball')]);
  assert.equal(s.shape.explode, 2);
  assert.equal(data.skills['fire.fireball'].shape.explode, undefined);
});

test('stat augments add, multiply and set numbers, with $rarity substitution', () => {
  assert.equal(apply('fire.fireball', [own('aug.hot_hands', 'epic', 'fire.fireball')]).damage, 14 + 7);
  const mul: AugmentDef = { id: 'aug.t_mul', name: 't', kind: 'stat', rarity: { common: { m: 1.5 }, rare: { m: 2 }, epic: { m: 3 } }, target: { skill: 'fire.fireball' }, ops: [{ op: 'mul', path: 'damage', value: '$rarity.m' }, { op: 'set', path: 'cooldown', value: 0.1 }] };
  const s = applyAugments(data.skills['fire.fireball'], [own('aug.t_mul', 'rare', 'fire.fireball')], { ...defs, 'aug.t_mul': mul });
  assert.equal(s.damage, 28);
  assert.equal(s.cooldown, 0.1);
});

test('augments apply in the order they were found, and a missing rarity key is an error', () => {
  const two = [own('aug.hot_hands', 'common', 'fire.fireball'), own('aug.hot_hands', 'rare', 'fire.fireball')];
  assert.equal(apply('fire.fireball', two).damage, 14 + 2 + 4);
  const broken: AugmentDef = { id: 'aug.bad', name: 'b', kind: 'stat', rarity: { common: {}, rare: {}, epic: {} }, target: { skill: 'fire.fireball' }, ops: [{ op: 'add', path: 'damage', value: '$rarity.nothing' }] };
  assert.throws(() => applyAugments(data.skills['fire.fireball'], [own('aug.bad', 'rare', 'fire.fireball')], { ...defs, 'aug.bad': broken }), /nothing/);
});

test('a fourth augment on one skill is refused', () => {
  const three = [own('aug.hot_hands', 'common', 'fire.fireball'), own('aug.explosive_fireball', 'rare', 'fire.fireball'), own('aug.hot_hands', 'epic', 'fire.fireball')];
  assert.equal(MAX_SOCKETS, 3);
  assert.equal(canSocket('fire.fireball', three.slice(0, 2)), true);
  assert.equal(canSocket('fire.fireball', three), false);
  assert.equal(canSocket('water.water_bolt', three), true, 'other skills are not affected');
  const state = { ...ROOM_TO_ROOM.start(1, data), augments: three };
  const after = claimReward(state, { kind: 'augment', id: 'aug.hot_hands', rarity: 'rare' });
  assert.equal(after.augments.length, 3, 'the claim was refused');
});

test('claiming an augment sockets it on the skill it targets; one aimed at a tag or element is a global passive', () => {
  const state = ROOM_TO_ROOM.start(1, data);
  assert.equal(claimReward(state, { kind: 'augment', id: 'aug.wide_cone', rarity: 'rare' }).augments[0].skill, 'fire.flame_cone');
  const global = Object.entries(defs).find(([, a]) => !a.target.skill)!;
  assert.equal(claimReward(state, { kind: 'augment', id: global[0], rarity: 'rare' }).augments[0].skill, '*');
});

test('an augment aimed at the projectile tag applies to every projectile skill and to nothing else', () => {
  const quick = Object.entries(defs).find(([, a]) => a.target.tag === 'projectile')!;
  const owned = [own(quick[0], 'rare', '*')];
  for (const s of Object.values(data.skills)) {
    const out = applyAugments(s, owned, defs);
    const changed = JSON.stringify(out) !== JSON.stringify(s);
    assert.equal(changed, s.tags.includes('projectile'), `${s.id}`);
  }
});

test('an augment aimed at an element applies to that element only', () => {
  const focus = Object.entries(defs).find(([, a]) => a.target.element)!;
  const el = focus[1].target.element!;
  const owned = [own(focus[0], 'rare', '*')];
  for (const s of Object.values(data.skills)) {
    const changed = JSON.stringify(applyAugments(s, owned, defs)) !== JSON.stringify(s);
    assert.equal(changed, s.element === el && s.damage > 0, s.id);
  }
});

test('applying the same augments twice gives the same skill, and the input is never changed', () => {
  const owned = [own('aug.wide_cone', 'epic', 'fire.flame_cone'), own('aug.hot_hands', 'rare', 'fire.fireball')];
  const input = structuredClone(data.skills['fire.flame_cone']);
  const a = applyAugments(input, owned, defs);
  assert.deepEqual(applyAugments(input, owned, defs), a);
  assert.deepEqual(input, data.skills['fire.flame_cone']);
  assert.notEqual(a, input);
});

test('a cast uses the augmented skill, and the augment stays with the skill through a swap out and back', () => {
  const sim = makeSim();
  sim.setAugments([own('aug.hot_hands', 'epic', 'fire.fireball')]);
  const dummy = spawnEnemy(sim, 'enemy.dummy', at(0, 10));
  trySwap(sim, sim.player, 1);
  run(sim, 30);
  trySwap(sim, sim.player, 0);
  run(sim, 30);
  castSkill(sim, sim.player, 'fire.fireball', { x: 0, y: 0.9, z: 10 });
  run(sim, 90);
  assert.equal(1000 - dummy.hp >= 21 * 1.25 - 1e-9, true, `hit for ${1000 - dummy.hp}`);
});

test('the snapshot shows the augmented cooldown, and setData or setAugments refresh the cache', () => {
  const sim = makeSim();
  const mul: AugmentDef = { id: 'aug.quick', name: 'q', kind: 'stat', rarity: { common: { m: 0.5 }, rare: { m: 0.5 }, epic: { m: 0.5 } }, target: { skill: 'fire.fireball' }, ops: [{ op: 'mul', path: 'cooldown', value: '$rarity.m' }] };
  sim.data.augments['aug.quick'] = mul;
  assert.equal(sim.snapshot().players[0].slots[0].total, 0.45);
  sim.setAugments([own('aug.quick', 'rare', 'fire.fireball')]);
  assert.equal(sim.snapshot().players[0].slots[0].total, 0.225);
  sim.setAugments([]);
  assert.equal(sim.snapshot().players[0].slots[0].total, 0.45);
});

test('an exploding fireball also hurts a neighbour of the enemy it hits, and a plain one does not', () => {
  const neighbours = (augment: boolean) => {
    const sim = makeSim();
    if (augment) sim.setAugments([own('aug.explosive_fireball', 'rare', 'fire.fireball')]);
    const hit = spawnEnemy(sim, 'enemy.dummy', at(0, 10));
    const near = spawnEnemy(sim, 'enemy.dummy', at(1.5, 10));
    const far = spawnEnemy(sim, 'enemy.dummy', at(6, 10));
    for (const e of [hit, near, far]) e.def = { ...e.def, immune: ['burning'] }; // burning spreads between neighbours on its own; only the blast is measured
    castSkill(sim, sim.player, 'fire.fireball', { x: 0, y: 0.9, z: 10 });
    run(sim, 90);
    return { hit: 1000 - hit.hp, near: 1000 - near.hp, far: 1000 - far.hp };
  };
  assert.equal(neighbours(false).near, 0);
  const boom = neighbours(true);
  assert.ok(boom.near > 0 && boom.far === 0 && boom.hit > 0, JSON.stringify(boom));
});

test('a piercing shot goes through the first enemy and hits the one behind it', () => {
  const behind = (augment: boolean) => {
    const sim = makeSim();
    if (augment) sim.setAugments([own('aug.piercing_gust', 'rare', 'wind.gust_volley')]);
    const first = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
    const second = spawnEnemy(sim, 'enemy.dummy', at(0, 12));
    sim.player.element = 3;
    castSkill(sim, sim.player, 'wind.gust_volley', { x: 0, y: 0.9, z: 8 });
    run(sim, 90);
    return { first: 1000 - first.hp, second: 1000 - second.hp };
  };
  assert.equal(behind(false).second, 0);
  const through = behind(true);
  assert.ok(through.first > 0 && through.second > 0, JSON.stringify(through));
});

test('two streams cover more ground than one', () => {
  const hits = (augment: boolean) => {
    const sim = makeSim();
    if (augment) sim.setAugments([own('aug.twin_stream', 'epic', 'water.tidal_stream')]);
    const off = spawnEnemy(sim, 'enemy.dummy', at(1.3, 6));
    castSkill(sim, sim.player, 'water.tidal_stream', { x: 0, y: 1.4, z: 20 });
    run(sim, 120);
    return 1000 - off.hp;
  };
  assert.equal(hits(false), 0);
  assert.ok(hits(true) > 0);
});

test('a reaction augment widens the reaction: a bigger Steam reaches an enemy it would have missed', () => {
  const burst = (augment: boolean) => {
    const sim = makeSim();
    if (augment) sim.setAugments([own('aug.bigger_steam', 'epic', '*')]);
    const target = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
    const edge = spawnEnemy(sim, 'enemy.dummy', at(3.8, 8));
    applyStatus(sim, target, 'soaked', sim.time);
    triggerReaction(sim, target, 'fire', 10, sim.time);
    return 1000 - edge.hp;
  };
  assert.equal(burst(false), 0);
  assert.ok(burst(true) > 0);
});

test('augments are part of the state hash', () => {
  const a = makeSim(3);
  const b = makeSim(3);
  assert.equal(a.hash(), b.hash());
  a.setAugments([own('aug.hot_hands', 'rare', 'fire.fireball')]);
  assert.notEqual(a.hash(), b.hash());
});

test('rewards only offer augments that can be used: not for a skill that is not owned or whose sockets are full', () => {
  const state = ROOM_TO_ROOM.start(2, data);
  for (let seed = 1; seed <= 60; seed++) {
    const offers = offerRewards({ ...state, skills: { ...state.skills, pool: ['fire.fireball'] }, augments: [own('aug.hot_hands', 'common', 'fire.fireball'), own('aug.hot_hands', 'rare', 'fire.fireball'), own('aug.hot_hands', 'epic', 'fire.fireball')] }, data, makeStreams(seed).reward);
    for (const o of offers.filter((x) => x.kind === 'augment')) {
      const t = defs[o.id!].target;
      assert.ok(!t.skill, `${o.id} targets ${t.skill}, which is either not owned or full`);
    }
  }
});
