import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v3, aimDir, rayVsSphere, rayVsCapsule, rayVsBox, type Vec3 } from '../src/math.ts';
import { World, type Collider } from '../src/world.ts';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const box = (min: Vec3, max: Vec3): Collider => ({ kind: 'box', min, max });

test('v3 helpers', () => {
  assert.deepEqual(v3.add(V(1, 2, 3), V(1, 1, 1)), V(2, 3, 4));
  assert.deepEqual(v3.sub(V(1, 2, 3), V(1, 1, 1)), V(0, 1, 2));
  assert.deepEqual(v3.scale(V(1, 2, 3), 2), V(2, 4, 6));
  near(v3.len(V(3, 4, 0)), 5);
  near(v3.len(v3.norm(V(0, 0, 9))), 1);
  assert.equal(v3.dot(V(1, 0, 0), V(0, 1, 0)), 0);
  assert.deepEqual(v3.cross(V(1, 0, 0), V(0, 1, 0)), V(0, 0, 1));
  assert.deepEqual(v3.lerp(V(0, 0, 0), V(10, 0, 0), 0.25), V(2.5, 0, 0));
  assert.deepEqual(v3.norm(V(0, 0, 0)), V(0, 0, 0), 'normalising zero must not give NaN');
});

test('aimDir: yaw 0 faces +Z, yaw 90 degrees faces +X, positive pitch looks up', () => {
  const f = aimDir(0, 0);
  assert.deepEqual([f.x, f.y, f.z].map((n) => Math.round(n * 1e9) / 1e9), [0, 0, 1]);
  const r = aimDir(Math.PI / 2, 0);
  near(r.x, 1);
  near(r.z, 0);
  assert.ok(aimDir(0, 0.5).y > 0);
});

test('a ray along +Z hits a sphere at (0,0,10) radius 1 at t = 9, and misses a sphere off to the side', () => {
  near(rayVsSphere(V(0, 0, 0), V(0, 0, 1), V(0, 0, 10), 1)!, 9);
  assert.equal(rayVsSphere(V(0, 0, 0), V(0, 0, 1), V(5, 0, 10), 1), null);
  assert.equal(rayVsSphere(V(0, 0, 0), V(0, 0, -1), V(0, 0, 10), 1), null, 'a sphere behind the ray is not hit');
});

test('a ray hits a capsule from (0,0,5) to (0,2,5) radius 0.5 at t = 4.5, and also hits its side', () => {
  near(rayVsCapsule(V(0, 0, 0), V(0, 0, 1), V(0, 0, 5), V(0, 2, 5), 0.5)!, 4.5);
  near(rayVsCapsule(V(0, 1, 0), V(0, 0, 1), V(0, 0, 5), V(0, 2, 5), 0.5)!, 4.5);
  assert.equal(rayVsCapsule(V(3, 1, 0), V(0, 0, 1), V(0, 0, 5), V(0, 2, 5), 0.5), null);
  assert.equal(rayVsCapsule(V(0, 5, 0), V(0, 0, 1), V(0, 0, 5), V(0, 2, 5), 0.5), null);
});

test('rayVsBox returns the entry distance, 0 from inside, null on a miss', () => {
  const [lo, hi] = [V(-1, 0, 10), V(1, 2, 12)];
  near(rayVsBox(V(0, 1, 0), V(0, 0, 1), lo, hi)!, 10);
  near(rayVsBox(V(0, 1, 11), V(0, 0, 1), lo, hi)!, 0);
  assert.equal(rayVsBox(V(5, 1, 0), V(0, 0, 1), lo, hi), null);
});

test('World.raycast returns the nearest collider and its hit point', () => {
  const near1 = box(V(-1, 0, 8), V(1, 3, 9));
  const far = box(V(-1, 0, 20), V(1, 3, 21));
  const hit = new World([far, near1]).raycast(V(0, 1, 0), V(0, 0, 1), 50)!;
  near(hit.t, 8);
  assert.equal(hit.collider, near1);
  near(hit.point.z, 8);
});

test('World.raycast on a cylinder collider (trees)', () => {
  const tree: Collider = { kind: 'cyl', min: V(4, 0, 4), max: V(6, 5, 6) }; // centre (5,_,5) radius 1
  const hit = new World([tree]).raycast(V(5, 1, 0), V(0, 0, 1), 50)!;
  near(hit.t, 4);
  assert.equal(hit.collider, tree);
  assert.equal(new World([tree]).raycast(V(5, 6, 0), V(0, 0, 1), 50), null, 'a ray above the tree misses');
});

test('open sky: pitched down hits the ground, pitched up returns null, maxT is respected', () => {
  const w = new World([]);
  const down = w.raycast(V(0, 1.5, 0), aimDir(0, -0.3), 50)!;
  near(down.point.y, 0, 1e-9);
  assert.equal(down.collider, null);
  assert.equal(w.raycast(V(0, 1.5, 0), aimDir(0, 0.5), 50), null);
  assert.equal(w.raycast(V(0, 1.5, 0), aimDir(0, -0.01), 5), null, 'ground hit beyond maxT is ignored');
});

test('a collider closer than the ground wins, and the ground wins when it is closer', () => {
  const wall = box(V(-1, 0, 3), V(1, 3, 4));
  const w = new World([wall]);
  assert.equal(w.raycast(V(0, 1, 0), aimDir(0, -0.05), 50)!.collider, wall);
  assert.equal(w.raycast(V(0, 1, 0), aimDir(0, -0.9), 50)!.collider, null);
});

test('sweepSphere stops 0.25 short of a wall for r 0.25, and returns null when the path is free', () => {
  const w = new World([box(V(-5, 0, 10), V(5, 4, 11))]);
  near(w.sweepSphere(V(0, 1, 0), V(0, 1, 20), 0.25)!, 9.75);
  assert.equal(w.sweepSphere(V(0, 1, 0), V(0, 1, 9), 0.25), null, 'stops before the wall: no contact');
  assert.equal(w.sweepSphere(V(0, 1, 0), V(10, 1, 0), 0.25), null);
});

test('sweepSphere also lands on the ground', () => {
  const t = new World([]).sweepSphere(V(0, 3, 0), V(0, -3, 0), 0.5)!;
  near(t, 2.5);
});

test('blocked treats a position as feet of a body of the given radius', () => {
  const tree: Collider = { kind: 'cyl', min: V(4, 0, 4), max: V(6, 5, 6) };
  const w = new World([tree, box(V(10, 0, 10), V(12, 3, 12))]);
  assert.equal(w.blocked(V(5, 0, 5), 0.5), true);
  assert.equal(w.blocked(V(7.2, 0, 5), 0.5), false);
  assert.equal(w.blocked(V(6.4, 0, 5), 0.5), true, 'the body overlaps the tree edge');
  assert.equal(w.blocked(V(11, 0, 11), 0.3), true);
  assert.equal(w.blocked(V(11, 4, 11), 0.3), false, 'a body at y 4 spans 4 to 5.8: the box (up to 3) is below it');
});

test('groundAt returns groundY', () => {
  assert.equal(new World([], 0).groundAt(3, 4), 0);
  assert.equal(new World([], 1.5).groundAt(-9, 2), 1.5);
});
