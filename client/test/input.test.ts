// The camera looks along (sin yaw, cos yaw), and with y up the screen's right-hand side is (-cos yaw, sin yaw) in the world.
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).document = { pointerLockElement: null };
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/input.ts';

const target = { addEventListener() {} } as unknown as HTMLElement;
const make = () => {
  const c = new InputController(target);
  c.unlocked = true;
  return c;
};
const screenRight = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
/** Where the sim sends a player who holds moveX = 1 (right = (cos, -sin) in the sim). */
const simRight = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;

test('moving the mouse right turns the view to the right', () => {
  const c = make();
  c.look(10, 0);
  const forward = { x: Math.sin(c.yaw), z: Math.cos(c.yaw) };
  assert.ok(dot(forward, screenRight(0)) > 0, 'the new forward points to the right of the old one');
});

test('holding D walks toward the right of the screen, A toward the left', () => {
  for (const yaw of [0, 1, -2.4]) {
    const c = make();
    c.yaw = yaw;
    (c as any).keys.add('KeyD');
    const d = c.poll();
    assert.ok(dot({ x: simRight(yaw).x * d.moveX, z: simRight(yaw).z * d.moveX }, screenRight(yaw)) > 0, `D at yaw ${yaw}`);
    (c as any).keys.clear();
    (c as any).keys.add('KeyA');
    const a = c.poll();
    assert.ok(dot({ x: simRight(yaw).x * a.moveX, z: simRight(yaw).z * a.moveX }, screenRight(yaw)) < 0, `A at yaw ${yaw}`);
  }
});

test('mouse up looks up and mouse down looks down', () => {
  const c = make();
  c.look(0, -10);
  assert.ok(c.pitch > 0);
  c.pitch = 0;
  c.look(0, 10);
  assert.ok(c.pitch < 0);
});

test('invertY flips the vertical look and nothing else', () => {
  const c = make();
  c.invertY = true;
  c.look(10, -10);
  assert.ok(c.pitch < 0, 'mouse up now looks down');
  assert.ok(dot({ x: Math.sin(c.yaw), z: Math.cos(c.yaw) }, screenRight(0)) > 0, 'but the horizontal look is unchanged');
});

test('the pitch stays within its limit', () => {
  const c = make();
  c.look(0, -100000);
  assert.ok(c.pitch <= Math.PI / 2 && c.pitch > 0);
  c.look(0, 200000);
  assert.ok(c.pitch >= -Math.PI / 2 && c.pitch < 0);
});

test('the default keys: Space jumps, Shift dashes, Q is the utility skill, E interacts', async () => {
  const { BTN } = await import('@conflux/shared');
  const c = make();
  for (const code of ['Space', 'ShiftLeft', 'KeyQ']) (c as any).keys.add(code);
  const b = c.poll().buttons;
  assert.ok(b & BTN.JUMP, 'jump');
  assert.ok(b & BTN.DODGE, 'dash');
  assert.ok(b & BTN.UTIL, 'utility');
  (c as any).keys.clear();
  (c as any).keys.add('KeyE');
  assert.ok(c.poll().buttons & BTN.INTERACT);
});

test('requestLock asks the canvas for the mouse (and counts the ask), and does nothing when the canvas already has it', () => {
  let asked = 0;
  const canvas = { addEventListener() {}, requestPointerLock: () => void asked++ } as unknown as HTMLElement;
  const c = new InputController(canvas);
  c.requestLock();
  c.requestLock();
  assert.equal(asked, 2);
  assert.equal(c.lockRequests, 2);
  (globalThis as any).document.pointerLockElement = canvas;
  c.requestLock();
  assert.equal(asked, 2, 'already locked');
  (globalThis as any).document.pointerLockElement = null;
});
