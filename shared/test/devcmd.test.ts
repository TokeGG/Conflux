import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDevCommand, installDevCommands } from '../src/sim/devcmd.ts';
import { SimRunner } from '../src/bridge.ts';
import { TICK } from '../src/sim/sim.ts';
import { castSkill } from '../src/sim/skills.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import type { SimEvent } from '../src/types.ts';
import { idle, input, makeSim, run } from './helpers.ts';

const AHEAD = { x: 0, y: 1.4, z: 30 };

function ticksIn(runner: SimRunner, advances: number, dt = TICK): number {
  const start = runner.sim.tick;
  for (let i = 0; i < advances; i++) runner.advance(dt);
  return runner.sim.tick - start;
}

test('timescale 0.5 halves the ticks per advance, 2 doubles them', () => {
  const full = new SimRunner(makeSim());
  assert.equal(ticksIn(full, 60), 60);
  const half = new SimRunner(makeSim());
  half.command({ op: 'timescale', scale: 0.5 });
  assert.equal(ticksIn(half, 60), 30);
  const double = new SimRunner(makeSim());
  double.command({ op: 'timescale', scale: 2 });
  assert.equal(ticksIn(double, 30), 60);
});

test('a time scale outside 0.1 to 2 is clamped, and junk is ignored', () => {
  const r = new SimRunner(makeSim());
  r.command({ op: 'timescale', scale: 50 });
  assert.equal(ticksIn(r, 30), 60);
  r.command({ op: 'timescale', scale: 'fast' });
  assert.equal(ticksIn(r, 30), 60, 'junk leaves the scale alone');
  r.command({ op: 'timescale', scale: 0 });
  assert.ok(ticksIn(r, 100) >= 9, 'never stops completely');
});

test('pause stops the ticks and step runs exactly one, even with no time passing', () => {
  const r = new SimRunner(makeSim());
  ticksIn(r, 10);
  r.command({ op: 'pause', on: true });
  assert.equal(ticksIn(r, 30), 0);
  r.command({ op: 'step' });
  assert.equal(r.advance(0)?.snapshot.tick, 11);
  r.command({ op: 'step', n: 3 });
  r.advance(0);
  assert.equal(r.sim.tick, 14);
  r.command({ op: 'pause', on: false });
  assert.equal(ticksIn(r, 10), 10);
});

test('spawn adds N enemies at the crosshair', () => {
  const sim = makeSim();
  sim.player.pos = { x: 0, y: 0, z: 0 };
  run(sim, 1, input({ aimYaw: 0, aimPitch: -0.1, camOrigin: { x: 0, y: 1.6, z: 0 } }));
  assert.equal(applyDevCommand(sim, { op: 'spawn', enemy: 'enemy.dummy', count: 3, at: 'crosshair' }), null);
  assert.equal(sim.enemies.length, 3);
  const ground = 1.6 / Math.tan(0.1);
  for (const e of sim.enemies) assert.ok(Math.hypot(e.pos.x, e.pos.z - ground) < 4, `near the crosshair (${e.pos.z})`);
  assert.equal(new Set(sim.enemies.map((e) => `${e.pos.x.toFixed(2)},${e.pos.z.toFixed(2)}`)).size, 3, 'not stacked');
});

test('spawn with the crosshair on the sky puts them a short way ahead of the player', () => {
  const sim = makeSim();
  run(sim, 1, input({ aimPitch: 0.5 }));
  applyDevCommand(sim, { op: 'spawn', enemy: 'enemy.dummy', count: 1, at: 'crosshair' });
  assert.ok(sim.enemies[0].pos.z > 3 && sim.enemies[0].pos.z < 15, `z ${sim.enemies[0].pos.z}`);
});

