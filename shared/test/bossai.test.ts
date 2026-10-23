import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { idle, makeSim } from './helpers.ts';
import type { Sim } from '../src/sim/sim.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });

function fight(boss: string, playerZ: number, minions = 0) {
  const sim = makeSim();
  sim.god = true;
  sim.player.pos = { x: 0, y: 0, z: playerZ };
  const e = spawnEnemy(sim, boss, at(0, 0));
  for (let k = 0; k < minions; k++) spawnEnemy(sim, 'enemy.stump', at(14 + k, -14)).summoned = true;
  return { sim, e };
}

/** Runs until the boss starts an attack and returns its id (null when it never does within `seconds`). */
function firstAttack(sim: Sim, e: EnemyState, seconds = 12): string | null {
  for (let i = 0; i < seconds * 60; i++) {
    sim.step([idle()]);
    if (e.attack) return e.attack.attackId;
  }
  return null;
}

/** Every attack the boss starts in `seconds`, with the player standing still. */
function usedIn(sim: Sim, e: EnemyState, seconds: number): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < seconds * 60; i++) {
    sim.step([idle()]);
    if (e.attack) used.add(e.attack.attackId);
  }
  return used;
}

test('the reaper throws its wave when the player is far', () => {
  const { sim, e } = fight('boss.reaper', 16);
  assert.equal(firstAttack(sim, e), 'atk.reaper_wave');
});

test('the reaper stamps its spikes at mid range and swings the scythe up close', () => {
  const mid = fight('boss.reaper', 6);
  assert.equal(firstAttack(mid.sim, mid.e), 'atk.reaper_spikes');
  const near = fight('boss.reaper', 2);
  assert.equal(firstAttack(near.sim, near.e), 'atk.reaper_scythe');
});

test('the Maw calls minions when it has few, and charges at mid range when it has enough', () => {
  const few = fight('boss.maw', 7, 0);
  assert.equal(firstAttack(few.sim, few.e), 'atk.maw_summon');
  const many = fight('boss.maw', 7, 3);
  assert.equal(firstAttack(many.sim, many.e), 'atk.maw_charge');
});

test('the Maw slams up close and claws once the slam is cooling down', () => {
  const { sim, e } = fight('boss.maw', 2, 3);
  assert.equal(firstAttack(sim, e), 'atk.maw_slam');
  const used = usedIn(sim, e, 6);
  assert.ok(used.has('atk.maw_claw'), `claw used while the slam cools (${[...used]})`);
});

test('in one long fight every attack of the Maw and of the reaper is used', () => {
  for (const [boss, all] of [
    ['boss.maw', ['atk.maw_claw', 'atk.maw_slam', 'atk.maw_charge', 'atk.maw_summon']],
    ['boss.reaper', ['atk.reaper_scythe', 'atk.reaper_wave', 'atk.reaper_spikes']],
  ] as const) {
    const { sim, e } = fight(boss, 14);
    const used = usedIn(sim, e, 90);
    for (const a of all) assert.ok(used.has(a), `${boss} used ${a} (${[...used]})`);
  }
});

test('mobs with melee attacks only behave as before: a zombie still just claws', () => {
  const { sim, e } = fight('enemy.zombie', 5);
  assert.match(firstAttack(sim, e)!, /zombie_claw/);
});
