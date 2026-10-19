import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealDamage, defaultWeakResist } from '../src/sim/damage.ts';
import { castSkill } from '../src/sim/skills.ts';
import { applyStatus } from '../src/sim/statuses.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import type { Element } from '../src/types.ts';
import { makeSim, run } from './helpers.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });

function enemyOf(element: Element | 'none', extra: Partial<EnemyState['def']> = {}) {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 8));
  const wr = element === 'none' ? { weak: [], resist: [] } : defaultWeakResist(element);
  e.def = { ...e.def, element, ...wr, ...extra };
  return { sim, e };
}
const lost = (e: EnemyState) => 1000 - e.hp;

test('the default weak and resist follow the element cycle', () => {
  assert.deepEqual(defaultWeakResist('fire'), { weak: ['water'], resist: ['wind'] });
  assert.deepEqual(defaultWeakResist('water'), { weak: ['earth'], resist: ['fire'] });
  assert.deepEqual(defaultWeakResist('earth'), { weak: ['wind'], resist: ['water'] });
  assert.deepEqual(defaultWeakResist('wind'), { weak: ['fire'], resist: ['earth'] });
});

test('a fire enemy takes 1.5x from water, 0.5x from wind and 1x from earth', () => {
  const { sim, e } = enemyOf('fire');
  assert.equal(dealDamage(sim, e, 10, 'water'), 15);
  assert.equal(dealDamage(sim, e, 10, 'wind'), 5);
  assert.equal(dealDamage(sim, e, 10, 'earth'), 10);
  assert.equal(lost(e), 30);
});

test('a fire enemy is never given burning', () => {
  const { sim, e } = enemyOf('fire');
  dealDamage(sim, e, 10, 'fire', { applies: 'burning' });
  applyStatus(sim, e, 'burning', sim.time);
  assert.deepEqual(e.statuses, {});
  dealDamage(sim, e, 10, 'water', { applies: 'soaked' });
  assert.ok(e.statuses.soaked, 'other statuses still land');
});

test('a boss weak to water and wind takes 1.5x from both', () => {
  const { sim, e } = enemyOf('none', { weak: ['water', 'wind'], resist: [] });
  assert.equal(dealDamage(sim, e, 10, 'water'), 15);
  assert.equal(dealDamage(sim, e, 10, 'wind'), 15);
  assert.equal(dealDamage(sim, e, 10, 'fire'), 10);
});

test('damage of 0 or less is clamped at 0 and never heals', () => {
  const { sim, e } = enemyOf('none');
  assert.equal(dealDamage(sim, e, 0, 'fire'), 0);
  assert.equal(dealDamage(sim, e, -5, 'fire'), 0);
  assert.equal(e.hp, 1000);
});

test('hp reaching 0 emits enemy_died once, however many hits follow', () => {
  const { sim, e } = enemyOf('none', { hp: 1000 });
  e.hp = 5;
  dealDamage(sim, e, 10, 'fire');
  dealDamage(sim, e, 10, 'fire');
  const died = sim.step([]).filter((x) => x.type === 'enemy_died');
  assert.equal(died.length, 1);
  assert.equal(sim.enemies.includes(e), false);
});

test('order: swap bonus, then element, then rocked, so they multiply', () => {
  const { sim, e } = enemyOf('fire');
  applyStatus(sim, e, 'rocked', sim.time);
  const dealt = dealDamage(sim, e, 10, 'water', { swapBonus: 1.25 });
  assert.ok(Math.abs(dealt - 10 * 1.25 * 1.5 * 1.15) < 1e-9, `${dealt}`);
});

test('a raised guard cuts the damage by its reduction', () => {
  const { sim, e } = enemyOf('none', { guard: { reduction: 0.6, onFor: 2, offFor: 2, staggerOnWeak: 1 } });
  e.guard = { on: true, until: 99, staggeredUntil: 0 };
  assert.ok(Math.abs(dealDamage(sim, e, 10, 'fire') - 4) < 1e-9);
  e.guard.on = false;
  assert.equal(dealDamage(sim, e, 10, 'fire'), 10);
});

test('a hit on a target that carries another element\'s status triggers the reaction and lands the hit\'s status after it', () => {
  const { sim, e } = enemyOf('none');
  applyStatus(sim, e, 'soaked', sim.time);
  dealDamage(sim, e, 10, 'fire', { applies: 'burning' });
  const events = sim.step([]);
  assert.equal(events.filter((x) => x.type === 'reaction').length, 1);
  assert.equal(e.statuses.soaked, undefined);
  assert.ok(e.statuses.burning);
  assert.ok(lost(e) >= 20, `hit 10 plus steam 10 (${lost(e)})`);
});

test('the reaction scales with the damage after multipliers', () => {
  const { sim, e } = enemyOf('earth');
  e.def = { ...e.def, weak: ['water'] };
  applyStatus(sim, e, 'burning', sim.time);
  dealDamage(sim, e, 10, 'water');
  assert.equal(lost(e), 30, 'a 15 hit and a steam burst of those 15');
});

test('the player takes damage through the same call, with rocked and dodge respected', () => {
  const sim = makeSim();
  assert.equal(dealDamage(sim, sim.player, 10, 'fire'), 10);
  assert.equal(sim.player.hp, 90);
  applyStatus(sim, sim.player, 'rocked', sim.time);
  assert.ok(Math.abs(dealDamage(sim, sim.player, 10, 'fire') - 11.5) < 1e-9);
  sim.player.invulnUntil = 99;
  assert.equal(dealDamage(sim, sim.player, 10, 'fire'), 0);
});

test('a fireball into a Soaked enemy steams it', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 10));
  applyStatus(sim, e, 'soaked', sim.time);
  castSkill(sim, sim.player, 'fire.fireball', { x: 0, y: 1.4, z: 30 });
  const events = run(sim, 60);
  assert.ok(events.some((x) => x.type === 'reaction' && x.id === 'soaked.fire'));
  assert.ok(e.statuses.burning);
});
