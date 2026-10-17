import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { EVENT_TYPES, defaultData } from '@conflux/shared';
import { SpriteFlipbook } from '../src/fx/sprites.ts';
import { fxForEvent } from '../src/fx/events.ts';
import fxmap from '../src/fx/fxmap.json' with { type: 'json' };
import type { FxDef } from '../src/assets/loader.ts';

const sheet = JSON.parse(readFileSync(new URL('../public/assets/fx/spellwoven/fx.json', import.meta.url), 'utf8')) as { effects: FxDef[] };
const defs = new Map(sheet.effects.map((e) => [`fx.${e.id}`, e]));
const def = (id: string) => defs.get(id)!;
const book = (id: string) => new SpriteFlipbook(def(id), new THREE.Texture(), 'linear');
const data = defaultData();

test('fireball_impact (20 frames at 70 ms, no loop) is at 0 at the start, 10 at 700 ms and holds 19 afterwards', () => {
  const b = book('fx.fireball_impact');
  assert.equal(b.frameAt(0), 0);
  assert.equal(b.frameAt(700), 10);
  assert.equal(b.frameAt(1330), 19);
  assert.equal(b.frameAt(5000), 19);
  assert.equal(b.done(5000), true);
  assert.equal(b.done(600), false);
});

test('a looping flipbook wraps', () => {
  const looping = sheet.effects.find((e) => e.loop)!;
  const b = new SpriteFlipbook(looping, new THREE.Texture(), 'linear');
  assert.equal(b.frameAt(0), 0);
  assert.equal(b.frameAt(looping.ms * looping.frames), 0);
  assert.equal(b.frameAt(looping.ms * (looping.frames + 3)), 3);
  assert.equal(b.done(1e9), false);
});

test('setFrame steps the sheet UVs to the right cell, counted from the top row', () => {
  const d = def('fx.fireball_impact'); // 1920x384 sheet, 192 px frames, 10 columns
  const tex = new THREE.Texture();
  const b = new SpriteFlipbook(d, tex, 'linear');
  b.setFrame(0);
  assert.ok(Math.abs(tex.repeat.x - 192 / 1920) < 1e-9 && Math.abs(tex.repeat.y - 192 / 384) < 1e-9);
  assert.ok(Math.abs(tex.offset.x) < 1e-9 && Math.abs(tex.offset.y - 0.5) < 1e-9, 'frame 0 is top-left');
  b.setFrame(13);
  assert.ok(Math.abs(tex.offset.x - 3 * 0.1) < 1e-9, 'column 3');
  assert.ok(Math.abs(tex.offset.y - 0) < 1e-9, 'second row');
});

test('the flipbook uses the filter it is given and no mipmaps', () => {
  const tex = new THREE.Texture();
  new SpriteFlipbook(def('fx.fireball_impact'), tex, 'nearest');
  assert.equal(tex.magFilter, THREE.NearestFilter);
  assert.equal(tex.generateMipmaps, false);
  const lin = new THREE.Texture();
  new SpriteFlipbook(def('fx.fireball_impact'), lin, 'linear');
  assert.equal(lin.magFilter, THREE.LinearFilter);
});

test('every fx id used by a skill or by fxmap.json exists in fx.json', () => {
  const used = new Set<string>();
  for (const s of Object.values(data.skills)) for (const id of Object.values(s.fx)) used.add(id);
  const walk = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('fx.')) used.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(fxmap);
  assert.ok(used.size > 15);
  for (const id of used) assert.ok(defs.has(id), `${id} is in fx.json`);
});

test('every event type the sim can emit has a mapping or an explicit null', () => {
  for (const t of EVENT_TYPES) assert.ok(t in fxmap.events, `${t} is in fxmap.json`);
  for (const t of Object.keys(fxmap.events)) assert.ok((EVENT_TYPES as readonly string[]).includes(t), `${t} is a real event type`);
});

test('a hit shows its skill\'s hit effect at the point it landed', () => {
  const e = { t: 1, type: 'hit', target: 'enemy', id: 3, skillId: 'fire.fireball', amount: 14, x: 1, y: 1, z: 5 };
  assert.deepEqual(fxForEvent(e, data.skills), { id: 'fx.fireball_impact', at: 'pos' });
  assert.equal(fxForEvent({ ...e, skillId: 'status.burning' }, data.skills), null, 'damage over time shows no impact');
  assert.equal(fxForEvent({ ...e, skillId: 'reaction.steam' }, data.skills), null);
});

test('each of the 12 reactions has an effect, and a shield pop, a dodge and a death have one too', () => {
  for (const r of data.reactions) assert.ok(fxForEvent({ t: 0, type: 'reaction', id: r.id, enemyId: 1, pos: { x: 0, y: 0, z: 0 } }, data.skills), r.id);
  assert.ok(fxForEvent({ t: 0, type: 'shield_pop', skillId: 'water.bubble_shield' }, data.skills));
  assert.ok(fxForEvent({ t: 0, type: 'dodge', yaw: 0 }, data.skills));
  assert.ok(fxForEvent({ t: 0, type: 'enemy_died', id: 1, defId: 'enemy.dummy' }, data.skills));
});

test('a swap shows an effect for the element swapped to, and events that show nothing return null', () => {
  for (const el of ['fire', 'water', 'earth', 'wind']) assert.ok(fxForEvent({ t: 0, type: 'swap', from: 'fire', to: el }, data.skills), el);
  assert.equal(fxForEvent({ t: 0, type: 'cast', skillId: 'fire.fireball' }, data.skills), null);
  assert.equal(fxForEvent({ t: 0, type: 'swap', from: 'fire', to: 'lava' }, data.skills), null, 'an unknown key shows nothing rather than throwing');
});
