// The six new elements (lightning, light, dark, metal, poison, time): their statuses, their 18 skills and what each of the 45 reactions does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerReaction } from '../src/sim/reactions.ts';
import { applyStatus, statusModifiers } from '../src/sim/statuses.ts';
import { castSkill, damageEnemy } from '../src/sim/skills.ts';
import { dealDamage } from '../src/sim/damage.ts';
import { outgoing } from '../src/sim/attacks.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import type { Sim } from '../src/sim/sim.ts';
import { ELEMENTS, type Element, type StatusId } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

const NEW = ['lightning', 'light', 'dark', 'metal', 'poison', 'time'] as const;
const at = (x: number, z: number) => ({ x, y: 0, z });
const lost = (e: EnemyState) => 1000 - e.hp;
const mods = (sim: Sim, e: EnemyState) => statusModifiers(e, sim.time, sim.data.statuses);
const reactsAs = (sim: Sim, el: Element): StatusId => sim.data.elements.reacts[el];

function setup() {
  const sim = makeSim();
  const target = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  return { sim, target };
}

/** `first` marks the target, then `second` hits it for 10. */
function react(sim: Sim, target: EnemyState, first: Element, second: Element, hit = 10) {
  applyStatus(sim, target, reactsAs(sim, first), sim.time);
  const res = triggerReaction(sim, target, second, hit, sim.time);
  assert.ok(res, `${first} then ${second} reacts`);
  return res;
}

// ---- the statuses ----

test('Shocked jolts for 2 every 0.8 s and slows 10%', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'shocked', sim.time);
  assert.equal(mods(sim, target).speedMul, 0.9);
  run(sim, 49);
  assert.equal(lost(target), 2, 'one jolt in the first 0.8 s');
  run(sim, 250);
  assert.equal(target.statuses.shocked, undefined);
  assert.ok(Math.abs(lost(target) - 10) < 1e-9, `five jolts in 4 s (${lost(target)})`);
});

test('Exposed makes the target take 25% more damage', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'exposed', sim.time);
  assert.equal(dealDamage(sim, target, 10, 'none'), 12.5);
});

test('Cursed weakens what the enemy deals by 25%', () => {
  const { sim, target } = setup();
  assert.equal(outgoing(sim, target), 1);
  applyStatus(sim, target, 'cursed', sim.time);
  assert.equal(outgoing(sim, target), 0.75);
  run(sim, 8 * 60 + 2);
  assert.equal(outgoing(sim, target), 1, 'the curse ends');
});

test('Rent bleeds 2.5 every half second for 5 s', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'rent', sim.time);
  run(sim, 5 * 60 + 2);
  assert.ok(Math.abs(lost(target) - 25) < 1e-9, `ten ticks (${lost(target)})`);
});

test('Poisoned stacks up to five, each stack ticking 1.5 a second', () => {
  const { sim, target } = setup();
  for (let i = 0; i < 7; i++) applyStatus(sim, target, 'poisoned', sim.time);
  assert.equal(target.statuses.poisoned!.stacks, 5, 'capped at five');
  assert.equal(sim.snapshot().enemies[0].statuses.find((s) => s.id === 'poisoned')!.stacks, 5, 'the snapshot shows the stacks');
  run(sim, 61);
  assert.ok(Math.abs(lost(target) - 7.5) < 1e-9, `five stacks tick 7.5 in the first second (${lost(target)})`);
  const single = setup();
  applyStatus(single.sim, single.target, 'poisoned', single.sim.time);
  run(single.sim, 61);
  assert.ok(Math.abs(lost(single.target) - 1.5) < 1e-9);
});

test('Dilated slows the target to 60% for 5 s', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'dilated', sim.time);
  assert.equal(mods(sim, target).speedMul, 0.6);
  run(sim, 5 * 60 + 2);
  assert.equal(mods(sim, target).speedMul, 1);
});

test('an enemy is immune to the status of its own element', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  e.def = { ...e.def, element: 'poison' };
  applyStatus(sim, e, 'poisoned', sim.time);
  assert.equal(e.statuses.poisoned, undefined);
});

// ---- the skills ----

