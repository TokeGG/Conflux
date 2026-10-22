import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData } from '../src/files.ts';
import { RunDirector, createRunRoomSim } from '../src/run/director.ts';
import { ENDLESS, planRoomAt, roomKindAt } from '../src/run/endless.ts';
import { ROOMS_PER_FLOOR, depthAt, floorRoomAt, hasStairs, isLandingRoom } from '../src/run/floors.ts';
import { emptyLedger } from '../src/run/unlocks.ts';
import { chooseDoor } from '../src/run/roomToRoom.ts';
import { damageEnemy } from '../src/sim/skills.ts';
import { soulsFor } from '../src/sim/souls.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { isQuiet, type RunState } from '../src/run/run.ts';
import { isSolvable } from '../src/gen/reach.ts';
import { World } from '../src/world.ts';
import { makeSim, run as runTicks } from './helpers.ts';

const data = defaultData();

// ---- souls ----

test('every enemy has a soul value in data, bosses and elites more, the dummy none', () => {
  for (const [id, e] of Object.entries(data.enemies)) assert.ok(typeof e.souls === 'number' && e.souls >= 0, id);
  assert.equal(data.enemies['enemy.dummy'].souls, 0);
  assert.ok(data.enemies['boss.reaper'].souls! > data.enemies['enemy.bone_giant'].souls!);
  assert.ok(data.enemies['enemy.bone_giant'].souls! > data.enemies['enemy.skeleton'].souls!);
});

test('a dying enemy leaves its souls where it fell, and an elite leaves more', () => {
  const sim = makeSim(1);
  sim.player.pos = { x: 30, y: 0, z: 30 };
  const plain = spawnEnemy(sim, 'enemy.skeleton', { x: 5, y: 0, z: 5 });
  const elite = spawnEnemy(sim, 'enemy.skeleton', { x: -5, y: 0, z: 5 });
  elite.elite = 'haste';
  assert.equal(soulsFor(sim, plain), data.enemies['enemy.skeleton'].souls);
  assert.equal(soulsFor(sim, elite), data.enemies['enemy.skeleton'].souls! * data.rewards.economy.eliteSoulsMul);
  damageEnemy(sim, plain, 1e6, 'test', plain.pos);
  assert.equal(sim.pickups.length, 1);
  assert.deepEqual({ x: sim.pickups[0].pos.x, z: sim.pickups[0].pos.z, v: sim.pickups[0].value }, { x: 5, z: 5, v: soulsFor(sim, plain) });
  const events = runTicks(sim, 1);
  assert.ok(events.every((e) => e.type !== 'soul_collected'), 'far away: not collected');
  assert.equal(sim.snapshot().pickups.length, 1, 'the snapshot shows it');
});

test('an enemy made by a summon is worth no souls', () => {
  const sim = makeSim(1);
  const e = spawnEnemy(sim, 'enemy.skeleton', { x: 0, y: 0, z: 0 });
  e.summoned = true;
  assert.equal(soulsFor(sim, e), 0);
  damageEnemy(sim, e, 1e6, 'test', e.pos);
  assert.equal(sim.pickups.length, 0);
});

test('walking within the pickup radius collects a soul; outside it stays', () => {
  const sim = makeSim(1);
  sim.player.pos = { x: 0, y: 0, z: 0 };
  const r = data.rewards.economy.pickupRadius;
  sim.pickups.push({ id: 900, pos: { x: r + 1, y: 0, z: 0 }, value: 7 }, { id: 901, pos: { x: r - 0.5, y: 0, z: 0 }, value: 3 });
  const events = runTicks(sim, 1);
  const got = events.filter((e) => e.type === 'soul_collected');
  assert.deepEqual(got.map((e) => e.value), [3]);
  assert.deepEqual(sim.pickups.map((k) => k.id), [900]);
});

test('when the room is cleared every soul left flies to the player', () => {
  const sim = makeSim(1);
  sim.player.pos = { x: 0, y: 0, z: 0 };
  sim.pickups.push({ id: 900, pos: { x: 40, y: 0, z: 40 }, value: 7 });
  sim.roomCleared = true;
  const got = runTicks(sim, 1).filter((e) => e.type === 'soul_collected');
  assert.equal(got.length, 1);
  assert.equal(sim.pickups.length, 0);
});

