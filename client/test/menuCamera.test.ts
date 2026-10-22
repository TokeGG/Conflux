import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuCamera } from '../src/hud/menuCamera.ts';

test('the menu camera circles the room at a steady distance and height, always looking at its middle', () => {
  const a = menuCamera(0, [24, 28]);
  const b = menuCamera(7, [24, 28]);
  const r = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
  assert.ok(Math.abs(r(a.pos) - r(b.pos)) < 1e-9, 'same distance from the centre');
  assert.equal(a.pos.y, b.pos.y);
  assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 1, 'it moves');
  assert.ok(a.pos.y > 2 && a.pos.y < 8, 'a low, cinematic height');
  assert.deepEqual([a.look.x, a.look.z], [0, 0]);
});

test('a bigger room gets a wider orbit', () => {
  assert.ok(menuCamera(0, [40, 40]).pos.x ** 2 + menuCamera(0, [40, 40]).pos.z ** 2 > menuCamera(0, [20, 20]).pos.x ** 2 + menuCamera(0, [20, 20]).pos.z ** 2);
});
