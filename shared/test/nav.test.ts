import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, type Collider } from '../src/world.ts';
import { NavGrid } from '../src/sim/nav.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { generateRoom } from '../src/gen/generate.ts';
import { buildWorld } from '../src/room.ts';
import { defaultData } from '../src/files.ts';
import { makeSim, run } from './helpers.ts';

const box = (x0: number, z0: number, x1: number, z1: number): Collider => ({ kind: 'box', min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 3, z: z1 } });
/** A 24 m square room with a long wall across the middle, open only at the far right end. */
const walledRoom = (): World => new World([box(-12, -12.5, 12, -12), box(-12, 12, 12, 12.5), box(-12.5, -12, -12, 12), box(12, -12, 12.5, 12), box(-12, -0.5, 8, 0.5)]);

function at(sim: ReturnType<typeof makeSim>, x: number, z: number) {
  return { x, y: 0, z };
}

test('an enemy behind a long wall walks round it to the player instead of pressing against it', () => {
  for (const id of ['enemy.skeleton', 'enemy.zombie', 'enemy.treefellow']) {
    const sim = makeSim(1, { world: walledRoom() });
    sim.god = true;
    sim.player.pos = at(sim, -8, 6);
    const e = spawnEnemy(sim, id, at(sim, -8, -6));
    run(sim, 60 * 25);
    const d = Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z);
    assert.ok(d < 3, `${id} ended ${d.toFixed(1)} m from the player at ${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}`);
  }
});

test('on open ground an enemy still walks straight at the player', () => {
  const sim = makeSim(1, { world: new World([box(-12, -12.5, 12, -12), box(-12, 12, 12, 12.5), box(-12.5, -12, -12, 12), box(12, -12, 12.5, 12)]) });
  sim.god = true;
  sim.player.pos = at(sim, 0, 8);
  const e = spawnEnemy(sim, 'enemy.skeleton', at(sim, 0, -4));
  run(sim, 60);
  assert.ok(Math.abs(e.pos.x) < 0.3, `drifted sideways to ${e.pos.x}`);
  assert.ok(e.pos.z > -4 + 1, `moved ${e.pos.z + 4}`);
});

test('the grid marks the wall blocked and the gap open, and finds a step toward a target round a wall', () => {
  const nav = new NavGrid(walledRoom());
  assert.equal(nav.isBlocked(0, 0), true);
  assert.equal(nav.isBlocked(10, 0), false);
  const step = nav.step(-8, -6, -8, 6);
  assert.ok(step, 'a route exists');
  assert.ok(step!.x > -8, `the first step heads toward the gap (${step!.x}, ${step!.z})`);
});

test('a target nobody can reach gives no step, so the enemy falls back to walking at it', () => {
  const sealed = new World([box(-12, -12.5, 12, -12), box(-12, 12, 12, 12.5), box(-12.5, -12, -12, 12), box(12, -12, 12.5, 12), box(-12, -0.5, 12, 0.5)]);
  assert.equal(new NavGrid(sealed).step(-8, -6, -8, 6), null);
});

test('enemies in generated rooms of every style reach the player', () => {
  const data = defaultData();
  for (const theme of ['crypt', 'cave', 'grove', 'library']) {
    for (const seed of [2, 5]) {
      const room = generateRoom(data, seed, 1, seed, theme).room;
      const sim = makeSim(1, { world: buildWorld(room) });
      sim.god = true;
      sim.player.pos = { x: room.spawns.player.x, y: 0, z: room.spawns.player.z };
      const far = room.spawns.enemies.reduce((b, s) => (Math.hypot(s.x - sim.player.pos.x, s.z - sim.player.pos.z) > Math.hypot(b.x - sim.player.pos.x, b.z - sim.player.pos.z) ? s : b));
      const e = spawnEnemy(sim, 'enemy.skeleton', { x: far.x, y: 0, z: far.z });
      run(sim, 60 * 40);
      const d = Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z);
      assert.ok(d < 3, `${theme} seed ${seed}: ended ${d.toFixed(1)} m away`);
    }
  }
});

test('40 enemies in a room full of props tick under 4 ms on average', () => {
  const room = generateRoom(defaultData(), 3, 1, 3, 'crypt').room;
  const sim = makeSim(1, { world: buildWorld(room) });
  sim.god = true;
  sim.player.pos = { x: room.spawns.player.x, y: 0, z: room.spawns.player.z };
  room.spawns.enemies.slice(0, 28).forEach((s, i) => spawnEnemy(sim, 'enemy.skeleton', { x: s.x, y: 0, z: s.z }));
  for (const s of room.spawns.enemies.slice(0, 12)) spawnEnemy(sim, 'enemy.zombie', { x: s.x + 0.7, y: 0, z: s.z });
  const t = performance.now();
  run(sim, 600);
  const per = (performance.now() - t) / 600;
  assert.ok(per < 4, `${per.toFixed(2)} ms per tick`);
});
