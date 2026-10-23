// Spells leave the casting hand (player.json castOrigin), not the top of the hat, and still land on the crosshair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSkill } from '../src/sim/skills.ts';
import { castOriginAt } from '../src/sim/castorigin.ts';
import { spawnEnemy } from '../src/sim/state.ts';
import { resolveAim } from '../src/aim.ts';
import { enemyHurtboxes } from '../src/sim/state.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { v3, type Vec3 } from '../src/math.ts';
import { idle, makeSim, run } from './helpers.ts';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const near = (a: Vec3, b: Vec3) => v3.len(v3.sub(a, b));

test('player.json has a castOrigin below shoulder height, and the data validates', () => {
  const d = defaultData();
  const o = d.player.castOrigin;
  assert.ok(o && Number.isFinite(o.forward) && Number.isFinite(o.right) && Number.isFinite(o.up), 'castOrigin is set');
  assert.ok(o.up > 0.3 && o.up < 1.4, `hand height ${o.up}`);
  assert.deepEqual(validateData(d), []);
  const bad = defaultData();
  (bad.player.castOrigin as { up: number }).up = Number.NaN;
  assert.ok(validateData(bad).length > 0, 'a non-number is refused');
});

test('castOriginAt puts the hand forward and to the character right of the feet, turning with the facing', () => {
  const cfg = { forward: 0.5, right: 0.2, up: 0.7 };
  const a = castOriginAt(V(1, 0, 2), 0, cfg);
  assert.ok(near(a, V(1 - 0.2, 0.7, 2.5)) < 1e-9, JSON.stringify(a));
  const b = castOriginAt(V(0, 0, 0), Math.PI / 2, cfg); // facing +x: forward is +x, right is +z
  assert.ok(near(b, V(0.5, 0.7, 0.2)) < 1e-9, JSON.stringify(b));
});

test('a fireball starts within 0.3 m of the hand and below shoulder height', () => {
  const sim = makeSim();
  castSkill(sim, sim.player, 'fire.fireball', V(0, 1.4, 30));
  let first: Vec3 | null = null;
  for (let i = 0; i < 40 && !first; i++) {
    sim.step([idle()]);
    if (sim.projectiles.length) first = v3.sub(sim.projectiles[0].pos, v3.scale(sim.projectiles[0].vel, 1 / 60)); // it already flew one tick in the step it was made in
  }
  assert.ok(first, 'it left');
  const hand = castOriginAt(sim.player.pos, sim.player.facing, sim.data.player.castOrigin);
  assert.ok(near(first!, hand) < 0.3, `first position ${JSON.stringify(first)} vs hand ${JSON.stringify(hand)}`);
  assert.ok(first!.y < 1.4, `height ${first!.y}`);
});

test('a hand origin beside and below the camera still hits the enemy under the crosshair', () => {
  for (const offset of [-6, -2, 0, 3, 7]) {
    const sim = makeSim();
    const e = spawnEnemy(sim, 'enemy.dummy', V(offset, 0, 12));
    const cam = V(-0.5, 1.9, -3.2); // behind the shoulder
    const yaw = Math.atan2(offset - cam.x, 12 - cam.z);
    const boxes = sim.enemies.flatMap((x) => enemyHurtboxes(x));
    const pitch = Math.atan2(1.0 - cam.y, Math.hypot(offset - cam.x, 12 - cam.z));
    const aim = resolveAim(sim.world, boxes, cam, yaw, pitch, 60);
    assert.equal(aim.hitEnemy, e.id, `the crosshair is on the dummy at ${offset}`);
    sim.player.facing = yaw;
    castSkill(sim, sim.player, 'fire.fireball', aim.point);
    run(sim, 90, { ...idle(), aimYaw: yaw, aimPitch: pitch, camOrigin: cam });
    assert.ok(e.hp < 1000, `hit at offset ${offset}`);
  }
});

test('an aim point behind the hand does not send the shot backwards', () => {
  const sim = makeSim();
  // an aim point behind the hand (a wall pressed against the camera): the shot still goes forward
  castSkill(sim, sim.player, 'fire.fireball', V(0, 1.0, 0.1));
  run(sim, 14);
  const q = sim.projectiles[0];
  assert.ok(q && q.vel.z > 0, 'goes forward');
});
