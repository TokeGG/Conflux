import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enemyHurtboxes, spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { applyStatus } from '../src/sim/statuses.ts';
import { castSkill } from '../src/sim/skills.ts';
import { BTN, idle, input, makeSim, run } from './helpers.ts';
import type { AiArchetype, EnemyDef } from '../src/types.ts';
import type { Sim } from '../src/sim/sim.ts';

const at = (x: number, z: number) => ({ x, y: 0, z });
const dist = (e: EnemyState, sim: Sim) => Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z);

/** An enemy of the given archetype made from the dummy's body, with the attacks and numbers a scenario needs. */
function make(ai: AiArchetype, over: Partial<EnemyDef> = {}, pos = at(0, 0), player = at(0, 12)) {
  const sim = makeSim();
  sim.player.pos = { ...player, y: 0 };
  const e = spawnEnemy(sim, 'enemy.dummy', pos);
  e.def = { ...e.def, ai, hp: 100000, speed: 4, attacks: [], ...over };
  e.hp = 100000;
  e.guard = e.def.guard ? { on: false, until: 0, staggeredUntil: 0 } : null;
  return { sim, e };
}
const secs = (sim: Sim, s: number, i = idle()) => run(sim, Math.round(s * 60), i);
const lost = (sim: Sim) => 100 - sim.player.hp;

test('a rusher closes to melee range and attacks', () => {
  const { sim, e } = make('rusher', { attacks: ['atk.swipe_basic'] });
  secs(sim, 6);
  assert.ok(dist(e, sim) < 2.4, `closed to ${dist(e, sim)}`);
  assert.ok(lost(sim) >= 8, `the swipe landed (${lost(sim)})`);
});

test('a shooter holds between 8 and 12 m and fires', () => {
  const { sim, e } = make('shooter', { attacks: ['atk.bolt_basic'] }, at(0, 0), at(0, 24));
  secs(sim, 12);
  const d = dist(e, sim);
  assert.ok(d >= 7.5 && d <= 12.5, `holding at ${d}`);
  assert.ok(lost(sim) > 0, 'it hit the player');
  sim.player.pos = { x: e.pos.x, y: 0, z: e.pos.z + 3 };
  secs(sim, 5);
  assert.ok(dist(e, sim) >= 7.5, `backed off to ${dist(e, sim)}`);
});

test('a tank advances slowly and raises and lowers its guard on its timers', () => {
  const { sim, e } = make('tank', { speed: 1.5, attacks: ['atk.slam_basic'], guard: { reduction: 0.8, onFor: 3, offFor: 5, staggerOnWeak: 2 } }, at(0, 0), at(0, 40));
  const seen = new Set<boolean>();
  for (let i = 0; i < 20 * 60; i++) {
    sim.step([idle()]);
    seen.add(e.guard!.on);
  }
  assert.ok(seen.has(true) && seen.has(false), 'the guard cycled');
  assert.ok(e.pos.z > 15 && e.pos.z < 31, `slow advance (${e.pos.z})`);
  const { sim: s2, e: e2 } = make('tank', { speed: 1.5, guard: { reduction: 0.8, onFor: 3, offFor: 5, staggerOnWeak: 2 } }, at(0, 0), at(0, 40));
  let onTicks = 0;
  let first = -1;
  for (let i = 0; i < 12 * 60; i++) {
    s2.step([idle()]);
    if (e2.guard!.on) {
      onTicks++;
      if (first < 0) first = i;
    }
  }
  assert.ok(first <= 2, 'it guards from the start');
  assert.ok(onTicks >= 3 * 60 * 1.9 && onTicks <= 3 * 60 * 2.2, `on for 3 s each time (${onTicks / 60} s in 12)`);
});

