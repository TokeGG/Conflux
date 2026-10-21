import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAttack } from '../src/sim/attacks.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { World, type Collider } from '../src/world.ts';
import { defaultData } from '../src/files.ts';
import type { SimEvent } from '../src/types.ts';
import { BTN, idle, input, makeSim, run } from './helpers.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });
const wall = (z: number): Collider => ({ kind: 'box', min: { x: -5, y: 0, z }, max: { x: 5, y: 4, z: z + 0.5 } });

/** An enemy at the origin facing +Z with a player at p; attacks never leave the dummy's data, so they come from attacks.json. */
function setup(player = at(0, 20), world?: World) {
  const sim = makeSim(1, world ? { world } : {});
  sim.player.pos = { ...player, y: 0 };
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 0));
  return { sim, e };
}
const lostHp = (sim: ReturnType<typeof setup>['sim']) => 100 - sim.player.hp;
const events = (sim: ReturnType<typeof setup>['sim'], n: number, i = idle()): SimEvent[] => run(sim, n, i);

test('an attack emits a telegraph that ends exactly when the damage lands, no sooner than its windup', () => {
  const { sim, e } = setup(at(0, 3));
  const atk = sim.data.attacks['atk.slam_basic'];
  assert.equal(runAttack(sim, e, 'atk.slam_basic', sim.player.pos), true);
  const first = sim.step([idle()]);
  const tele = first.find((x) => x.type === 'telegraph');
  assert.ok(tele, 'a telegraph event');
  assert.equal(tele.enemyId, e.id);
  assert.ok(Math.abs((tele.until as number) - atk.windup) < 1e-9, `until ${tele.until}`);
  assert.ok((tele.until as number) - (tele.t as number) >= atk.windup - 1e-9);
  assert.equal(tele.shape, 'circle');
  const hpAt = (ticks: number) => {
    const s = setup(at(0, 3));
    runAttack(s.sim, s.e, 'atk.slam_basic', s.sim.player.pos);
    run(s.sim, ticks);
    return s.sim.player.hp;
  };
  assert.equal(hpAt(46), 100, 'nothing lands before the telegraph ends');
  assert.ok(hpAt(50) < 100, 'it lands when the telegraph ends');
});

test('a swipe hits a player in its cone and not behind, to the side or out of reach', () => {
  const hit = (p: { x: number; z: number }) => {
    const { sim, e } = setup(at(p.x, p.z));
    runAttack(sim, e, 'atk.swipe_basic', at(0, 5));
    e.facing = 0;
    events(sim, 60);
    return lostHp(sim) > 0;
  };
  assert.equal(hit({ x: 0, z: 1.5 }), true, 'in front');
  assert.equal(hit({ x: 0, z: -1.5 }), false, 'behind');
  assert.equal(hit({ x: 2, z: 1 }), false, 'well off to the side');
  assert.equal(hit({ x: 0, z: 4.5 }), false, 'out of reach');
});

test('a slam hits inside its radius ahead of the enemy and not outside it', () => {
  const hit = (z: number) => {
    const { sim, e } = setup(at(0, z));
    runAttack(sim, e, 'atk.slam_basic', at(0, 10));
    events(sim, 60);
    return lostHp(sim) > 0;
  };
  assert.equal(hit(3), true, 'at the centre');
  assert.equal(hit(4.5), true, 'inside the radius');
  assert.equal(hit(7), false, 'outside the radius');
  assert.equal(hit(-2), false, 'behind the enemy');
});

test('a dodge roll\'s invulnerable window avoids the hit; standing still takes it', () => {
  const dodged = setup(at(0, 3));
  runAttack(dodged.sim, dodged.e, 'atk.slam_basic', dodged.sim.player.pos);
  run(dodged.sim, 42);
  run(dodged.sim, 1, input({ buttons: BTN.DODGE }));
  run(dodged.sim, 30);
  assert.equal(lostHp(dodged.sim), 0, 'the roll was inside the slam and invulnerable when it landed');
  const still = setup(at(0, 3));
  runAttack(still.sim, still.e, 'atk.slam_basic', still.sim.player.pos);
  run(still.sim, 60);
  assert.equal(lostHp(still.sim), still.sim.data.attacks['atk.slam_basic'].damage);
});

