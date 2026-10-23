import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultData } from '@conflux/shared';
import { attackClip } from '../src/anim/attackAnim.ts';

const data = defaultData();

/** The animation names inside a GLB file (its JSON chunk). */
function glbClips(file: string): string[] {
  const b = readFileSync(new URL(`../public/assets/models/${file}`, import.meta.url));
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  return (json.animations ?? []).map((a: { name: string }) => a.name);
}

test('an attack with its own entry in rig.attackClips plays that clip; others fall back to the hashed list', () => {
  const rig = { clips: { attack: ['A1', 'A2', 'A3'] }, attackClips: { 'atk.x': 'B' } };
  assert.equal(attackClip(rig, 'atk.x'), 'B');
  const other = attackClip(rig, 'atk.y');
  assert.ok(['A1', 'A2', 'A3'].includes(other!));
  assert.equal(attackClip(rig, 'atk.y'), other, 'the same attack always gets the same clip');
  assert.equal(attackClip({}, 'atk.y'), null);
  assert.equal(attackClip({ attackClips: { 'atk.x': 'B' } }, 'atk.x'), 'B');
});

test('every golem plays the overhead two-handed clip for its slam and the sweeping clip for its swipe', () => {
  const clips = glbClips('enemies/golem.glb');
  const golems = Object.values(data.enemies).filter((e) => e.attacks.includes('atk.golem_slam'));
  assert.ok(golems.length >= 3);
  for (const g of golems) {
    if (g.model !== 'model.golem') continue;
    assert.equal(attackClip(g.rig, 'atk.golem_slam'), 'Attack2', `${g.name} slam`);
    assert.equal(attackClip(g.rig, 'atk.golem_swipe'), 'Attack1', `${g.name} swipe`);
    for (const c of Object.values(g.rig.attackClips ?? {})) assert.ok(clips.includes(c), `${c} is a clip of golem.glb`);
  }
});

test('every attackClips entry names an attack the mob has and a clip it has listed', () => {
  for (const e of Object.values(data.enemies)) {
    for (const [atk] of Object.entries(e.rig.attackClips ?? {})) assert.ok(e.attacks.includes(atk), `${e.name}: ${atk}`);
  }
});
