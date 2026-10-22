import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData } from '@conflux/shared';
import { ATTACK_STYLES, ATTACK_TIMING, AttackTracker, REST_FRAME, attackPose, type AttackStage, type Frame } from '../src/anim/attackAnim.ts';

const data = defaultData();
const ids = Object.keys(data.attacks);
const keys = Object.keys(REST_FRAME) as (keyof Frame)[];
const dist = (a: Frame, b: Frame) => Math.sqrt(keys.reduce((s, k) => s + (a[k] - b[k]) ** 2, 0));

test('every attack in attacks.json has its own style, of its own template', () => {
  for (const id of ids) {
    assert.ok(ATTACK_STYLES[id], `${id} has a style`);
    assert.equal(ATTACK_STYLES[id].template, data.attacks[id].template, `${id} uses its template's frames`);
  }
  for (const id of Object.keys(ATTACK_STYLES)) assert.ok(data.attacks[id], `${id} is a real attack`);
});

test('every attack pose is rest at the start of the wind-up and at the end of the recovery, finite throughout', () => {
  for (const id of ids) {
    assert.ok(dist(attackPose(id, 'windup', 0), REST_FRAME) < 1e-9, `${id} starts at rest`);
    assert.ok(dist(attackPose(id, 'recover', 1), REST_FRAME) < 1e-9, `${id} ends at rest`);
    assert.ok(dist(attackPose(id, 'recover', 1, 0, 'wind'), REST_FRAME) < 1e-9, `${id} ends at rest when cut short`);
    for (const stage of ['windup', 'strike', 'recover'] as AttackStage[]) {
      for (let u = -0.5; u <= 1.5; u += 0.1) {
        const p = attackPose(id, stage, u, u * 3);
        for (const k of keys) assert.ok(Number.isFinite(p[k]), `${id} ${stage} ${u} ${k}`);
      }
    }
  }
});

test('the wind-up, the strike and the recovery look different for every attack', () => {
  for (const id of ids) {
    const wind = attackPose(id, 'windup', 1);
    const hit = attackPose(id, 'strike', 1);
    const mid = attackPose(id, 'recover', 0.5);
    assert.ok(dist(wind, REST_FRAME) > 0.1, `${id} winds up away from rest`);
    assert.ok(dist(wind, hit) > 0.2, `${id} strikes differently from its wind-up`);
    assert.ok(dist(hit, REST_FRAME) > 0.1, `${id} strikes away from rest`);
    assert.ok(dist(mid, hit) > 0.05 && dist(mid, REST_FRAME) > 0.02, `${id} is between the strike and rest while recovering`);
  }
});

test('the wind-up is smooth and grows with the sim\'s progress, and the strike is continuous with it', () => {
  for (const id of ids) {
    let prev = attackPose(id, 'windup', 0).energy;
    for (let u = 0.05; u <= 1.001; u += 0.05) {
      const e = attackPose(id, 'windup', u).energy;
      assert.ok(e >= prev - 1e-9, `${id} energy never falls during the wind-up`);
      prev = e;
    }
    assert.ok(dist(attackPose(id, 'windup', 1), attackPose(id, 'strike', 0)) < 1e-9, `${id} strike begins where the wind-up ended`);
    assert.ok(dist(attackPose(id, 'strike', 1), attackPose(id, 'recover', 0)) < 1e-9, `${id} recovery begins where the strike ended`);
  }
});

test('different attacks of one template look different (each mob its own)', () => {
  const swipes = ids.filter((i) => data.attacks[i].template === 'melee_swipe');
  const looks = new Set(swipes.map((i) => keys.map((k) => attackPose(i, 'strike', 1)[k].toFixed(3)).join()));
  assert.ok(looks.size >= swipes.length - 2, `${looks.size} distinct strikes from ${swipes.length} swipes`);
});

test('the reaper swings its scythe up overhead and then down; the book opens and spins its pages', () => {
  const w = attackPose('atk.reaper_scythe', 'windup', 1);
  const h = attackPose('atk.reaper_scythe', 'strike', 1);
  assert.ok(w.weapon < -1 && h.weapon > 1);
  const p = attackPose('atk.page_flurry', 'strike', 1);
  assert.ok(p.open > 0.5 && p.spin > 3);
});

test('the tracker follows the sim through the wind-up, then strikes and recovers on its own clock, and goes quiet', () => {
  const t = new AttackTracker();
  assert.equal(t.update(null, null, 0, 0.016), null);
  let n = t.update('atk.golem_slam', 'windup', 0.3, 0.016)!;
  assert.deepEqual([n.stage, n.u], ['windup', 0.3]);
  n = t.update('atk.golem_slam', 'windup', 0.97, 0.016)!;
  assert.equal(n.u, 0.97);
  n = t.update(null, null, 0, 0.016)!;
  assert.equal(n.stage, 'strike');
  assert.equal(n.from, 'hit');
  n = t.update(null, null, 0, ATTACK_TIMING.strikeSeconds)!;
  assert.equal(n.stage, 'recover');
  n = t.update(null, null, 0, ATTACK_TIMING.recoverSeconds * 0.5)!;
  assert.equal(n.stage, 'recover');
  assert.ok(n.u > 0.4 && n.u < 1);
  assert.equal(t.update(null, null, 0, 1), null);
});

test('an attack cut short recovers from its wind-up, without a strike', () => {
  const t = new AttackTracker();
  t.update('atk.golem_slam', 'windup', 0.3, 0.016);
  const n = t.update(null, null, 0, 0.016)!;
  assert.deepEqual([n.stage, n.from], ['recover', 'wind']);
});

test('a charge strikes while it runs and recovers after', () => {
  const t = new AttackTracker();
  t.update('atk.wisp_dive', 'windup', 0.99, 0.016);
  assert.equal(t.update('atk.wisp_dive', 'active', 0.4, 0.016)!.stage, 'strike');
  t.update(null, null, 0, 0.016);
  assert.equal(t.update(null, null, 0, 0.2)!.stage, 'recover');
});