test('each of the 18 new skills exists, is free to find, and sits on its element\'s slot', () => {
  const { sim } = setup();
  for (const el of NEW) {
    for (const slot of ['basic', 'secondary', 'utility'] as const) {
      const found = Object.values(sim.data.skills).filter((s) => s.element === el && s.slot === slot);
      assert.equal(found.length, 1, `${el} ${slot}`);
      assert.ok(!Object.values(sim.data.unlocks).some((u) => u.unlocks.skills?.includes(found[0].id)), `${found[0].id} is not locked`);
    }
  }
});

test('every new skill casts, and the ones that hurt leave their element\'s status', () => {
  for (const el of NEW) {
    for (const slot of ['basic', 'secondary', 'utility'] as const) {
      const sim = makeSim();
      const id = sim.player.loadout[el][slot];
      assert.ok(id, `${el} ${slot} is on the bar`);
      const skill = sim.data.skills[id];
      const near = spawnEnemy(sim, 'enemy.dummy', at(0, 4));
      sim.player.pos = at(0, 0);
      assert.deepEqual(castSkill(sim, sim.player, id, { x: 0, y: 1, z: 4 }), { ok: true }, id);
      run(sim, 90);
      if (skill.shape.type === 'dash') assert.ok(sim.player.pos.z > 1 || sim.player.invulnUntil > 0 || skill.shape.distance, `${id} moves you`);
      if (skill.shape.type === 'self') assert.equal(sim.player.buff?.skillId ?? id, id);
      if (skill.shape.type !== 'self' && skill.shape.type !== 'dash') {
        assert.ok(near.hp < 1000, `${id} hurt the dummy`);
        assert.ok(near.statuses[skill.applies!], `${id} left ${skill.applies}`);
        assert.equal(skill.applies, sim.data.elements.status[el], `${id} applies its element's status`);
      }
    }
  }
});

test('a dash with a trail leaves its element\'s status on whoever stands in it', () => {
  for (const [el, status] of [['lightning', 'shocked'], ['dark', 'cursed'], ['poison', 'poisoned']] as const) {
    const sim = makeSim();
    const id = sim.player.loadout[el].utility;
    const e = spawnEnemy(sim, 'enemy.dummy', at(0, 3));
    sim.player.pos = at(0, 0);
    castSkill(sim, sim.player, id, { x: 0, y: 1, z: 6 });
    run(sim, 80);
    assert.ok(e.statuses[status], `${id} left ${status} on the path`);
  }
});

// ---- the reactions ----

test('Plasma bursts for 250% in 4.5 m', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  react(sim, target, 'lightning', 'fire');
  assert.equal(lost(target), 25);
  assert.equal(lost(near), 25);
  assert.equal(lost(far), 0);
});

test('Overheat makes a burn tick three times as fast', () => {
  const normal = setup();
  applyStatus(normal.sim, normal.target, 'burning', normal.sim.time);
  run(normal.sim, 120);
  const { sim, target } = setup();
  react(sim, target, 'time', 'fire');
  assert.ok(target.statuses.burning && target.marks.overheat, 'burning, with the mark');
  run(sim, 120);
  assert.ok(lost(target) > lost(normal.target) * 2.5, `${lost(target)} against ${lost(normal.target)}`);
});

test('Toxic Blaze detonates the poison: more damage for every stack, and the cloud is used up', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  for (let i = 0; i < 3; i++) applyStatus(sim, target, 'poisoned', sim.time);
  applyStatus(sim, near, 'poisoned', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time);
  assert.ok(Math.abs(lost(target) - 10 * (0.8 + 0.4 * 3)) < 1e-9, `three stacks (${lost(target)})`);
  assert.equal(near.statuses.poisoned, undefined);
});

test('Solar Flare blinds everything within 5 m for 4 s', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(8, 8));
  react(sim, target, 'light', 'fire');
  assert.ok(Math.abs(near.marks.blind!.until - 4) < 1e-9);
  assert.equal(far.marks.blind, undefined);
});