test('the director adds up the souls collected, in any phase, and keeps them from room to room', () => {
  const d = new RunDirector(data, 1, emptyLedger(), false, ENDLESS);
  assert.equal(d.run.souls, 0);
  d.onEvents([{ type: 'soul_collected', value: 5, t: 0 }, { type: 'soul_collected', value: 8, t: 0 }]);
  assert.equal(d.run.souls, 13);
  assert.equal(d.run.soulsEarned, 13);
  // the room is cleared in the same batch as a last soul: the soul still counts
  d.onEvents([{ type: 'soul_collected', value: 2, t: 0 }, { type: 'room_cleared', t: 0 }]);
  assert.equal(d.run.souls, 15);
  assert.equal(d.phase, 'doors');
  d.onEvents([{ type: 'soul_collected', value: 1, t: 0 }]);
  assert.equal(d.run.souls, 16);
  d.enter(0);
  d.pick(0);
  assert.equal(d.run.souls, 16, 'souls carry into the next room');
});

test('souls start at 0 with every run', () => {
  const a = new RunDirector(data, 1, emptyLedger(), false, ENDLESS);
  a.onEvents([{ type: 'soul_collected', value: 50, t: 0 }]);
  const b = new RunDirector(data, 1, emptyLedger(), false, ENDLESS);
  assert.equal(b.run.souls, 0);
  assert.equal(b.run.soulsEarned, 0);
});

// ---- floors ----

test('a floor is eight rooms and the depth rises by one on each', () => {
  assert.equal(ROOMS_PER_FLOOR, 8);
  assert.deepEqual([0, 7, 8, 15, 16].map(depthAt), [1, 1, 2, 2, 3]);
  assert.deepEqual([0, 7, 8].map(floorRoomAt), [1, 8, 1]);
  assert.deepEqual([6, 7, 8].map(hasStairs), [false, true, false]);
});

/** The first rooms when the first gate is always taken (or `gate` when it exists). */
function walk(seed: number, n: number, gate = 0): RunState[] {
  let s = ENDLESS.start(seed, data);
  const out = [s];
  for (let i = 1; i < n; i++) {
    const choices = ENDLESS.nextChoices(s);
    s = chooseDoor(ENDLESS.onRoomCleared(s), choices[Math.min(gate, choices.length - 1)]);
    out.push(s);
  }
  return out;
}

test('the last room of every floor has the stairs, and the gates out of it go down a depth', () => {
  for (const s of walk(4, 34)) {
    assert.equal(!!s.current.stairs, hasStairs(s.roomIndex), `room ${s.roomIndex}`);
    for (const c of ENDLESS.nextChoices(s)) assert.equal(!!c.descends, hasStairs(s.roomIndex), `gate out of room ${s.roomIndex}`);
  }
  const first = walk(4, 9)[8];
  assert.equal(depthAt(first.roomIndex), 2);
});

test('the depth opens the styles by minDepth', () => {
  for (const s of walk(9, 20)) {
    const theme = data.themes[s.current.biome];
    assert.ok(theme.minDepth <= depthAt(s.roomIndex) || theme.boss, `${theme.id} at depth ${depthAt(s.roomIndex)}`);
  }
});

test('bosses stay every fifth room', () => {
  for (const s of walk(6, 25)) assert.equal(s.current.type === 'boss', s.roomIndex % 5 === 4, `room ${s.roomIndex}`);
});

// ---- quiet rooms ----

test('every floor has a landing with a shop, a shrine and a rest room behind its gates', () => {
  for (let floor = 0; floor < 6; floor++) {
    const landing = Array.from({ length: ROOMS_PER_FLOOR }, (_, k) => floor * ROOMS_PER_FLOOR + k).filter(isLandingRoom);
    assert.equal(landing.length, 1, `floor ${floor + 1} has one landing`);
    assert.deepEqual([0, 1, 2].map((g) => roomKindAt(3, landing[0], g)), ['shop', 'shrine', 'rest']);
  }
});

test('the first gate of an ordinary room is always a fight, so a fight is always on offer', () => {
  for (let seed = 1; seed <= 20; seed++) for (let i = 1; i < 40; i++) if (!isLandingRoom(i)) assert.ok(!isQuiet(roomKindAt(seed, i, 0)), `seed ${seed} room ${i}`);
});

test('some ordinary rooms have a quiet room behind another gate', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) for (let i = 1; i < 40; i++) if (!isLandingRoom(i)) for (const g of [1, 2]) kinds.add(roomKindAt(seed, i, g));
  for (const k of ['combat', 'shop', 'shrine', 'rest']) assert.ok(kinds.has(k), k);
});

