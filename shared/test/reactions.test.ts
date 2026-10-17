import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerReaction, triggerReactions } from '../src/sim/reactions.ts';
import { applyStatus, statusModifiers } from '../src/sim/statuses.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { TICK, type Sim } from '../src/sim/sim.ts';
import { ELEMENTS, STATUS_IDS } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });
const mods = (sim: Sim, e: EnemyState) => statusModifiers(e, sim.time, sim.data.statuses);
const lost = (e: EnemyState) => 1000 - e.hp;

function setup() {
  const sim = makeSim();
  const target = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  return { sim, target };
}

test('all 12 rows of the reaction table fire, consume the old status and apply the hit element\'s own', () => {
  const { sim: probe } = setup();
  assert.equal(probe.data.reactions.length, 12);
  for (const row of probe.data.reactions) {
    const { sim, target } = setup();
    applyStatus(sim, target, row.existing, sim.time);
    const res = triggerReaction(sim, target, row.hitBy, 10, sim.time);
    assert.ok(res, `${row.id} fired`);
    assert.equal(res.id, row.id);
    assert.equal(res.effect, row.effect);
    assert.equal(target.statuses[row.existing], undefined, `${row.id} consumed ${row.existing}`);
    const own = sim.data.elements.status[row.hitBy];
    if (own) assert.ok(target.statuses[own], `${row.id} applied ${own}`);
    else assert.deepEqual(Object.keys(target.statuses), [], `${row.id} (wind) applies nothing`);
    const ev = sim.step([]).find((e) => e.type === 'reaction');
    assert.ok(ev, `${row.id} emitted an event`);
    assert.equal(ev.id, row.id);
    assert.equal(ev.enemyId, target.id);
    assert.ok((ev.pos as { x: number }).x === 0);
  }
});

test('every ordered pair of a status and a different element is covered by exactly one row', () => {
  const { sim } = setup();
  let pairs = 0;
  for (const status of STATUS_IDS) {
    const source = ELEMENTS.find((e) => sim.data.elements.status[e] === status) ?? 'wind';
    for (const el of ELEMENTS) {
      if (el === source) continue;
      pairs++;
      assert.equal(sim.data.reactions.filter((r) => r.existing === status && r.hitBy === el).length, 1, `${status}+${el}`);
    }
  }
  assert.equal(pairs, sim.data.reactions.length);
});

test('a hit of the same element as the status, or on a target with no status, does nothing special', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'soaked', sim.time);
  assert.equal(triggerReaction(sim, target, 'water', 10, sim.time), null);
  assert.ok(target.statuses.soaked, 'still soaked');
  const clean = spawnEnemy(sim, 'enemy.dummy', at(5, 8));
  assert.equal(triggerReaction(sim, clean, 'fire', 10, sim.time), null);
});

test('Steam bursts for 100% of the hit in 3 m and blinds for 3 s', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  applyStatus(sim, target, 'soaked', sim.time);
  const res = triggerReaction(sim, target, 'fire', 10, sim.time)!;
  assert.equal(res.damage, 10);
  assert.equal(lost(near), 10);
  assert.equal(lost(far), 0);
  assert.ok(Math.abs(near.marks.blind!.until - 3) < 1e-9);
  assert.equal(far.marks.blind, undefined);
});

test('Obsidian makes a brittle shell: +30% damage taken and half speed for 4 s', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'burning', sim.time);
  triggerReaction(sim, target, 'earth', 10, sim.time);
  assert.ok(Math.abs(mods(sim, target).damageTakenMul - 1.3 * 1.15) < 1e-9, 'brittle times the rocked the earth hit applied');
  assert.equal(mods(sim, target).speedMul, 0.5);
  run(sim, 250);
  assert.equal(target.marks.brittle, undefined);
});

test('Firestorm sets enemies within 6 m alight and bursts for 60%', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(5, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(7, 8));
  applyStatus(sim, target, 'burning', sim.time);
  triggerReaction(sim, target, 'wind', 10, sim.time);
  assert.ok(near.statuses.burning);
  assert.equal(far.statuses.burning, undefined);
  assert.equal(lost(near), 6);
});

test('Mud roots for 2 s, then slows 40% for the following 4 s', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'soaked', sim.time);
  triggerReaction(sim, target, 'earth', 10, sim.time);
  assert.equal(mods(sim, target).speedMul, 0, 'rooted');
  run(sim, 90);
  assert.equal(mods(sim, target).speedMul, 0, 'still rooted at 1.5 s');
  run(sim, 60);
  assert.equal(mods(sim, target).speedMul, 0.6);
  assert.equal(mods(sim, target).canAct, true, 'a rooted enemy can still act');
  run(sim, 215);
  assert.equal(mods(sim, target).speedMul, 1);
});

test('Shock Chain jumps to at most 3 other Soaked enemies within 8 m at 70%', () => {
  const { sim, target } = setup();
  const a = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  const b = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  const c = spawnEnemy(sim, 'enemy.dummy', at(6, 8));
  const d = spawnEnemy(sim, 'enemy.dummy', at(7.5, 8));
  const dry = spawnEnemy(sim, 'enemy.dummy', at(0, 10));
  const out = spawnEnemy(sim, 'enemy.dummy', at(0, 20));
  for (const e of [target, a, b, c, d, out]) applyStatus(sim, e, 'soaked', sim.time);
  triggerReaction(sim, target, 'wind', 10, sim.time);
  assert.equal(lost(a), 7);
  assert.equal(lost(b), 7);
  assert.equal(lost(c), 7);
  assert.equal(lost(d), 0, 'a fourth jump does not happen');
  assert.equal(lost(dry), 0, 'dry enemies are skipped');
  assert.equal(lost(out), 0, 'out of range');
});