test('Hellfire cannot be put out and spreads to neighbours when the target dies', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(9, 8));
  react(sim, target, 'dark', 'fire');
  assert.ok(target.statuses.burning && target.marks.hellfire);
  sim.step([]);
  run(sim, 50);
  applyStatus(sim, target, 'soaked', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time); // water's status met by fire would be steam, but the fire stays
  assert.ok(target.statuses.burning, 'still burning after a reaction that would have put it out');
  const wet = setup();
  react(wet.sim, wet.target, 'dark', 'fire');
  applyStatus(wet.sim, wet.target, 'burning', wet.sim.time);
  run(wet.sim, 50);
  triggerReaction(wet.sim, wet.target, 'water', 10, wet.sim.time);
  assert.ok(wet.target.statuses.burning, 'a water hit does not put hellfire out');
  damageEnemy(sim, target, 5000, 'test', target.pos);
  assert.ok(near.statuses.burning && near.marks.hellfire, 'the neighbour catches it');
  assert.equal(far.statuses.burning, undefined);
});

test('Forge melts armour (+25% damage taken) and leaves a slag pool', () => {
  const { sim, target } = setup();
  react(sim, target, 'metal', 'fire');
  assert.ok(Math.abs(target.marks.corroded!.damageTakenMul! - 1.25) < 1e-9);
  assert.equal(sim.zones[0].kind, 'slag');
});

test('Chain Lightning jumps through Soaked enemies only, 80% a jump, and not past the range', () => {
  const { sim, target } = setup();
  const a = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  const b = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  const c = spawnEnemy(sim, 'enemy.dummy', at(9, 8));
  const dry = spawnEnemy(sim, 'enemy.dummy', at(0, 11));
  const far = spawnEnemy(sim, 'enemy.dummy', at(20, 8));
  for (const e of [target, a, b, c, far]) applyStatus(sim, e, 'soaked', sim.time);
  triggerReaction(sim, target, 'lightning', 10, sim.time);
  for (const e of [a, b, c]) assert.equal(lost(e), 8, 'each jump deals 80%');
  assert.equal(lost(dry), 0, 'a dry enemy is skipped');
  assert.equal(lost(far), 0, 'out of range of the last jump');
  assert.ok(a.statuses.shocked && c.statuses.shocked, 'every enemy the arc reaches is shocked');
  assert.ok(a.statuses.soaked, 'and stays soaked');
});

test('Chain Lightning works the other way round too: water on a Shocked target', () => {
  const { sim, target } = setup();
  const a = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  applyStatus(sim, a, 'soaked', sim.time);
  react(sim, target, 'lightning', 'water');
  assert.equal(lost(a), 8);
});

test('Stasis holds the target still for 2 s', () => {
  const { sim, target } = setup();
  react(sim, target, 'time', 'water');
  assert.equal(mods(sim, target).canAct, false);
  assert.equal(mods(sim, target).speedMul, 0);
  run(sim, 125);
  assert.equal(mods(sim, target).canAct, true);
});

test('Toxic Flood is a puddle that grows and poisons whoever stands in it', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3.5, 8));
  react(sim, target, 'poison', 'water');
  assert.equal(sim.zones[0].radius, 2);
  run(sim, 150);
  assert.ok(sim.zones[0].radius > 3.2, `grew to ${sim.zones[0].radius}`);
  assert.ok(near.statuses.poisoned, 'it reached the neighbour once it had spread');
  assert.ok(target.statuses.poisoned);
});

test('Prism refracts 70% onto the three nearest other enemies and exposes them', () => {
  const { sim, target } = setup();
  const near = [2, 3, 4, 5].map((x) => spawnEnemy(sim, 'enemy.dummy', at(x, 8)));
  react(sim, target, 'light', 'water');
  assert.deepEqual(near.map(lost), [7, 7, 7, 0]);
  assert.ok(near[0].statuses.exposed);
  assert.equal(near[3].statuses.exposed, undefined);
});

test('Whirlpool pulls enemies in toward the middle', () => {
  const { sim, target } = setup();
  const other = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  react(sim, target, 'dark', 'water');
  run(sim, 60);
  assert.ok(other.pos.x < 2, `pulled from 4 m to ${other.pos.x}`);
});