test('swarm members spread without overlapping within 0.5 m', () => {
  const sim = makeSim();
  sim.player.pos = { x: 0, y: 0, z: 30 };
  const members = Array.from({ length: 6 }, (_, i) => {
    const e = spawnEnemy(sim, 'enemy.dummy', at(i * 0.1, i * 0.05));
    e.def = { ...e.def, ai: 'swarm', speed: 3, attacks: [], hp: 1000 };
    return e;
  });
  secs(sim, 4);
  let min = Infinity;
  for (const a of members) for (const b of members) if (a !== b) min = Math.min(min, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
  assert.ok(min >= 0.5, `closest pair ${min}`);
});

test('a flyer keeps its hover height, dives at the player and climbs back', () => {
  const { sim, e } = make('flyer', { attacks: ['atk.charge_basic'] }, at(0, 0), at(0, 8));
  secs(sim, 1);
  assert.ok(e.pos.y >= 2 && e.pos.y <= 3.2, `hovering at ${e.pos.y}`);
  let low = Infinity;
  for (let i = 0; i < 10 * 60; i++) {
    sim.step([idle()]);
    low = Math.min(low, e.pos.y);
  }
  assert.ok(low < 1.2, `it dived (lowest ${low})`);
  assert.ok(lost(sim) > 0, 'the dive hurt');
  secs(sim, 2);
  assert.ok(e.pos.y >= 1.5, `climbed back (${e.pos.y})`);
});

test('a charger telegraphs, dashes in a straight line and then recovers', () => {
  const { sim, e } = make('charger', { attacks: ['atk.charge_basic'] }, at(0, 0), at(0, 7));
  const events = secs(sim, 3);
  const tele = events.find((x) => x.type === 'telegraph');
  assert.ok(tele && tele.shape === 'line', 'a line telegraph before the dash');
  assert.ok(Math.abs(e.pos.x) < 0.05, 'straight along the line');
  let done = -1;
  let still = 0;
  for (let i = 0; i < 6 * 60; i++) {
    const before = { ...e.pos };
    sim.step([idle()]);
    if (!e.attack && done < 0 && Math.hypot(e.pos.x - before.x, e.pos.z - before.z) === 0 && e.aiState === 'recover') done = i;
    if (done >= 0 && Math.hypot(e.pos.x - before.x, e.pos.z - before.z) === 0) still++;
  }
  assert.ok(done >= 0, 'it entered recovery');
  assert.ok(still >= 60, `held still for a while (${still} ticks)`);
});

test('a summoner spawns adds up to its cap and no more', () => {
  const { sim } = make('summoner', { attacks: ['atk.summon_basic'] }, at(0, 0), at(0, 11));
  secs(sim, 60);
  const adds = sim.enemies.filter((x) => x.def.id === 'enemy.dummy' && x.def.ai !== 'summoner').length;
  const cap = sim.data.attacks['atk.summon_basic'].summon!.cap!;
  assert.ok(adds >= 2, `it summoned (${adds})`);
  assert.ok(adds <= cap, `${adds} adds is within the cap of ${cap}`);
});

test('an ambusher is untargetable underground, comes up under the player, then can be hurt', () => {
  const { sim, e } = make('ambusher', { attacks: ['atk.slam_basic'] }, at(0, 0), at(0, 10));
  e.aiState = 'buried';
  assert.deepEqual(enemyHurtboxes(e), [], 'no hurtboxes while buried');
  castSkill(sim, sim.player, 'fire.fireball', { x: 0, y: 0.9, z: 0 });
  secs(sim, 0.5);
  assert.equal(e.hp, 100000, 'nothing hurts it underground');
  secs(sim, 10);
  assert.ok(['surfacing', 'surfaced'].includes(e.aiState), `state ${e.aiState}`);
  assert.ok(dist(e, sim) < 3, 'it came up near the player');
  secs(sim, 3);
  assert.equal(e.aiState, 'surfaced');
  assert.ok(enemyHurtboxes(e).length > 0);
});

test('every archetype stops acting while gusted', () => {
  const archetypes: AiArchetype[] = ['rusher', 'shooter', 'tank', 'swarm', 'flyer', 'charger', 'summoner', 'ambusher'];
  for (const ai of archetypes) {
    const { sim, e } = make(ai, { attacks: ['atk.swipe_basic'] }, at(0, 0), at(0, 10));
    if (ai === 'ambusher') e.aiState = 'surfaced';
    secs(sim, 0.1);
    applyStatus(sim, e, 'gusted', sim.time);
    const before = { ...e.pos };
    secs(sim, 1);
    assert.deepEqual(e.pos, before, `${ai} stood still while gusted`);
  }
});

test('an enemy cannot walk through a wall', () => {
  const sim = makeSim();
  sim.player.pos = { x: 0, y: 0, z: 12 };
  const e = spawnEnemy(sim, 'enemy.dummy', at(0, 0));
  e.def = { ...e.def, ai: 'rusher', speed: 4, attacks: [] };
  (sim.world as unknown as { colliders: unknown[] }).colliders = [{ kind: 'box', min: { x: -3, y: 0, z: 5 }, max: { x: 3, y: 3, z: 6 } }];
  secs(sim, 6);
  assert.ok(e.pos.z < 5, `blocked at ${e.pos.z}`);
});

test('a room whose enemies are all dead emits room_cleared exactly once, and an empty room never does', () => {
  const empty = makeSim();
  assert.equal(secs(empty, 3).filter((x) => x.type === 'room_cleared').length, 0);
  const { sim } = make('none');
  spawnEnemy(sim, 'enemy.dummy', at(5, 5));
  const out = [];
  out.push(...secs(sim, 1));
  assert.equal(out.filter((x) => x.type === 'room_cleared').length, 0, 'not while they live');
  for (const x of [...sim.enemies]) x.hp = 0;
  sim.enemies = [];
  out.push(...secs(sim, 3));
  assert.equal(out.filter((x) => x.type === 'room_cleared').length, 1);
});

test('two sims running the same fight have the same hash', () => {
  const go = () => {
    const { sim } = make('shooter', { attacks: ['atk.bolt_basic'] }, at(0, 0), at(0, 20));
    secs(sim, 5, input({ buttons: BTN.LMB }));
    return sim.hash();
  };
  assert.equal(go(), go());
});