test('spawn refuses an unknown enemy and a silly count', () => {
  const sim = makeSim();
  assert.match(applyDevCommand(sim, { op: 'spawn', enemy: 'enemy.nope', count: 1 })!, /enemy\.nope/);
  assert.match(applyDevCommand(sim, { op: 'spawn', enemy: 'enemy.dummy', count: 500 })!, /count/);
  assert.equal(sim.enemies.length, 0);
});

test('killAll removes every enemy with an enemy_died event each', () => {
  const sim = makeSim();
  applyDevCommand(sim, { op: 'spawn', enemy: 'enemy.dummy', count: 4 });
  applyDevCommand(sim, { op: 'killAll' });
  assert.equal(sim.enemies.length, 0);
  const died = sim.step([idle()]).filter((e: SimEvent) => e.type === 'enemy_died');
  assert.equal(died.length, 4);
});

test('spawnDummy puts a dummy at the crosshair carrying the chosen status', () => {
  const sim = makeSim();
  applyDevCommand(sim, { op: 'spawnDummy', status: 'soaked' });
  assert.equal(sim.enemies.length, 1);
  assert.ok(sim.enemies[0].statuses.soaked);
  assert.match(applyDevCommand(sim, { op: 'spawnDummy', status: 'frozen' })!, /frozen/);
});

test('god mode makes damage 0 until it is switched off', () => {
  const sim = makeSim();
  applyDevCommand(sim, { op: 'god', on: true });
  assert.equal(sim.hurtPlayer(50), false);
  assert.equal(sim.player.hp, 100);
  applyDevCommand(sim, { op: 'god', on: false });
  assert.equal(sim.hurtPlayer(50), true);
  assert.equal(sim.player.hp, 50);
});

test('noCooldowns lets a skill be cast on consecutive ticks', () => {
  const data = defaultData();
  data.skills['fire.fireball'].cast.windup = 0;
  const sim = makeSim(1, { data });
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, true);
  sim.step([idle()]);
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, false);
  applyDevCommand(sim, { op: 'noCooldowns', on: true });
  sim.step([idle()]);
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, true);
  sim.step([idle()]);
  assert.equal(castSkill(sim, sim.player, 'fire.fireball', AHEAD).ok, true);
});

test('giveSkill puts a skill on its element\'s slot and setElement switches at once', () => {
  const data = defaultData();
  data.skills['fire.spare'] = { ...data.skills['fire.fireball'], id: 'fire.spare' };
  const sim = makeSim(1, { data });
  assert.equal(applyDevCommand(sim, { op: 'giveSkill', skill: 'fire.spare' }), null);
  assert.equal(sim.player.loadout.fire.basic, 'fire.spare');
  assert.match(applyDevCommand(sim, { op: 'giveSkill', skill: 'fire.nothing' })!, /fire\.nothing/);
  sim.player.swapReadyAt = 99;
  applyDevCommand(sim, { op: 'setElement', i: 2 });
  assert.equal(sim.player.element, 2);
  assert.match(applyDevCommand(sim, { op: 'setElement', i: 99 })!, /element/);
});

test('applyStatus lands on the enemy under the crosshair, or on the player when there is none', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 8 });
  run(sim, 1, input({ aimYaw: 0, aimPitch: Math.atan2(0.9 - 1.6, 8), camOrigin: { x: 0, y: 1.6, z: 0 } }));
  applyDevCommand(sim, { op: 'applyStatus', id: 'burning' });
  assert.ok(e.statuses.burning);
  const lone = makeSim();
  applyDevCommand(lone, { op: 'applyStatus', id: 'rocked' });
  assert.ok(lone.player.statuses.rocked);
  assert.match(applyDevCommand(lone, { op: 'applyStatus', id: 'frozen' })!, /frozen/);
});

test('setData swaps in new numbers: a cast uses them and enemies already in the room get them', () => {
  const sim = makeSim();
  const dummy = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 10 });
  const next = defaultData();
  next.skills['fire.fireball'].damage = 50;
  next.enemies['enemy.dummy'].hp = 4000;
  next.enemies['enemy.dummy'].scale = 2;
  assert.equal(applyDevCommand(sim, { op: 'setData', data: next }), null);
  assert.equal(dummy.def.scale, 2);
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  run(sim, 60);
  assert.equal(1000 - dummy.hp, 50);
});

