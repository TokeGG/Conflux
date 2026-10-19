import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAim } from '../src/aim.ts';
import { World, type Collider } from '../src/world.ts';
import { aimDir, v3 } from '../src/math.ts';
import type { HurtCapsule } from '../src/sim/state.ts';

const V = (x: number, y: number, z: number) => ({ x, y, z });
const cam = V(0, 1.5, 0);
const enemyAt = (z: number, id = 7): HurtCapsule => ({ enemyId: id, a: V(0, 0.5, z), b: V(0, 1.8, z), r: 0.5 });
const wallAt = (z: number): Collider => ({ kind: 'box', min: V(-5, 0, z), max: V(5, 4, z + 0.5) });

test('aiming straight at an enemy capsule returns its id and a point on it', () => {
  const r = resolveAim(new World([]), [enemyAt(12)], cam, 0, 0, 50);
  assert.equal(r.hitEnemy, 7);
  assert.equal(r.hitWorld, false);
  assert.ok(Math.abs(r.point.z - 11.5) < 1e-6, `z ${r.point.z}`);
});

test('aiming at a wall reports a world hit', () => {
  const r = resolveAim(new World([wallAt(10)]), [], cam, 0, 0, 50);
  assert.equal(r.hitWorld, true);
  assert.equal(r.hitEnemy, null);
  assert.ok(Math.abs(r.point.z - 10) < 1e-6);
});

test('aiming at the sky returns a finite point exactly maxRange along the ray', () => {
  const r = resolveAim(new World([]), [], cam, 0, 0.5, 40);
  assert.equal(r.hitEnemy, null);
  assert.equal(r.hitWorld, false);
  const expect = v3.add(cam, v3.scale(aimDir(0, 0.5), 40));
  for (const k of ['x', 'y', 'z'] as const) assert.ok(Number.isFinite(r.point[k]) && Math.abs(r.point[k] - expect[k]) < 1e-9);
});

test('an enemy behind a wall is not hit', () => {
  const r = resolveAim(new World([wallAt(6)]), [enemyAt(12)], cam, 0, 0, 50);
  assert.equal(r.hitEnemy, null);
  assert.equal(r.hitWorld, true);
});

test('the nearer of world and enemy wins either way round', () => {
  const near = resolveAim(new World([wallAt(4)]), [enemyAt(12)], cam, 0, 0, 50);
  assert.equal(near.hitWorld, true);
  const far = resolveAim(new World([wallAt(20)]), [enemyAt(8)], cam, 0, 0, 50);
  assert.equal(far.hitEnemy, 7);
  assert.equal(far.hitWorld, false);
});

test('an enemy beyond maxRange is not hit', () => {
  assert.equal(resolveAim(new World([]), [enemyAt(30)], cam, 0, 0, 10).hitEnemy, null);
});
