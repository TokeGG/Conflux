import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENDLESS, planRoomAt } from '../src/run/endless.ts';
import { chooseDoor } from '../src/run/roomToRoom.ts';
import { defaultData } from '../src/files.ts';
import { unlockedPool, emptyLedger } from '../src/run/unlocks.ts';
import { offerRewards } from '../src/run/rewards.ts';
import { makeStreams } from '../src/rng.ts';
import type { RunState } from '../src/run/run.ts';

const data = defaultData();

/** The first twenty rooms when the first gate is always taken. */
function walk(seed: number, n = 20): RunState[] {
  let s = ENDLESS.start(seed, data);
  const out = [s];
  for (let i = 1; i < n; i++) {
    s = chooseDoor(ENDLESS.onRoomCleared(s), ENDLESS.nextChoices(s)[0]);
    out.push(s);
  }
  return out;
}

test('the same seed gives the same first 20 rooms, enemies and themes included', () => {
  assert.deepEqual(walk(42).map((s) => s.current), walk(42).map((s) => s.current));
  assert.notDeepEqual(walk(42).map((s) => s.current.roomId), walk(43).map((s) => s.current.roomId));
});

test('every gate of a room has a door choice and a planned next room with its own generated room', () => {
  for (const s of walk(7, 10)) {
    const gates = s.current.def!.spawns.doors.length;
    const choices = ENDLESS.nextChoices(s);
    assert.equal(choices.length, gates);
    for (const c of choices) assert.ok(c.room.def && c.room.enemies.length > 0 && c.room.index === s.roomIndex + 1);
  }
  const ids = ENDLESS.nextChoices(ENDLESS.start(7, data)).map((c) => c.room.roomId);
  assert.equal(new Set(ids).size, ids.length, 'two gates lead to two different rooms');
});

test('the enemy budget never exceeds 12 + 5 * index except for the one forced enemy, and each enemy is one of the theme\'s mobs', () => {
  for (const s of walk(11, 20)) {
    const cost = s.current.enemies.reduce((n, e) => n + data.enemies[e.enemyId].cost, 0);
    const cheapest = Math.min(...Object.keys(data.themes[s.current.biome].mobs).map((m) => data.enemies[m].cost));
    assert.ok(cost <= 12 + 5 * s.current.index || s.current.enemies.length === 1, `room ${s.current.index} costs ${cost}`);
    for (const e of s.current.enemies) assert.ok(s.current.biome in data.themes && (e.enemyId in data.themes[s.current.biome].mobs || data.themes[s.current.biome].boss?.includes(e.enemyId)));
    assert.ok(cheapest > 0);
  }
});

test('every third room from the third is an elite room with one modified enemy', () => {
  for (const s of walk(5, 12)) {
    const elites = s.current.enemies.filter((e) => e.elite);
    if (s.current.index % 3 === 2) assert.equal(elites.length, 1, `room ${s.current.index}`);
    else assert.equal(elites.length, 0);
  }
});

test('the run never ends in victory: clearing a room only moves on', () => {
  let s = ENDLESS.start(3, data);
  for (let i = 0; i < 30; i++) s = chooseDoor(ENDLESS.onRoomCleared(s), ENDLESS.nextChoices(s)[0]);
  assert.equal(s.status, 'running');
  assert.equal(s.roomIndex, 30);
});

test('locked content still never appears: not in the starting loadout and not in any offer', () => {
  const pool = unlockedPool(emptyLedger(), data);
  for (let seed = 1; seed <= 15; seed++) {
    const s = { ...ENDLESS.start(seed, data, false, pool), roomIndex: 3 };
    for (const id of s.skills.pool) assert.ok(pool.skills.has(id), id);
    for (const o of offerRewards(s, data, makeStreams(seed).reward.fork('x'))) assert.ok(!['water.slip_dash', 'aug.heavy_boulder'].includes(o.id ?? ''));
  }
});

test('planRoomAt is a pure function of its inputs', () => {
  assert.deepEqual(planRoomAt(data, 9, 1, 4), planRoomAt(data, 9, 1, 4));
  assert.equal(planRoomAt(data, 9, 1, 4).def!.id, planRoomAt(data, 9, 1, 4).roomId);
});

test('no single enemy costs more than half the budget (at least 4): the big ones come in later rooms', () => {
  for (const s of walk(21, 25)) for (const e of s.current.enemies) assert.ok(data.enemies[e.enemyId].cost <= Math.max(4, s.current.budget * 0.5), `${e.enemyId} in room ${s.current.index}`);
  assert.ok(!walk(21, 1)[0].current.enemies.some((e) => e.enemyId === 'enemy.bone_giant'));
});
