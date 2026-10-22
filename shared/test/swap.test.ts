import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trySwap, consumeSwapBonus, activeSkillFor } from '../src/sim/swap.ts';
import { castSkill } from '../src/sim/skills.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { defaultData } from '../src/files.ts';
import type { GameData, SkillDef } from '../src/types.ts';
import { BTN, idle, input, makeSim, run } from './helpers.ts';

const AHEAD = { x: 0, y: 1.4, z: 30 };

function dataWith(...skills: SkillDef[]): GameData {
  const d = defaultData();
  for (const s of skills) d.skills[s.id] = s;
  return d;
}
const base = (id: string, element: SkillDef['element'], extra: Partial<SkillDef>): SkillDef => ({
  id,
  element,
  slot: 'basic',
  shape: { type: 'projectile', speed: 30, radius: 0.25, gravity: 0, lifetime: 1 },
  damage: 10,
  cooldown: 0.1,
  applies: null,
  cast: { archetype: 'throw', windup: 0, clip: 'x', move: 0.7 },
  fx: {},
  tags: [],
  ...extra,
});

test('swapTo 2 changes the element to earth with no cooldown on swapping', () => {
  const sim = makeSim();
  run(sim, 1, input({ swapTo: 2 }));
  assert.equal(sim.snapshot().players[0].element, 'earth');
  assert.equal(sim.player.swapReadyAt, 0);
});

test('swapping works at any time: on consecutive ticks, with every skill cooling down and a cast in progress', () => {
  const sim = makeSim();
  for (const id of Object.keys(sim.data.skills)) sim.player.cooldowns[id] = 99;
  sim.player.castState = { skillId: 'fire.fireball', fired: false, until: 99, move: 1 } as never;
  run(sim, 1, input({ swapTo: 2 }));
  run(sim, 1, input({ swapTo: 1 }));
  run(sim, 1, input({ swapTo: 3 }));
  assert.equal(sim.player.element, 3);
  assert.equal(sim.player.castState, null, 'a cast that has not left the caster is cancelled by the swap');
});

test('swapping to the element already held does nothing', () => {
  const sim = makeSim();
  assert.equal(trySwap(sim, sim.player, 0), false);
  assert.equal(sim.player.swapReadyAt, 0);
  assert.equal(trySwap(sim, sim.player, 9), false);
  assert.equal(trySwap(sim, sim.player, -1), false);
});

test('the first skill within 3 s of a swap deals 1.25x and always applies its status; the next deals 1x', () => {
  const data = dataWith(base('fire.never', 'fire', { applies: 'burning', statusChance: 0 }));
  data.player.swap.cooldown = 0;
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 6 });
  trySwap(sim, sim.player, 1);
  trySwap(sim, sim.player, 0);
  assert.equal(castSkill(sim, sim.player, 'fire.never', AHEAD).ok, true);
  run(sim, 30);
  assert.ok(Math.abs(1000 - dummy.hp - 12.5) < 1e-9, `hp lost ${1000 - dummy.hp}`);
  assert.ok(dummy.statuses.burning, 'the status was guaranteed');
  dummy.statuses = {};
  run(sim, 10);
  castSkill(sim, sim.player, 'fire.never', AHEAD);
  run(sim, 30);
  assert.ok(Math.abs(1000 - dummy.hp - 22.5) < 1e-9, `second shot did 10: ${1000 - dummy.hp}`);
  assert.equal(dummy.statuses.burning, undefined, 'a normal hit with chance 0 applies nothing');
});

test('the bonus is gone at 3.1 s', () => {
  const sim = makeSim();
  trySwap(sim, sim.player, 1);
  run(sim, 186);
  assert.deepEqual(consumeSwapBonus(sim.player, sim.time, sim.data.player.swap), { damageMul: 1, guaranteeStatus: false });
});

test('consumeSwapBonus hands out the bonus once', () => {
  const sim = makeSim();
  trySwap(sim, sim.player, 3);
  const cfg = sim.data.player.swap;
  assert.deepEqual(consumeSwapBonus(sim.player, sim.time, cfg), { damageMul: 1.25, guaranteeStatus: true });
  assert.deepEqual(consumeSwapBonus(sim.player, sim.time, cfg), { damageMul: 1, guaranteeStatus: false });
});

test('a wind skill with no status gets only the damage bonus', () => {
  const data = dataWith(base('wind.gust', 'wind', {}));
  const sim = makeSim(1, { data });
  const dummy = spawnEnemy(sim, 'enemy.dummy', { x: 0, y: 0, z: 6 });
  trySwap(sim, sim.player, 3);
  castSkill(sim, sim.player, 'wind.gust', AHEAD);
  run(sim, 30);
  assert.ok(Math.abs(1000 - dummy.hp - 12.5) < 1e-9);
  assert.deepEqual(dummy.statuses, {});
});

test('swapping during a windup cancels the pending cast and gives the cooldown back', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.fireball', AHEAD);
  assert.ok(sim.player.castState);
  run(sim, 3, input({ swapTo: 1 }));
  assert.equal(sim.player.castState, null);
  run(sim, 30);
  assert.equal(sim.projectiles.length, 0);
  assert.equal(sim.player.cooldowns['fire.fireball'], undefined);
});

test('activeSkillFor reads the loadout by the held element and slot', () => {
  const sim = makeSim();
  assert.equal(activeSkillFor(sim.player, 'basic'), 'fire.fireball');
  sim.player.element = 1;
  assert.equal(activeSkillFor(sim.player, 'basic'), 'water.water_bolt');
  assert.equal(activeSkillFor(sim.player, 'secondary'), 'water.tidal_stream');
  sim.player.loadout.water.utility = '';
  assert.equal(activeSkillFor(sim.player, 'utility'), '');
});

test('pressing the left button casts the held element\'s basic skill at the crosshair', () => {
  const sim = makeSim();
  run(sim, 1, input({ buttons: BTN.LMB }));
  assert.equal(sim.player.castState?.skillId, 'fire.fireball');
  run(sim, 15, idle());
  assert.equal(sim.projectiles.length, 1);
});