test('a quiet room has no enemies, a keeper at a shop, free stalls and an unbroken way to every gate', () => {
  for (const [gate, kind] of [[0, 'shop'], [1, 'shrine'], [2, 'rest']] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const plan = planRoomAt(data, seed, 1, 6, gate);
      assert.equal(plan.type, kind);
      assert.equal(plan.enemies.length, 0);
      assert.equal(plan.budget, 0);
      assert.equal(!!plan.keeper, kind === 'shop');
      assert.equal(plan.stalls!.length, { shop: 4, shrine: 3, rest: 1 }[kind]);
      assert.ok(isSolvable(plan.def!));
      const world = new World(plan.def!.colliders, 0);
      for (const p of [plan.keeper, ...plan.stalls!].filter(Boolean)) assert.ok(!world.blocked({ x: p!.x, y: 0, z: p!.z }, 0.5), 'on open floor');
      for (let a = 0; a < plan.stalls!.length; a++) for (let b = a + 1; b < plan.stalls!.length; b++) assert.ok(Math.hypot(plan.stalls![a].x - plan.stalls![b].x, plan.stalls![a].z - plan.stalls![b].z) > 1.2, 'stalls apart');
    }
  }
});

test('in a quiet room the gates are open at once: walking into one emits door_entered', () => {
  const s = ENDLESS.start(2, data);
  const plan = planRoomAt(data, 2, 1, 6, 0);
  const run: RunState = { ...s, roomIndex: 6, current: plan };
  const sim = createRunRoomSim(run, data);
  assert.equal(sim.roomCleared, true);
  assert.equal(sim.enemies.length, 0);
  sim.player.pos = { x: sim.doors[0].x + 0.2, y: 0, z: sim.doors[0].z };
  assert.ok(runTicks(sim, 2).some((e) => e.type === 'door_entered'));
  // a fight room starts closed
  assert.equal(createRunRoomSim(s, data).roomCleared, false);
});

test('the same seed gives the same quiet rooms', () => {
  assert.deepEqual(planRoomAt(data, 5, 1, 6, 0), planRoomAt(data, 5, 1, 6, 0));
  assert.notDeepEqual(planRoomAt(data, 5, 1, 6, 0).stalls, planRoomAt(data, 6, 1, 6, 0).stalls);
});

// ---- the director's flow ----

/** A director on the way into the landing: the fight rooms are skipped by setting the run up by hand. */
function atLanding(from: number, gate: number): RunDirector {
  // a seed whose room before the landing has enough gates to take the one asked for
  let seed = from;
  while (planRoomAt(data, seed, 1, 5, 0).def!.spawns.doors.length <= gate) seed++;
  const d = new RunDirector(data, seed, emptyLedger(), false, ENDLESS);
  d.run = { ...d.run, roomIndex: 5, current: planRoomAt(data, seed, 1, 5, 0), souls: 500, soulsEarned: 500 };
  d.onEvents([{ type: 'room_cleared', t: 0 }]);
  assert.equal(d.phase, 'doors');
  d.enter(gate);
  return d;
}

test('entering a shop after a fight shows the reward first, then the shop with its gates open', () => {
  const d = atLanding(3, 0);
  assert.equal(d.run.current.type, 'shop');
  assert.equal(d.phase, 'reward', 'the reward of the room just cleared waits at the entrance');
  d.pick(d.offers.findIndex((o) => o.kind !== 'element'));
  assert.equal(d.phase, 'doors');
  assert.ok(d.run.quiet && d.run.quiet.kind === 'shop');
  assert.ok(d.doors.length >= 1, 'the gates out are known');
  const i = d.run.quiet!.wares.findIndex((w) => w.kind === 'augment');
  const before = d.run.souls;
  const res = d.buy(i, undefined, d.run.current.stalls![i]);
  assert.ok(res.ok, res.reason);
  assert.equal(d.run.souls, before - d.run.quiet!.wares[i].price);
  // leaving: the next room is a normal one and the shop's stock is gone
  let entered = -1;
  d.onEnter = (plan) => (entered = plan.index);
  d.onEvents([{ type: 'door_entered', door: 0, t: 0 }]);
  assert.equal(entered, 7);
  assert.equal(d.run.quiet, null);
});

test('a quiet room entered from another quiet room has no reward and is stocked at once', () => {
  const d = atLanding(3, 1);
  d.pick(d.offers.findIndex((o) => o.kind !== 'element'));
  assert.equal(d.run.current.type, 'shrine');
  assert.equal(d.phase, 'doors');
  assert.equal(d.run.quiet!.kind, 'shrine');
  const next = d.enter(0);
  assert.equal(next.index, 7);
  assert.ok(next.stairs, 'the room after the landing has the stairs');
  assert.equal(d.phase, 'fighting');
});

test('buying is refused outside a quiet room', () => {
  const d = new RunDirector(data, 1, emptyLedger(), false, ENDLESS);
  assert.ok(!d.buy(0).ok);
});
