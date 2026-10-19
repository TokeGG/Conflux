import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfStats, type PerfEnv } from '../src/dev/perfStats.ts';
import { devEnabled } from '../src/dev/access.ts';

const url = (s: string) => new URL(s);
const store = (data: Record<string, string> = {}) => ({ getItem: (k: string) => data[k] ?? null });

test('devEnabled is true with ?dev or the saved flag, and false otherwise', () => {
  assert.equal(devEnabled(url('http://x/?dev'), store()), true);
  assert.equal(devEnabled(url('http://x/?a=1&dev=1'), store()), true);
  assert.equal(devEnabled(url('http://x/'), store()), false);
  assert.equal(devEnabled(url('http://x/'), store({ confluxDev: '1' })), true);
  assert.equal(devEnabled(url('http://x/'), store({ confluxDev: '0' })), false);
});

test('devEnabled survives storage that throws', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(devEnabled(url('http://x/'), blocked), false);
  assert.equal(devEnabled(url('http://x/?dev'), blocked), true);
  assert.equal(devEnabled(url('http://x/'), null), false);
});

test('100 frames of 16.67 ms average 60 fps', () => {
  const s = new PerfStats();
  for (let i = 0; i < 100; i++) s.push(1000 / 60);
  assert.ok(Math.abs(s.avgFps() - 60) < 0.5, String(s.avgFps()));
  assert.ok(Math.abs(s.lowFps() - 60) < 0.5);
  assert.ok(Math.abs(s.worstMs() - 16.67) < 0.01);
});

test('one 100 ms frame among 99 of 16.67 ms makes the 1% low about 10 fps and the worst frame 100 ms', () => {
  const s = new PerfStats();
  for (let i = 0; i < 99; i++) s.push(1000 / 60);
  s.push(100);
  assert.ok(Math.abs(s.lowFps() - 10) < 0.5, String(s.lowFps()));
  assert.equal(s.worstMs(), 100);
  assert.ok(s.avgFps() > 55);
});

test('the 1% low averages the worst 1% of frames (10 of 1000)', () => {
  const s = new PerfStats(2000);
  for (let i = 0; i < 990; i++) s.push(10);
  for (let i = 0; i < 10; i++) s.push(50);
  assert.ok(Math.abs(s.lowFps() - 20) < 0.01, String(s.lowFps()));
});

test('only the most recent frames are kept', () => {
  const s = new PerfStats(600);
  for (let i = 0; i < 1000; i++) s.push(i < 400 ? 100 : 10);
  assert.equal(s.count, 600);
  assert.ok(Math.abs(s.avgFps() - 100) < 0.01, 'the slow early frames fell out of the window');
});

test('empty stats and junk frames never give NaN', () => {
  const s = new PerfStats();
  assert.deepEqual([s.avgFps(), s.lowFps(), s.worstMs()], [0, 0, 0]);
  s.push(NaN);
  s.push(-5);
  s.push(Infinity);
  assert.equal(s.count, 0);
  s.push(20);
  assert.equal(s.avgFps(), 50);
});

test('clear forgets everything', () => {
  const s = new PerfStats();
  s.push(16);
  s.clear();
  assert.equal(s.count, 0);
});

test('report() names the GPU, resolution, render scale, fps figures, worst frame, draw calls and triangles', () => {
  const s = new PerfStats();
  for (let i = 0; i < 99; i++) s.push(1000 / 60);
  s.push(100);
  const env: PerfEnv = { gpu: 'ANGLE (Test GPU 9000)', browser: 'TestBrowser/1.0', width: 1920, height: 1080, dpr: 1, renderScale: 0.75, profile: 'chunky' };
  const text = s.report(env, { render: { calls: 312, triangles: 524288 }, memory: { geometries: 120, textures: 80 } });
  assert.match(text, /GPU: ANGLE \(Test GPU 9000\)/);
  assert.match(text, /Browser: TestBrowser\/1\.0/);
  assert.match(text, /1920x1080/);
  assert.match(text, /render scale 0\.75/);
  assert.match(text, /Average: 5\d\.\d fps/);
  assert.match(text, /1% low: 10\.\d fps/);
  assert.match(text, /Worst frame: 100\.0 ms/);
  assert.match(text, /Draw calls: 312/);
  assert.match(text, /Triangles: 524,288/);
  assert.match(text, /profile chunky/);
});
