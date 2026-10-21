import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_TO_ROOM, planRun, chooseDoor } from '../src/run/roomToRoom.ts';
import { encounterFor } from '../src/run/encounters.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { Rng } from '../src/rng.ts';
import type { EnemyDef } from '../src/types.ts';
import type { RoomPlan } from '../src/run/run.ts';

const data = defaultData();
const cost = (p: RoomPlan) => p.enemies.reduce((s, e) => s + data.enemies[e.enemyId].cost, 0);
const signature = (p: RoomPlan) => `${p.roomId}|${p.enemies.map((e) => e.enemyId).sort().join(',')}`;

test('the shipped data still validates with the two biomes', () => {
  assert.deepEqual(validateData(data), []);
  assert.ok(data.biomes.forest && data.biomes.dungeon);
});

test('the same seed gives the same plan of eight rooms and a boss, encounters included', () => {
  const a = planRun(ROOM_TO_ROOM, 42, data);
  const b = planRun(ROOM_TO_ROOM, 42, data);
  assert.equal(a.length, 9);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((p) => p.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('the plan runs through the forest, then the dungeon, then the boss', () => {
  const plan = planRun(ROOM_TO_ROOM, 7, data);
  assert.deepEqual(plan.slice(0, 4).map((p) => p.biome), ['forest', 'forest', 'forest', 'forest']);
  assert.deepEqual(plan.slice(4, 8).map((p) => p.biome), ['dungeon', 'dungeon', 'dungeon', 'dungeon']);
  assert.equal(plan[8].type, 'boss');
  assert.ok(plan.slice(0, 8).every((p) => p.type !== 'boss'));
});

test('the budget is 8 + 3 x the room index, and no encounter over 200 seeds costs more than its budget', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const p of planRun(ROOM_TO_ROOM, seed, data).slice(0, 8)) {
      assert.equal(p.budget, 8 + 3 * p.index, `budget of room ${p.index}`);
      assert.ok(cost(p) <= p.budget, `seed ${seed} room ${p.index}: cost ${cost(p)} > ${p.budget}`);
      assert.ok(p.enemies.length > 0);
    }
  }
});

test('an encounter is never empty, even when the budget is below the cheapest enemy: it spawns the cheapest one', () => {
  const mk = (id: string, c: number): EnemyDef => ({ ...structuredClone(data.enemies['enemy.stump']), id, cost: c });
  const enemies = { 'enemy.a': mk('enemy.a', 5), 'enemy.b': mk('enemy.b', 9) };
  const biome = { ...data.biomes.forest, enemyPool: ['enemy.a', 'enemy.b'] };
  for (const budget of [0, 1, 2, 4.9]) {
    const e = encounterFor(budget, biome, enemies, new Rng(1));
    assert.deepEqual(e.map((x) => x.enemyId), ['enemy.a'], `budget ${budget}`);
  }
  assert.ok(encounterFor(100, biome, enemies, new Rng(1)).length > 1);
});

test('encounterFor spends the budget well: it uses most of it when the pool allows', () => {
  let spent = 0;
  let total = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const e = encounterFor(20, data.biomes.forest, data.enemies, new Rng(seed));
    spent += e.reduce((s, x) => s + data.enemies[x.enemyId].cost, 0);
    total += 20;
  }
  assert.ok(spent / total > 0.8, `${((spent / total) * 100).toFixed(0)}% of the budget used`);
});

test('encounter positions come from the given spawn points, or a ring when there are none', () => {
  const spots = [{ x: 5, y: 0, z: 5 }, { x: -5, y: 0, z: 5 }];
  const e = encounterFor(30, data.biomes.forest, data.enemies, new Rng(3), spots);
  for (const x of e) assert.ok(spots.some((s) => Math.hypot(s.x - x.at.x, s.z - x.at.z) < 2), 'near a spawn point');
  const ring = encounterFor(30, data.biomes.forest, data.enemies, new Rng(3));
  assert.ok(ring.every((x) => Number.isFinite(x.at.x) && Number.isFinite(x.at.z)));
});

test('the last room is the boss and carries a boss enemy from the biome\'s list', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const boss = planRun(ROOM_TO_ROOM, seed, data)[8];
    assert.equal(boss.type, 'boss');
    assert.ok(boss.enemies.some((e) => data.biomes.dungeon.bosses!.includes(e.enemyId)), `seed ${seed}`);
  }
});