test('Rust breaks armour (+20% damage taken) and eats away at the target', () => {
  const { sim, target } = setup();
  react(sim, target, 'metal', 'water');
  assert.ok(Math.abs(target.marks.corroded!.damageTakenMul! - 1.2) < 1e-9);
  run(sim, 240);
  assert.ok(lost(target) >= 10 && lost(target) <= 14, `about 3 a second (${lost(target)})`);
});

test('Fulgurite shatters into glass: a burst, a stun and bleeding for everything near', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  react(sim, target, 'lightning', 'earth');
  assert.equal(lost(near), 10);
  assert.ok(near.marks.stunned && Math.abs(near.marks.stunned.until - 1.5) < 1e-9);
  assert.ok(near.statuses.rent);
});

test('Petrify wraps the target in a slow stone shell', () => {
  const { sim, target } = setup();
  react(sim, target, 'time', 'earth');
  assert.equal(target.marks.petrified!.speedMul, 0.3);
  assert.equal(target.marks.petrified!.damageTakenMul, 0.8);
});

test('Spore Bloom poisons what stands in it', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  react(sim, target, 'poison', 'earth');
  run(sim, 40);
  assert.ok(near.statuses.poisoned);
});

test('Crystal and Mirror turn an enemy shot back at the shooter', () => {
  for (const [first, second] of [['light', 'earth'], ['metal', 'light']] as const) {
    const { sim, target } = setup();
    const shooter = spawnEnemy(sim, 'enemy.dummy', at(12, 8));
    sim.player.pos = at(0, 8);
    react(sim, target, first, second);
    const attack = Object.values(sim.data.attacks).find((a) => a.template === 'projectile')!;
    sim.projectiles.push({ id: sim.allocId(), pos: { x: 2, y: 1, z: 8 }, vel: { x: -10, y: 0, z: 0 }, r: 0.3, gravity: 0, skillId: attack.id, ownerId: shooter.id, diesAt: 10, hit: [] });
    sim.step([]);
    assert.equal(sim.projectiles[0].ownerId, 0, `${first}+${second}: the shot is now ours`);
    assert.ok(sim.projectiles[0].vel.x > 0, 'it flies back toward the shooter');
    run(sim, 120);
    assert.ok(shooter.hp < 1000, `${first}+${second}: the shooter was hit by its own shot`);
    assert.equal(sim.player.hp, sim.data.player.health, 'and we were not');
  }
});

test('Sinkhole holds enemies inside it in place', () => {
  const { sim, target } = setup();
  const other = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  react(sim, target, 'dark', 'earth');
  run(sim, 5);
  assert.ok(target.marks.rooted && other.marks.rooted);
  assert.equal(mods(sim, other).speedMul, 0);
});

test('Ore Shards burst for 80% and make everything near bleed', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  react(sim, target, 'metal', 'earth');
  assert.equal(lost(near), 8);
  assert.ok(near.statuses.rent && target.statuses.rent);
});

test('Thunderstorm drops bolts on random enemies inside it', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  react(sim, target, 'lightning', 'wind');
  run(sim, 6 * 60 + 5);
  assert.equal(sim.zones.length, 0, 'the storm ends');
  assert.ok(lost(target) + lost(near) >= 9 * 5, `about eight bolts of 9 (${lost(target) + lost(near)})`);
  assert.ok(target.statuses.shocked || near.statuses.shocked);
});

test('Time Rift slows everything in it, shots included', () => {
  const { sim, target } = setup();
  react(sim, target, 'wind', 'time');
  run(sim, 5);
  assert.equal(target.marks.slowed!.speedMul, 0.4);
  const shooter = spawnEnemy(sim, 'enemy.dummy', at(0, 20));
  const attack = Object.values(sim.data.attacks).find((a) => a.template === 'projectile')!;
  sim.player.pos = at(0, 30);
  sim.projectiles.push({ id: sim.allocId(), pos: { x: 0, y: 1, z: 9 }, vel: { x: 0, y: 0, z: 10 }, r: 0.1, gravity: 0, skillId: attack.id, ownerId: shooter.id, diesAt: 10, hit: [] });
  run(sim, 60);
  assert.ok(sim.projectiles[0].pos.z < 9 + 5, `it crawled to ${sim.projectiles[0].pos.z}`);
});

