import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWindow } from '../src/dev/winfit.ts';

const vp = { w: 1200, h: 800 };

test('a window is never smaller than its minimum or larger than the page', () => {
  assert.deepEqual(fitWindow({ x: 10, y: 10, w: 50, h: 50 }, vp, { minW: 320, minH: 280 }), { x: 10, y: 10, w: 320, h: 280 });
  const big = fitWindow({ x: 0, y: 0, w: 5000, h: 5000 }, vp, { minW: 320, minH: 280 });
  assert.ok(big.w <= vp.w && big.h <= vp.h);
});

test('a window dragged off the page keeps its title strip reachable', () => {
  const r = fitWindow({ x: 5000, y: -400, w: 600, h: 500 }, vp, { minW: 320, minH: 280 });
  assert.ok(r.x <= vp.w - 80, `x ${r.x}`);
  assert.ok(r.y >= 0, `y ${r.y}`);
  const l = fitWindow({ x: -900, y: 900, w: 600, h: 500 }, vp, { minW: 320, minH: 280 });
  assert.ok(l.x + l.w >= 80, `left edge ${l.x}`);
  assert.ok(l.y <= vp.h - 40, `y ${l.y}`);
});

test('a window that fits is left alone', () => {
  assert.deepEqual(fitWindow({ x: 100, y: 80, w: 700, h: 500 }, vp, { minW: 320, minH: 280 }), { x: 100, y: 80, w: 700, h: 500 });
});
