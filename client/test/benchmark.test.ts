import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Benchmark, orbitPose } from '../src/dev/benchmark.ts';

const centre = { x: 0, y: 0, z: 0 };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test('the camera path is a closed circle around the centre at a fixed radius and height', () => {
  const start = orbitPose(0, 10, centre, 8, 3);
  const end = orbitPose(10, 10, centre, 8, 3);
  assert.ok(dist(start.pos, end.pos) < 1e-9, 'the loop closes');
  for (const t of [0, 1.3, 5, 7.7, 10]) {
    const p = orbitPose(t, 10, centre, 8, 3);
    assert.ok(Math.abs(dist(p.pos, centre) - 8) < 1e-9);
    assert.equal(p.pos.y, 3);
    assert.deepEqual(p.look, centre);
  }
  const half = orbitPose(5, 10, centre, 8, 3);
  assert.ok(Math.abs(dist(start.pos, half.pos) - 16) < 1e-9, 'half way round is the far side');
});

test('a 10 second benchmark finishes after 10 seconds of frames, once, and records every frame', () => {
  const b = new Benchmark(10);
  assert.equal(b.running, false);
  assert.equal(b.update(16), false, 'does nothing before start');
  assert.equal(b.stats.count, 0);
  b.start();
  assert.equal(b.running, true);
  let finishedAt = -1;
  for (let i = 1; i <= 700; i++) {
    if (b.update(1000 / 60) && finishedAt < 0) finishedAt = i;
  }
  assert.ok(finishedAt >= 599 && finishedAt <= 601, `finished at frame ${finishedAt}`);
  assert.equal(b.running, false);
  assert.equal(b.stats.count, finishedAt, 'frames after the end are not recorded');
});

test('progress goes from 0 to 1 and start resets a previous run', () => {
  const b = new Benchmark(2);
  b.start();
  b.update(1000);
  assert.ok(Math.abs(b.progress() - 0.5) < 1e-9);
  b.update(1000);
  assert.equal(b.progress(), 1);
  b.start();
  assert.equal(b.progress(), 0);
  assert.equal(b.stats.count, 0);
});