test('Miasma poisons everything within 6 m and leaves a cloud', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(5, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(12, 8));
  react(sim, target, 'poison', 'wind');
  assert.ok(near.statuses.poisoned);
  assert.equal(far.statuses.poisoned, undefined);
  assert.equal(sim.zones[0].kind, 'miasma');
});

test('Aurora speeds you up and exposes the enemies round it', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  react(sim, target, 'wind', 'light');
  assert.equal(mods(sim, sim.player as never).speedMul, 1.25);
  assert.ok(near.statuses.exposed);
});

test('Vacuum implodes: everything within 9 m is drawn to the middle', () => {
  const { sim, target } = setup();
  const other = spawnEnemy(sim, 'enemy.dummy', at(0, 14));
  const out = spawnEnemy(sim, 'enemy.dummy', at(0, 25));
  react(sim, target, 'dark', 'wind');
  assert.ok(Math.hypot(other.pos.x, other.pos.z - 8) < 1, `now at ${other.pos.z}`);
  assert.equal(out.pos.z, 25);
});

test('Razor Wind cuts four times and makes the target bleed', () => {
  const { sim, target } = setup();
  react(sim, target, 'metal', 'wind');
  assert.ok(Math.abs(lost(target) - 4 * 3) < 1e-9);
  assert.ok(target.statuses.rent);
});

test('Overclock fires the arc twice', () => {
  const { sim, target } = setup();
  const a = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  react(sim, target, 'time', 'lightning');
  assert.equal(lost(a), 12, 'hit twice at 60%');
});

test('Toxic Arc carries poison along the chain', () => {
  const { sim, target } = setup();
  const a = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  const b = spawnEnemy(sim, 'enemy.dummy', at(7, 8));
  react(sim, target, 'poison', 'lightning');
  assert.ok(a.statuses.poisoned && b.statuses.poisoned);
  assert.equal(lost(a), 6);
});

test('Radiant Bolt is a beam through the target that hurts and exposes everything in line', () => {
  const { sim, target } = setup();
  const behind = spawnEnemy(sim, 'enemy.dummy', at(0, 15));
  const aside = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  sim.player.pos = at(0, 0);
  react(sim, target, 'light', 'lightning');
  assert.equal(lost(target), 12);
  assert.equal(lost(behind), 12);
  assert.ok(behind.statuses.exposed);
  assert.equal(lost(aside), 0);
});

test('Void Arc reaches twice as far and curses what it touches', () => {
  const { sim, target } = setup();
  const far = spawnEnemy(sim, 'enemy.dummy', at(12, 8));
  react(sim, target, 'dark', 'lightning');
  assert.ok(far.statuses.cursed);
  assert.equal(lost(far), 7);
});

test('Conduction jumps far, hits twice and makes the target bleed', () => {
  const { sim, target } = setup();
  const far = spawnEnemy(sim, 'enemy.dummy', at(11, 8));
  react(sim, target, 'metal', 'lightning');
  assert.equal(lost(far), 10, 'two hits of 50%');
  assert.ok(far.statuses.rent);
});

test('Wither makes every poison stack tick all at once', () => {
  const { sim, target } = setup();
  for (let i = 0; i < 3; i++) applyStatus(sim, target, 'poisoned', sim.time);
  triggerReaction(sim, target, 'time', 10, sim.time);
  assert.ok(Math.abs(lost(target) - 1.5 * 3 * 8) < 1e-9, `3 stacks of 8 ticks (${lost(target)})`);
  assert.equal(target.statuses.poisoned, undefined);
});

test('Haste Aura makes your skill cooldowns run faster for a few seconds', () => {
  const plain = setup();
  plain.sim.player.cooldowns['fire.fireball'] = 20;
  run(plain.sim, 120);
  const { sim, target } = setup();
  sim.player.cooldowns['fire.fireball'] = 20;
  react(sim, target, 'time', 'light');
  run(sim, 120);
  assert.ok(20 - sim.player.cooldowns['fire.fireball'] > 20 - plain.sim.player.cooldowns['fire.fireball'] + 1, `${sim.player.cooldowns['fire.fireball']} against ${plain.sim.player.cooldowns['fire.fireball']}`);
  run(sim, 4 * 60);
  assert.equal(sim.player.marks.haste, undefined, 'it ends');
});