test('two different seeds differ in at least one of rooms 1 to 3 (room, enemy mix or reward) for at least 95 of 100 pairs', () => {
  const sig = (seed: number) => {
    const state0 = ROOM_TO_ROOM.start(seed, data);
    let state = state0;
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const door = ROOM_TO_ROOM.nextChoices(state)[0];
      out.push(`${signature(door.room)}|${door.reward}`);
      state = chooseDoor(state, door);
    }
    return out.join('#');
  };
  let differ = 0;
  for (let i = 0; i < 100; i++) if (sig(1000 + i) !== sig(5000 + i * 7)) differ++;
  assert.ok(differ >= 95, `${differ} of 100 pairs differ`);
});

test('nextChoices offers 2 or 3 doors, each with a reward kind and a biome', () => {
  const sizes = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    let state = ROOM_TO_ROOM.start(seed, data);
    for (let i = 0; i < 7; i++) {
      const doors = ROOM_TO_ROOM.nextChoices(state);
      sizes.add(doors.length);
      assert.ok(doors.length === 2 || doors.length === 3, `${doors.length} doors`);
      for (const d of doors) {
        assert.ok(['skill', 'augment', 'heal'].includes(d.reward));
        assert.ok(d.biome === d.room.biome && data.biomes[d.biome]);
      }
      state = chooseDoor(state, doors[seed % doors.length]);
    }
  }
  assert.deepEqual([...sizes].sort(), [2, 3], 'both sizes occur');
});

test('a skill offer is guaranteed by room 3: some door among rooms 1 to 3 shows a skill', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let state = ROOM_TO_ROOM.start(seed, data);
    let offered = false;
    for (let i = 0; i < 3; i++) {
      const doors = ROOM_TO_ROOM.nextChoices(state);
      offered ||= doors.some((d) => d.reward === 'skill');
      state = chooseDoor(state, doors[0]);
    }
    assert.ok(offered, `seed ${seed} never showed a skill door in rooms 1 to 3`);
  }
});

test('the doors of a room depend only on the seed and the room, not on the way taken', () => {
  const s0 = ROOM_TO_ROOM.start(9, data);
  const viaA = chooseDoor(chooseDoor(s0, ROOM_TO_ROOM.nextChoices(s0)[0]), ROOM_TO_ROOM.nextChoices(chooseDoor(s0, ROOM_TO_ROOM.nextChoices(s0)[0]))[0]);
  const viaB = chooseDoor(chooseDoor(s0, ROOM_TO_ROOM.nextChoices(s0)[1]), ROOM_TO_ROOM.nextChoices(chooseDoor(s0, ROOM_TO_ROOM.nextChoices(s0)[1]))[1]);
  assert.deepEqual(ROOM_TO_ROOM.nextChoices(viaA), ROOM_TO_ROOM.nextChoices(viaB));
});

test('clearing the last ordinary room routes to the boss, and clearing the boss ends the run with a victory', () => {
  let state = ROOM_TO_ROOM.start(11, data);
  for (let i = 0; i < 7; i++) state = chooseDoor(ROOM_TO_ROOM.onRoomCleared(state), ROOM_TO_ROOM.nextChoices(state)[0]);
  assert.equal(state.roomIndex, 7);
  const doors = ROOM_TO_ROOM.nextChoices(ROOM_TO_ROOM.onRoomCleared(state));
  assert.equal(doors.length, 1);
  assert.equal(doors[0].room.type, 'boss');
  state = chooseDoor(ROOM_TO_ROOM.onRoomCleared(state), doors[0]);
  assert.equal(state.roomIndex, 8);
  assert.equal(state.status, 'running');
  const end = ROOM_TO_ROOM.onRoomCleared(state);
  assert.equal(end.status, 'victory');
  assert.deepEqual(ROOM_TO_ROOM.nextChoices(end), []);
});

test('a run starts with the 12 starting skills, no augments and no tuning, and onRoomCleared records history without changing the input', () => {
  const s = ROOM_TO_ROOM.start(5, data);
  assert.equal(s.roomIndex, 0);
  assert.equal(s.roomsTotal, 9);
  assert.equal(s.tuned, false);
  assert.deepEqual(s.augments, []);
  for (const el of ['fire', 'water', 'earth', 'wind'] as const) for (const slot of ['basic', 'secondary', 'utility'] as const) assert.ok(s.skills.slots[el][slot].startsWith(`${el}.`), `${el} ${slot}`);
  const before = JSON.stringify(s);
  const after = ROOM_TO_ROOM.onRoomCleared(s);
  assert.equal(JSON.stringify(s), before, 'the old state is untouched');
  assert.deepEqual(after.history, [s.current.roomId]);
});

test('a run in a tuned game is flagged tuned', () => {
  const tuned = structuredClone(data);
  assert.equal(ROOM_TO_ROOM.start(1, tuned, true).tuned, true);
});
