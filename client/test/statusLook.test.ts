import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_IDS } from '@conflux/shared';
import { statusLook, STATUS_LOOK } from '../src/anim/statusLook.ts';

const s = (id: string, remaining = 4, stacks?: number) => ({ id, remaining, stacks });
const finite = (l: ReturnType<typeof statusLook>) => [...l.colorTo, l.colorAmount, ...l.emissive].every((v) => Number.isFinite(v));
const peakGlow = (id: string) => Math.max(...Array.from({ length: 200 }, (_, i) => Math.max(...statusLook([s(id)], i * 0.05).emissive)));

test('nothing on the mob gives the base look', () => {
  const l = statusLook([], 3);
  assert.equal(l.colorAmount, 0);
  assert.deepEqual(l.emissive, [0, 0, 0]);
  assert.equal(statusLook([s('burning', 0)], 3).colorAmount, 0, 'a status that ran out shows nothing');
  assert.equal(statusLook([s('unknown')], 3).colorAmount, 0);
});

test('every status in the game has a look that shows (a colour pull of at least 0.2)', () => {
  for (const id of STATUS_IDS) {
    const l = statusLook([s(id)], 0.37);
    assert.ok(l.colorAmount >= 0.2, `${id}: ${l.colorAmount}`);
    assert.ok(finite(l));
  }
});

test('burning glows orange-red and chars the colour; soaked glows blue-teal and darkens', () => {
  const b = statusLook([s('burning')], 0.2);
  assert.ok(b.emissive[0] > b.emissive[2] * 3, 'red over blue');
  assert.ok(Math.max(...b.colorTo) < 0.25, 'a dark char colour');
  const w = statusLook([s('soaked')], 0.35);
  assert.ok(w.emissive[2] > w.emissive[0] * 2 && w.emissive[1] > w.emissive[0] * 2, 'teal over red');
  assert.ok(Math.max(...w.colorTo) < 0.35);
});

test('rocked pulls hard toward stone grey-brown and has no glow', () => {
  const l = statusLook([s('rocked')], 1.1);
  assert.ok(l.colorAmount >= 0.8);
  assert.ok(Math.abs(l.colorTo[0] - 0x8a / 255) < 0.01 && Math.abs(l.colorTo[2] - 0x72 / 255) < 0.01);
  assert.deepEqual(l.emissive, [0, 0, 0]);
});

test('stone smothers the glow of other statuses on the same mob', () => {
  const both = statusLook([s('rocked'), s('burning')], 0.2);
  const fire = statusLook([s('burning')], 0.2);
  assert.ok(Math.max(...both.emissive) < Math.max(...fire.emissive) * 0.2);
});

test('shocked flickers hard between bright and nearly dark; poisoned is green; cursed violet; exposed gold; dilated slow', () => {
  const vals = Array.from({ length: 60 }, (_, i) => Math.max(...statusLook([s('shocked')], i / 60).emissive));
  assert.ok(Math.max(...vals) > 0.5 && Math.min(...vals) < 0.25);
  const p = statusLook([s('poisoned')], 0.3 / STATUS_LOOK.poisoned.hz / 4 + 0.2);
  assert.ok(peakGlow('poisoned') > 0.4);
  assert.ok(p.colorTo[1] > p.colorTo[0] && p.colorTo[1] > p.colorTo[2]);
  const c = STATUS_LOOK.cursed.glow;
  assert.ok(c[2] > c[1] && c[0] > c[1], 'violet');
  const e = STATUS_LOOK.exposed.glow;
  assert.ok(e[0] > e[2] && e[1] > e[2], 'gold');
  assert.ok(STATUS_LOOK.dilated.hz < 0.5, 'a slow pulse');
});

test('poison stacks make it stronger', () => {
  const one = statusLook([s('poisoned', 4, 1)], 0.4);
  const five = statusLook([s('poisoned', 4, 5)], 0.4);
  assert.ok(five.colorAmount > one.colorAmount);
});

test('several statuses blend: more pull than either alone, colour between them, and never past 1', () => {
  const a = statusLook([s('burning')], 0.5);
  const b = statusLook([s('poisoned')], 0.5);
  const ab = statusLook([s('burning'), s('poisoned')], 0.5);
  assert.ok(ab.colorAmount > Math.max(a.colorAmount, b.colorAmount) && ab.colorAmount <= 1);
  assert.ok(ab.colorTo[1] > a.colorTo[1] && ab.colorTo[1] < b.colorTo[1]);
  const all = statusLook([...STATUS_IDS.map((id) => s(id)), s('stasis'), s('petrified')], 1.234);
  assert.ok(finite(all) && all.colorAmount <= 1 && all.emissive.every((v) => v >= 0 && v <= 1));
});

test('a status fades as it runs out instead of snapping off', () => {
  const full = statusLook([s('cursed', 2)], 0.3).colorAmount;
  const end = statusLook([s('cursed', 0.1)], 0.3).colorAmount;
  assert.ok(end < full * 0.5 && end > 0);
});

test('stays finite for odd times and stacks', () => {
  for (const t of [0, 1e6, -5, NaN, Infinity]) for (const id of STATUS_IDS) assert.ok(finite(statusLook([s(id, 3, 99)], t)), `${id} at ${t}`);
});

test('stone covers the painted texture (cover is 1 while rocked or petrified) and nothing else does', () => {
  assert.equal(statusLook([s('rocked')], 0.5).cover, 1);
  assert.equal(statusLook([s('petrified')], 0.5).cover, 1);
  assert.equal(statusLook([s('burning')], 0.5).cover, 0);
  assert.equal(statusLook([], 0.5).cover, 0);
});