test('a projectile attack travels, hits the player once, and is stopped by a wall', () => {
  const open = setup(at(0, 8));
  runAttack(open.sim, open.e, 'atk.bolt_basic', open.sim.player.pos);
  run(open.sim, 120);
  assert.equal(lostHp(open.sim), open.sim.data.attacks['atk.bolt_basic'].damage);
  assert.equal(open.sim.projectiles.length, 0);
  const blocked = setup(at(0, 8), new World([wall(4)]));
  runAttack(blocked.sim, blocked.e, 'atk.bolt_basic', blocked.sim.player.pos);
  run(blocked.sim, 120);
  assert.equal(lostHp(blocked.sim), 0);
});

test('an enemy projectile does not hurt other enemies', () => {
  const { sim, e } = setup(at(0, 12));
  const other = spawnEnemy(sim, 'enemy.dummy', at(0, 5));
  runAttack(sim, e, 'atk.bolt_basic', sim.player.pos);
  run(sim, 120);
  assert.equal(other.hp, 1000);
});

test('a charge rushes along its line, hits a player in the way once, and stops at a wall', () => {
  const { sim, e } = setup(at(0, 4));
  runAttack(sim, e, 'atk.charge_basic', sim.player.pos);
  run(sim, 120);
  assert.equal(lostHp(sim), sim.data.attacks['atk.charge_basic'].damage, 'hit exactly once');
  assert.ok(e.pos.z > 3, `the enemy ran forward (${e.pos.z})`);
  const w = setup(at(0, 30), new World([wall(3)]));
  runAttack(w.sim, w.e, 'atk.charge_basic', w.sim.player.pos);
  run(w.sim, 120);
  assert.ok(w.e.pos.z < 3, `the wall stopped it (${w.e.pos.z})`);
});

test('a summon spawns its enemies when the windup ends', () => {
  const { sim, e } = setup();
  runAttack(sim, e, 'atk.summon_basic', sim.player.pos);
  run(sim, 20);
  assert.equal(sim.enemies.length, 1);
  run(sim, 80);
  const spec = sim.data.attacks['atk.summon_basic'].summon!;
  assert.equal(sim.enemies.length, 1 + spec.count);
});

test('an attack on cooldown, or one started while another is winding up, is refused', () => {
  const { sim, e } = setup(at(0, 3));
  assert.equal(runAttack(sim, e, 'atk.slam_basic', sim.player.pos), true);
  assert.equal(runAttack(sim, e, 'atk.swipe_basic', sim.player.pos), false, 'busy');
  run(sim, 60);
  assert.equal(runAttack(sim, e, 'atk.slam_basic', sim.player.pos), false, 'cooling down');
  run(sim, 200);
  assert.equal(runAttack(sim, e, 'atk.slam_basic', sim.player.pos), true);
  assert.equal(runAttack(sim, e, 'atk.nothing', sim.player.pos), false, 'unknown attack');
});

test('an enemy killed during its windup never lands the attack', () => {
  const { sim, e } = setup(at(0, 3));
  runAttack(sim, e, 'atk.slam_basic', sim.player.pos);
  run(sim, 10);
  e.hp = 0;
  sim.enemies = sim.enemies.filter((x: EnemyState) => x !== e);
  run(sim, 80);
  assert.equal(lostHp(sim), 0);
});

test('every attack in the data is of a known template and fully specified', () => {
  const d = defaultData();
  for (const [id, a] of Object.entries(d.attacks)) {
    assert.ok(['melee_swipe', 'slam', 'projectile', 'charge', 'summon'].includes(a.template), id);
    assert.ok(a.windup > 0 && a.cooldown >= 0 && a.range > 0, id);
    if (a.template === 'summon') assert.ok(a.summon && d.enemies[a.summon.enemy], `${id} names a real enemy`);
  }
});

test('two sims running the same attacks have the same hash', () => {
  const make = () => {
    const { sim, e } = setup(at(0, 3));
    runAttack(sim, e, 'atk.slam_basic', sim.player.pos);
    run(sim, 100);
    return sim.hash();
  };
  assert.equal(make(), make());
});