test('Magma leaves a 4 m pool for 4 s that burns whatever stands in it', () => {
  const { sim, target } = setup();
  target.def = { ...target.def, immune: ['burning'] }; // so only the pool's damage is counted
  applyStatus(sim, target, 'rocked', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time);
  assert.equal(sim.zones.length, 1);
  assert.equal(sim.zones[0].radius, 4);
  run(sim, 250);
  assert.equal(sim.zones.length, 0, 'gone after 4 s');
  assert.ok(lost(target) >= 21 && lost(target) <= 27, `about 6 a second for 4 s (${lost(target)})`);
});

test('Sandstorm hurts and blinds inside a 4 m area for 3 s', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'rocked', sim.time);
  triggerReaction(sim, target, 'wind', 10, sim.time);
  run(sim, 20);
  assert.ok(target.marks.blind, 'blinded');
  run(sim, 180);
  assert.equal(sim.zones.length, 0);
  assert.ok(lost(target) >= 12 && lost(target) <= 18, `about 5 a second for 3 s (${lost(target)})`);
});

test('Fire Tornado lifts the target for 1.5 s, deals 150% over that time and spreads burning', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(1, 8));
  applyStatus(sim, target, 'gusted', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time);
  assert.equal(mods(sim, target).canAct, false, 'airborne');
  run(sim, 100);
  assert.equal(mods(sim, target).canAct, true, 'down again after 1.5 s');
  assert.ok(near.statuses.burning || lost(near) > 0, 'the neighbour was caught');
  assert.ok(lost(target) >= 15, `150% of 10 at least (${lost(target)})`);
});

test('Rain Cloud soaks enemies in a 5 m cloud for 5 s and heals the player 2% a second', () => {
  const { sim, target } = setup();
  sim.player.pos = at(0, 6);
  sim.player.hp = 50;
  applyStatus(sim, target, 'gusted', sim.time);
  triggerReaction(sim, target, 'water', 10, sim.time);
  run(sim, 120);
  assert.ok(target.statuses.soaked);
  assert.ok(sim.player.hp > 51 && sim.player.hp < 56, `hp ${sim.player.hp}`);
  run(sim, 240);
  assert.equal(sim.zones.length, 0);
});

test('Meteor Slam hits for 200% in 3 m and stuns for 1 s', () => {
  const { sim, target } = setup();
  const near = spawnEnemy(sim, 'enemy.dummy', at(2, 8));
  const far = spawnEnemy(sim, 'enemy.dummy', at(4, 8));
  applyStatus(sim, target, 'gusted', sim.time);
  triggerReaction(sim, target, 'earth', 10, sim.time);
  assert.equal(lost(target), 20);
  assert.equal(lost(near), 20);
  assert.equal(lost(far), 0);
  assert.equal(mods(sim, target).canAct, false);
  run(sim, 61);
  assert.equal(mods(sim, target).canAct, true);
});

test('the same reaction on the same enemy is blocked for 0.75 s and allowed after', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'soaked', sim.time);
  assert.ok(triggerReaction(sim, target, 'fire', 10, sim.time));
  applyStatus(sim, target, 'soaked', sim.time);
  run(sim, 44);
  assert.equal(triggerReaction(sim, target, 'fire', 10, sim.time), null, 'blocked at 0.73 s');
  assert.ok(target.statuses.soaked, 'a blocked reaction consumes nothing');
  run(sim, 2);
  assert.ok(triggerReaction(sim, target, 'fire', 10, sim.time), 'allowed at 0.77 s');
});

test('a different reaction on the same enemy is not held up by the cooldown', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'soaked', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time);
  applyStatus(sim, target, 'burning', sim.time);
  assert.ok(triggerReaction(sim, target, 'wind', 10, sim.time));
});

test('reactions triggered in one tick on different enemies resolve lower id first', () => {
  const { sim, target } = setup();
  const second = spawnEnemy(sim, 'enemy.dummy', at(30, 8));
  for (const e of [target, second]) applyStatus(sim, e, 'soaked', sim.time);
  const results = triggerReactions(sim, [{ enemy: second, element: 'fire', damage: 10 }, { enemy: target, element: 'fire', damage: 10 }], sim.time);
  assert.deepEqual(results.map((r) => r?.enemyId), [target.id, second.id]);
  assert.deepEqual(
    sim.step([]).filter((e) => e.type === 'reaction').map((e) => e.enemyId),
    [target.id, second.id],
  );
});

test('a status that expires on the very tick of the hit still reacts; one that expired a tick earlier does not', () => {
  const last = setup();
  applyStatus(last.sim, last.target, 'soaked', last.sim.time);
  run(last.sim, 479);
  assert.ok(last.target.statuses.soaked, 'present at the start of tick 479');
  assert.ok(triggerReaction(last.sim, last.target, 'fire', 10, last.sim.time), 'reacts on the tick it expires');
  const late = setup();
  applyStatus(late.sim, late.target, 'soaked', late.sim.time);
  run(late.sim, 480);
  assert.equal(triggerReaction(late.sim, late.target, 'fire', 10, late.sim.time), null);
  assert.ok(TICK > 0);
});

test('marks leave the snapshot when they run out', () => {
  const { sim, target } = setup();
  applyStatus(sim, target, 'soaked', sim.time);
  triggerReaction(sim, target, 'fire', 10, sim.time);
  assert.deepEqual(sim.snapshot().enemies[0].marks, ['blind']);
  run(sim, 200);
  assert.deepEqual(sim.snapshot().enemies[0].marks, []);
});