test('Rewind Curse replays 80% of the last seconds of damage and curses the target', () => {
  const { sim, target } = setup();
  damageEnemy(sim, target, 20, 'test', target.pos);
  react(sim, target, 'time', 'dark');
  assert.ok(Math.abs(lost(target) - (20 + 16)) < 1e-9, `${lost(target)}`);
  assert.ok(target.statuses.cursed);
});

test('Fatigue makes the target take more damage the longer it lasts', () => {
  const { sim, target } = setup();
  react(sim, target, 'time', 'metal');
  const early = mods(sim, target).damageTakenMul;
  run(sim, 5 * 60);
  const late = mods(sim, target).damageTakenMul;
  assert.ok(late > early + 0.3, `${early} then ${late}`);
  run(sim, 4 * 60);
  assert.ok(!target.marks.fatigue, 'it wears off');
});

test('Purge eats the poison and heals you for every stack', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  sim.player.hp = 50;
  for (let i = 0; i < 2; i++) applyStatus(sim, target, 'poisoned', sim.time);
  applyStatus(sim, near, 'poisoned', sim.time);
  triggerReaction(sim, target, 'light', 10, sim.time);
  assert.equal(sim.player.hp, 50 + 3 * 4);
  assert.equal(near.statuses.poisoned, undefined);
});

test('Plague spreads to the neighbours when the target dies', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(3, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(9, 8));
  react(sim, target, 'poison', 'dark');
  damageEnemy(sim, target, 5000, 'test', target.pos);
  assert.ok(near.statuses.poisoned && near.marks.plague, 'it carries on');
  assert.equal(far.statuses.poisoned, undefined);
});

test('Corrosion melts armour a stack at a time', () => {
  const { sim, target } = setup();
  react(sim, target, 'poison', 'metal');
  assert.ok(Math.abs(target.marks.corroded!.damageTakenMul! - 1.08) < 1e-9);
  run(sim, 50);
  applyStatus(sim, target, 'poisoned', sim.time);
  triggerReaction(sim, target, 'metal', 10, sim.time);
  assert.equal(target.marks.corroded!.stacks, 2);
  assert.ok(Math.abs(target.marks.corroded!.damageTakenMul! - 1.16) < 1e-9);
});

test('Eclipse uses up both statuses in a huge nova', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  applyStatus(sim, near, 'exposed', sim.time);
  react(sim, target, 'light', 'dark');
  assert.equal(lost(target), 35);
  assert.equal(lost(near), 35);
  assert.equal(target.statuses.exposed, undefined);
  assert.equal(target.statuses.cursed, undefined);
  assert.equal(near.statuses.exposed, undefined);
  assert.ok(near.marks.stunned);
});

test('Cursed Steel heals you for a fifth of what you hit the target for', () => {
  const { sim, target } = setup();
  react(sim, target, 'dark', 'metal');
  sim.player.hp = 50;
  const dealt = dealDamage(sim, target, 40, 'none');
  assert.ok(Math.abs(sim.player.hp - (50 + dealt * 0.2)) < 1e-9, `${sim.player.hp} after ${dealt}`);
});

// ---- the whole roster ----

test('each element held in turn: its three skills cast against a crowd for ten seconds without trouble', () => {
  for (const el of ELEMENTS) {
    const sim = makeSim();
    sim.player.equipped = [el, ELEMENTS[(ELEMENTS.indexOf(el) + 1) % 10], ELEMENTS[(ELEMENTS.indexOf(el) + 2) % 10]];
    sim.player.element = ELEMENTS.indexOf(el);
    for (const x of [-3, 0, 3]) spawnEnemy(sim, 'enemy.dummy', at(x, 7));
    for (let t = 0; t < 600; t++) {
      const slot = t % 3 === 0 ? 'basic' : t % 3 === 1 ? 'secondary' : 'utility';
      const id = sim.player.loadout[el][slot];
      if (t % 20 === 0) castSkill(sim, sim.player, id, { x: 0, y: 1, z: 7 });
      sim.step([]);
      assert.ok(Number.isFinite(sim.player.hp));
    }
    sim.hash();
    sim.snapshot();
  }
});
