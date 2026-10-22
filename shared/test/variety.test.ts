import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENDLESS, planRoomAt } from '../src/run/endless.ts';
import { chooseDoor } from '../src/run/roomToRoom.ts';
import { generateRoom } from '../src/gen/generate.ts';
import { isSolvable } from '../src/gen/reach.ts';
import { defaultData } from '../src/files.ts';
import type { RunState } from '../src/run/run.ts';

const data = defaultData();
const normal = Object.values(data.themes).filter((t) => !t.boss);

/** The first n rooms when the gate is picked by a rule. */
function walk(seed: number, n: number, pick: (s: RunState, gates: number) => number = () => 0): RunState[] {
  let s = ENDLESS.start(seed, data);
  const out = [s];
  for (let i = 1; i < n; i++) {
    const choices = ENDLESS.nextChoices(s);
    s = chooseDoor(ENDLESS.onRoomCleared(s), choices[pick(s, choices.length) % choices.length]);
    out.push(s);
  }
  return out;
}

test('there are at least ten room styles, plus an arena for bosses', () => {
  assert.ok(normal.length >= 10, `${normal.length} styles`);
  assert.ok(Object.values(data.themes).some((t) => t.boss && t.boss.length > 0), 'a boss arena');
  for (const id of ['cellar', 'prison', 'grove', 'bonepit', 'chapel', 'library']) assert.ok(data.themes[id], id);
});

test('no two styles look the same: their floor textures differ or their tints do', () => {
  const key = (t: (typeof normal)[number]) => `${t.floor.tex.join()}|${t.wall.tex.join()}|${t.tint}`;
  assert.equal(new Set(normal.map(key)).size, normal.length);
});

test('every style (and the arena) makes solvable rooms with enemies on 30 seeds', () => {
  for (const t of Object.values(data.themes)) {
    for (let seed = 1; seed <= 30; seed++) {
      const { room } = generateRoom(data, seed, 1, seed, t.id);
      assert.ok(isSolvable(room), `${t.id} seed ${seed}`);
      assert.ok(room.spawns.enemies.length >= 5, `${t.id} seed ${seed} spots`);
    }
  }
});

test('walking 25 rooms shows at least 8 different styles, and a room is never the style of the room before', () => {
  for (const seed of [1, 2, 3]) {
    const rooms = walk(seed, 25);
    const themes = rooms.map((s) => s.current.biome);
    assert.ok(new Set(themes).size >= 8, `seed ${seed}: ${[...new Set(themes)].join(',')}`);
    for (let i = 1; i < themes.length; i++) assert.notEqual(themes[i], themes[i - 1], `seed ${seed} room ${i}`);
  }
});

test('the gates of a room lead to different styles, none the style of the room itself', () => {
  for (const s of walk(7, 20)) {
    if ((s.roomIndex + 1) % 5 === 4) continue; // every gate before a boss leads to the one arena
    const choices = ENDLESS.nextChoices(s);
    const themes = choices.map((c) => c.room.biome);
    assert.equal(new Set(themes).size, themes.length, `room ${s.roomIndex}: ${themes.join(',')}`);
    assert.ok(!themes.includes(s.current.biome), `room ${s.roomIndex}`);
  }
});

test('every fifth room is a boss room in the arena with a boss, and no other room has one', () => {
  for (const s of walk(4, 22)) {
    const boss = s.current.enemies.filter((e) => e.enemyId.startsWith('boss.'));
    if (s.roomIndex % 5 === 4) {
      assert.equal(s.current.type, 'boss', `room ${s.roomIndex}`);
      assert.equal(boss.length, 1);
      assert.ok(data.themes[s.current.biome].boss, 'the arena');
    } else {
      assert.equal(boss.length, 0, `room ${s.roomIndex}`);
      assert.notEqual(s.current.type, 'boss');
    }
  }
});

test('a plan is still a pure function of its inputs, avoid list included', () => {
  assert.deepEqual(planRoomAt(data, 9, 1, 3, 1, ['crypt']), planRoomAt(data, 9, 1, 3, 1, ['crypt']));
  assert.notEqual(planRoomAt(data, 9, 1, 3, 1, ['crypt']).biome, 'crypt');
});