test('setData refuses something that is not game data', () => {
  const sim = makeSim();
  assert.match(applyDevCommand(sim, { op: 'setData', data: { nope: 1 } })!, /data/);
  assert.equal(sim.data.player.health, 100);
});

test('a run that used a dev command that changes the game is flagged tuned; pausing alone is not', () => {
  const a = makeSim();
  const ra = new SimRunner(a);
  installDevCommands(ra, () => makeSim());
  ra.command({ op: 'pause', on: true });
  ra.command({ op: 'timescale', scale: 0.5 });
  ra.command({ op: 'pause', on: false });
  ra.advance(TICK);
  assert.equal(a.tuned, false);
  ra.command({ op: 'god', on: true });
  ra.advance(TICK);
  assert.equal(a.tuned, true);
});

test('restartRoom and setSeed rebuild the sim through the runner', () => {
  const made: number[] = [];
  const r = new SimRunner(makeSim(1));
  installDevCommands(r, (seed) => (made.push(seed), makeSim(seed)));
  const first = r.sim;
  r.command({ op: 'restartRoom' });
  r.advance(TICK);
  assert.notEqual(r.sim, first);
  assert.deepEqual(made, [1]);
  r.command({ op: 'setSeed', seed: 77 });
  r.advance(TICK);
  assert.equal(r.sim.seed, 77);
  assert.deepEqual(made, [1, 77]);
  assert.ok(r.sim.tick <= 1, 'a fresh sim');
});

test('a dev command the runner does not know is ignored without throwing', () => {
  const sim = makeSim();
  assert.match(applyDevCommand(sim, { op: 'explode' })!, /explode/);
  const r = new SimRunner(sim);
  installDevCommands(r, () => makeSim());
  r.command({ op: 'explode' });
  assert.doesNotThrow(() => r.advance(TICK));
});

test('giveAugment sockets an augment for the next cast, refuses a full skill and unknown ids', () => {
  const sim = makeSim();
  assert.equal(applyDevCommand(sim, { op: 'giveAugment', id: 'aug.hot_hands', rarity: 'epic' }), null);
  assert.deepEqual(sim.augments, [{ id: 'aug.hot_hands', rarity: 'epic', skill: 'fire.fireball' }]);
  assert.equal(sim.skill('fire.fireball')!.damage, 21);
  assert.equal(sim.tuned, true);
  applyDevCommand(sim, { op: 'giveAugment', id: 'aug.hot_hands', rarity: 'common' });
  applyDevCommand(sim, { op: 'giveAugment', id: 'aug.hot_hands', rarity: 'common' });
  assert.match(applyDevCommand(sim, { op: 'giveAugment', id: 'aug.hot_hands', rarity: 'rare' })!, /socket/i);
  assert.match(applyDevCommand(sim, { op: 'giveAugment', id: 'aug.nothing', rarity: 'rare' })!, /aug\.nothing/);
  assert.match(applyDevCommand(sim, { op: 'giveAugment', id: 'aug.wide_cone', rarity: 'mythic' })!, /rarity/);
});

test('teleport puts the player on the floor at the point, marks the run tuned, and refuses a point that is not a number', () => {
  const sim = makeSim();
  assert.equal(applyDevCommand(sim, { op: 'teleport', x: 3, z: -4 }), null);
  assert.deepEqual([sim.player.pos.x, sim.player.pos.y, sim.player.pos.z], [3, 0, -4]);
  assert.equal(sim.tuned, true);
  const other = makeSim();
  assert.match(applyDevCommand(other, { op: 'teleport', x: 'a', z: 1 }) ?? '', /teleport/);
  assert.equal(other.tuned, false);
});
