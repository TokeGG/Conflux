import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botInput, chooseElement } from '../src/bot.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import { makeStreams } from '../src/rng.ts';
import type { Sim } from '../src/sim/sim.ts';

const MIX = ['enemy.stump', 'enemy.treefellow', 'enemy.golem_fire', 'enemy.fire_sprite'];

/** The mixed room of the milestone: a stump, a treefellow, a golem and a fire sprite on the room's enemy spawns, shuffled by seed. */
function mixedRoom(seed: number): Sim {
  const data = defaultData();
  const sim = createRoomSim(data, seed, 'forest_clearing');
  const spots = [...data.rooms.forest_clearing.spawns.enemies];
  const rng = makeStreams(seed).encounter;
  for (const id of MIX) {
    const [spot] = spots.splice(rng.int(spots.length), 1);
    spawnEnemy(sim, id, { x: spot.x, y: 0, z: spot.z });
  }
  return sim;
}

/** Plays the room with the bot for up to 90 simulated seconds. */
function fight(seed: number): { won: boolean; alive: boolean; seconds: number; hp: number } {
  const sim = mixedRoom(seed);
  for (let i = 0; i < 90 * 60; i++) {
    sim.step([botInput(sim)]);
    if (sim.enemies.length === 0 || sim.player.hp <= 0) break;
  }
  return { won: sim.enemies.length === 0, alive: sim.player.hp > 0, seconds: sim.time, hp: sim.player.hp };
}

test('the scripted player clears the mixed room within 90 seconds on 10 seeds and survives at least 8 times', () => {
  const results = Array.from({ length: 10 }, (_, seed) => fight(seed + 1));
  const summary = results.map((r) => `${r.won ? 'won' : 'LOST'} ${r.seconds.toFixed(0)}s hp ${r.hp.toFixed(0)}`).join('; ');
  assert.ok(results.every((r) => r.won), `every room is cleared: ${summary}`);
  assert.ok(results.filter((r) => r.alive).length >= 8, `at least 8 survive: ${summary}`);
});

test('the room announces it is cleared exactly once when the last enemy dies', () => {
  const sim = mixedRoom(3);
  let cleared = 0;
  for (let i = 0; i < 90 * 60 && sim.enemies.length > 0 && sim.player.hp > 0; i++) cleared += sim.step([botInput(sim)]).filter((e) => e.type === 'room_cleared').length;
  for (let i = 0; i < 120; i++) cleared += sim.step([botInput(sim)]).filter((e) => e.type === 'room_cleared').length;
  assert.equal(cleared, sim.enemies.length === 0 ? 1 : 0);
});

test('chooseElement picks an element the target is weak to when there is a skill for it', () => {
  const sim = createRoomSim(defaultData(), 1, 'forest_clearing');
  sim.player.equipped = ['fire', 'water', 'wind'];
  spawnEnemy(sim, 'enemy.golem_fire', { x: 0, y: 0, z: sim.player.pos.z + 8 });
  assert.equal(chooseElement(sim), 1, 'water beats the fire golem');
  sim.enemies.length = 0;
  spawnEnemy(sim, 'enemy.treefellow', { x: 0, y: 0, z: sim.player.pos.z + 8 });
  assert.equal(chooseElement(sim), 3, 'wind beats the earth treefellow');
});

test('chooseElement avoids an element the target resists and the one that cannot hurt a boss', () => {
  const sim = createRoomSim(defaultData(), 1, 'forest_clearing');
  spawnEnemy(sim, 'boss.reaper', { x: 0, y: 0, z: sim.player.pos.z + 8 });
  const pick = chooseElement(sim);
  assert.ok([1, 3].includes(pick), `water or wind for the reaper (${pick})`);
});

test('with nothing to fight the bot keeps the element it has', () => {
  const sim = createRoomSim(defaultData(), 1, 'forest_clearing');
  sim.player.element = 2;
  assert.equal(chooseElement(sim), 2);
});
