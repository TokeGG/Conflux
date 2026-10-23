import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData, type SimEvent, type Vec3 } from '@conflux/shared';
import { castExtras, keptCastFx } from '../src/fx/castFx.ts';
import { fxForEvent } from '../src/fx/events.ts';

const data = defaultData();
const ev = (skillId: string, extra: Record<string, unknown> = {}): SimEvent => ({ t: 1, type: 'cast_fire', skillId, x: 0.2, y: 0.7, z: 0.5, yaw: 0, pitch: 0, ...extra });
const feet: Vec3 = { x: 0, y: 0, z: 0 };

test('a cast shows the skill\'s cast effect at the hand, small enough to sit on it', () => {
  const at = fxForEvent(ev('fire.fireball'), data.skills);
  assert.equal(at?.id, 'fx.ember_burst');
  assert.equal(at?.at, 'pos');
  assert.ok(at!.scale! > 0.2 && at!.scale! <= 0.8, `scale ${at?.scale}`);
});

test('a cone is drawn along its length from the hand, turned the way it points', () => {
  const [c] = castExtras(ev('fire.flame_cone', { yaw: Math.PI / 2 }), data.skills, feet);
  assert.equal(c.id, 'fx.flame_jet');
  const range = data.skills['fire.flame_cone'].shape.range!;
  assert.ok(c.pos.x > 0.2 + range * 0.3 && Math.abs(c.pos.z - 0.5) < 1e-6, `centre ${JSON.stringify(c.pos)}`);
  assert.ok(c.dir && Math.abs(c.dir.x - 1) < 1e-6);
  assert.ok(c.scale > 1, 'sized to the range');
});

test('a dash with no ground trail shows its trail effect along the path; one with a ground trail leaves it to the zones', () => {
  const plain = castExtras(ev('wind.air_dash', { distance: 6 }), data.skills, feet);
  assert.ok(plain.length >= 3 && plain.every((p) => p.id === 'fx.dust_step'));
  assert.ok(plain[plain.length - 1].pos.z > 4, 'reaches the end of the path');
  assert.equal(castExtras(ev('fire.flame_dash', { distance: 6 }), data.skills, feet).length, 0);
});

test('projectiles, zones and buffs add nothing beyond the cast effect', () => {
  for (const id of ['fire.fireball', 'earth.spike_field', 'water.bubble_shield']) assert.deepEqual(castExtras(ev(id), data.skills, feet), []);
});

const snap = (o: Partial<{ buff: string | null; casting: string | null; aim: Vec3 | null }>) => ({ pos: { x: 2, y: 0, z: 3 }, facing: 0, buff: null, casting: null, aim: null, ...o });

test('a shield or buff shows a looping aura on the player for as long as it is up', () => {
  const m = keptCastFx(snap({ buff: 'water.bubble_shield' }), data.skills, data.player.castOrigin);
  const aura = m.get('buff')!;
  assert.equal(aura.id, 'fx.bubble_shield');
  assert.ok(aura.pos.x === 2 && aura.pos.y > 0.4 && aura.pos.y < 1.5 && aura.pos.z === 3);
  assert.equal(keptCastFx(snap({}), data.skills, data.player.castOrigin).size, 0);
});

test('a channelled stream is drawn in pieces from the hand toward the aim point', () => {
  const m = keptCastFx(snap({ casting: 'water.tidal_stream', aim: { x: 2, y: 1, z: 13 } }), data.skills, data.player.castOrigin);
  const parts = [...m.entries()].filter(([k]) => k.startsWith('stream'));
  assert.ok(parts.length >= 2, `${parts.length} pieces`);
  assert.ok(parts.every(([, f]) => f.id === 'fx.tidal_wave' && f.dir && f.dir.z > 0.9));
  const zs = parts.map(([, f]) => f.pos.z);
  assert.ok(zs.every((z, i) => i === 0 || z > zs[i - 1]), 'spread along the stream');
  assert.equal(keptCastFx(snap({ casting: 'fire.fireball', aim: null }), data.skills, data.player.castOrigin).size, 0, 'only streams');
});
