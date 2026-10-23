// Every skill has a cast animation and effects the player can see: a real clip of the player's rig and the effect slots its shape needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultData } from '../src/files.ts';
import { CAST_ARCHETYPES } from '../src/types.ts';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const clips = new Set<string>((read('../../client/public/assets/clips/wizardpack/index.json').clips as { name: string }[]).map((c) => c.name));
const fxIds = new Set<string>(read('../data/fxIds.json'));
const data = defaultData();
const rig = data.animation.rigs.wizardpack;

test('there are skills to check', () => {
  assert.ok(Object.keys(data.skills).length >= 38);
  assert.ok(clips.size > 40);
});

test('every skill plays a real clip of the player rig (or none and a valid archetype clip)', () => {
  for (const s of Object.values(data.skills)) {
    assert.ok(CAST_ARCHETYPES.includes(s.cast.archetype), `${s.id}: archetype ${s.cast.archetype}`);
    if (s.cast.clip) assert.ok(clips.has(s.cast.clip), `${s.id}: clip "${s.cast.clip}" is not a wizardpack clip`);
    else assert.ok(clips.has(rig.cast[s.cast.archetype]), `${s.id}: no clip and the archetype clip is missing`);
  }
});

test('every archetype of the player rig maps to a real clip, and each has its own', () => {
  const seen = new Map<string, string>();
  for (const a of CAST_ARCHETYPES) {
    const c = rig.cast[a];
    assert.ok(clips.has(c), `${a}: ${c}`);
    assert.ok(!seen.has(c), `${a} and ${seen.get(c)} share the clip ${c}`);
    seen.set(c, a);
  }
});

test('a skill plays the clip of its archetype, and the release moment (fireAt) is set for it', () => {
  for (const s of Object.values(data.skills)) {
    if (s.shape.type === 'dash') continue; // a dash plays the dodge clip
    assert.equal(s.cast.clip, rig.cast[s.cast.archetype], `${s.id}: ${s.cast.archetype} plays ${s.cast.clip}`);
    assert.ok((s.cast.fireAt ?? 0) > 0, `${s.id}: fireAt puts the clip's release on the windup`);
  }
});

test('every skill has the visible effects its shape needs, and every effect id exists', () => {
  for (const s of Object.values(data.skills)) {
    const fx = s.fx;
    for (const [slot, id] of Object.entries(fx)) assert.ok(fxIds.has(id), `${s.id}: fx ${slot} "${id}" does not exist`);
    assert.ok(fx.cast, `${s.id}: needs a cast effect at the hand`);
    switch (s.shape.type) {
      case 'projectile':
        assert.ok(fx.travel && fx.hit, `${s.id}: a projectile needs travel and hit`);
        break;
      case 'cone':
        assert.ok(fx.cone, `${s.id}: a cone needs a cone effect along it`);
        assert.ok(fx.hit || fx.zone, `${s.id}: a cone needs a hit effect`);
        break;
      case 'stream':
        assert.ok(fx.stream, `${s.id}: a stream needs a stream effect along it`);
        assert.ok(fx.hit || fx.zone, `${s.id}: a stream needs a hit effect`);
        break;
      case 'zone':
      case 'wall':
        assert.ok(fx.zone || fx.hit, `${s.id}: a zone needs a zone or hit effect`);
        break;
      case 'self':
        assert.ok(fx.self, `${s.id}: a buff or shield needs an effect round the player`);
        break;
      case 'dash':
        assert.ok(fx.trail, `${s.id}: a dash needs a trail`);
        break;
    }
  }
});
