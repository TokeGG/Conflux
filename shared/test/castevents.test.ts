// What the client needs to draw a cast: where and when the skill leaves the hand, the live buff, and the stream's aim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSkill } from '../src/sim/skills.ts';
import { castOriginAt } from '../src/sim/castorigin.ts';
import type { Vec3 } from '../src/math.ts';
import { idle, makeSim, run } from './helpers.ts';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

test('cast_fire is emitted when the skill leaves the hand, at the hand, once', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.fireball', V(0, 1.4, 20));
  const ev = run(sim, 30).filter((e) => e.type === 'cast_fire');
  assert.equal(ev.length, 1);
  const hand = castOriginAt(sim.player.pos, sim.player.facing, sim.data.player.castOrigin);
  assert.equal(ev[0].skillId, 'fire.fireball');
  assert.ok(Math.abs((ev[0].x as number) - hand.x) < 1e-9 && Math.abs((ev[0].y as number) - hand.y) < 1e-9 && Math.abs((ev[0].z as number) - hand.z) < 1e-9);
  assert.ok(Math.abs((ev[0].yaw as number) - 0) < 0.01, 'aimed straight ahead');
  assert.ok(sim.time > 0.2 && ev[0].t !== undefined);
});

test('a dash reports how far it carries the player', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.flame_dash', V(0, 1.4, 20));
  const ev = run(sim, 20).filter((e) => e.type === 'cast_fire');
  assert.equal(ev.length, 1);
  assert.ok((ev[0].distance as number) > 3, `distance ${ev[0].distance}`);
});

test('the snapshot names the active buff and the stream aim', () => {
  const sim = makeSim();
  assert.equal(sim.snapshot().players[0].buff, null);
  assert.equal(sim.snapshot().players[0].aim, null);
  castSkill(sim, sim.player, 'water.bubble_shield', V(0, 1.4, 20));
  run(sim, 30);
  assert.equal(sim.snapshot().players[0].buff, 'water.bubble_shield');
  run(sim, 60 * 12);
  assert.equal(sim.snapshot().players[0].buff, null, 'gone when it has run out');
  const sim2 = makeSim();
  castSkill(sim2, sim2.player, 'water.tidal_stream', V(0, 1.4, 20));
  run(sim2, 40, { ...idle() });
  const aim = sim2.snapshot().players[0].aim;
  assert.ok(aim && Number.isFinite(aim.x) && Number.isFinite(aim.z), 'a stream carries its aim point while it channels');
});
