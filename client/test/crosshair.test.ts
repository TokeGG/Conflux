import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCrosshair, crosshairSvg, defaultCrosshair, loadCrosshair, saveCrosshair } from '../src/crosshair.ts';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('the default crosshair is a gapped cross, shown', () => {
  const c = defaultCrosshair();
  assert.equal(c.style, 'cross');
  assert.equal(c.show, true);
});

test('clampCrosshair keeps every number in range and falls back on bad values', () => {
  const c = clampCrosshair({ size: 9999, thickness: -3, gap: 'x' as never, opacity: 7, style: 'banana' as never, color: 'red' as never });
  assert.ok(c.size <= 80 && c.size >= 4);
  assert.ok(c.thickness >= 1 && c.thickness <= 8);
  assert.equal(c.gap, defaultCrosshair().gap);
  assert.ok(c.opacity <= 1 && c.opacity >= 0.1);
  assert.equal(c.style, 'cross');
  assert.match(c.color, /^#[0-9a-f]{6}$/i);
});

test('a crosshair is saved and loaded, and a corrupt save gives the default', () => {
  const s = store();
  saveCrosshair(s, { ...defaultCrosshair(), style: 'ring', size: 30, color: '#00ff00' });
  const back = loadCrosshair(s);
  assert.equal(back.style, 'ring');
  assert.equal(back.size, 30);
  assert.equal(back.color, '#00ff00');
  s.setItem('conflux.crosshair', '{nope');
  assert.deepEqual(loadCrosshair(s), defaultCrosshair());
  assert.deepEqual(loadCrosshair(null), defaultCrosshair());
});

test('each style draws what its name says', () => {
  const draw = (style: string) => crosshairSvg({ ...defaultCrosshair(), outline: false, style: style as never }, false);
  assert.equal((draw('cross').match(/<line/g) ?? []).length, 4);
  assert.equal((draw('dot').match(/<circle/g) ?? []).length, 1);
  assert.equal((draw('ring').match(/<circle/g) ?? []).length, 1);
  assert.equal((draw('crossdot').match(/<line/g) ?? []).length, 4);
  assert.equal((draw('crossdot').match(/<circle/g) ?? []).length, 1);
});

test('the colour turns to the hot colour over an enemy, and a hidden crosshair draws nothing', () => {
  const c = { ...defaultCrosshair(), color: '#ffffff', hotColor: '#ff0000' };
  assert.match(crosshairSvg(c, false), /#ffffff/i);
  assert.match(crosshairSvg(c, true), /#ff0000/i);
  assert.equal(crosshairSvg({ ...c, show: false }, false), '');
});
