import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData, validateData } from '../src/data.ts';
import { DATA_FILES, defaultData } from '../src/files.ts';
import { USED_PIECES } from '../../scripts/gen-pieces.ts';
import { PROC_KIT, PROC_PIECES } from '../src/gen/proc.ts';

const manifest = new Set<string>((JSON.parse(readFileSync(new URL('../../client/public/assets/assets.json', import.meta.url), 'utf8')) as { id: string }[]).map((a) => a.id));
const data = defaultData();

test('the twelve themes exist and the data validates with them', () => {
  assert.deepEqual(Object.keys(data.themes).sort(), ['arena', 'bonepit', 'cave', 'cellar', 'chapel', 'crypt', 'ember', 'flooded', 'grove', 'hall', 'library', 'prison']);
  assert.deepEqual(validateData(data), []);
});

test('every piece a theme names is one the generator has bounds for', () => {
  for (const t of Object.values(data.themes)) {
    const named = [
      [t.floor.kit, t.floor.tile], [t.floor.kit, t.floor.detail], [t.wall.kit, t.wall.plain], [t.wall.kit, t.wall.detail], [t.wall.kit, t.wall.corner],
      ...t.wall.gates.map((g) => [t.wall.kit, g]),
      ...Object.values(t.pools).flat().map((p) => [p.kit, p.id]),
    ];
    for (const [kit, id] of named) assert.ok(kit === PROC_KIT ? !!PROC_PIECES[id] : USED_PIECES[kit]?.includes(id), `${t.id}: ${kit}/${id} is not a known piece`);
  }
});

test('every texture a theme names is in the manifest, and every mob is an enemy', () => {
  for (const t of Object.values(data.themes)) {
    for (const id of [...t.floor.tex, ...t.wall.tex]) assert.ok(manifest.has(id), `${t.id}: ${id}`);
    for (const m of Object.keys(t.mobs)) assert.ok(data.enemies[m], `${t.id}: ${m}`);
  }
});

test('validateData rejects a theme with an unknown mob, texture-less floor or empty piece pool', () => {
  const bad = structuredClone(data);
  bad.themes.crypt.mobs['enemy.nope'] = 1;
  assert.ok(validateData(bad).some((e) => e.includes('enemy.nope')));
  const noTex = structuredClone(data);
  noTex.themes.hall.floor.tex = [];
  assert.ok(validateData(noTex).some((e) => /hall.*floor/.test(e)));
  const noSet = structuredClone(data);
  noSet.themes.cave.pools.set = [];
  assert.ok(validateData(noSet).some((e) => /cave.*set/.test(e)));
});

test('loadData needs the themes file', () => {
  const { themes: _t, ...rest } = DATA_FILES as Record<string, unknown>;
  assert.throws(() => loadData(rest), /themes/);
});

/** [hue in degrees, saturation 0 to 1, value 0 to 1] of a #rrggbb colour. */
function hsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx === 0 ? 0 : d / mx, mx];
}

/** The theme's dominant hue: the circular mean of its tint, ambient and fog hues, each weighted by how saturated it is. */
function dominant(t: { tint: string; lighting: { ambient: string; fogColor: string } }): { hue: number; sat: number } {
  let x = 0;
  let y = 0;
  let sat = 0;
  for (const c of [t.tint, t.lighting.ambient, t.lighting.fogColor]) {
    const [h, s] = hsv(c);
    x += Math.cos((h * Math.PI) / 180) * s;
    y += Math.sin((h * Math.PI) / 180) * s;
    sat += s;
  }
  return { hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, sat: sat / 3 };
}

test('no two themes share a dominant hue (within 25 degrees on tint, ambient and fog together)', () => {
  const list = Object.values(data.themes).map((t) => ({ id: t.id, ...dominant(t) }));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = Math.abs(list[i].hue - list[j].hue);
      assert.ok(Math.min(d, 360 - d) > 25, `${list[i].id} (${list[i].hue.toFixed(0)}) and ${list[j].id} (${list[j].hue.toFixed(0)}) look alike`);
    }
  }
});

test('every theme is coloured, not grey, and bright enough to play in', () => {
  for (const t of Object.values(data.themes)) {
    const dom = dominant(t);
    assert.ok(dom.sat >= 0.3 && dom.sat <= 0.9, `${t.id}: mean saturation ${dom.sat.toFixed(2)}`);
    const [, ts, tv] = hsv(t.tint);
    assert.ok(ts >= 0.25 && ts <= 0.8, `${t.id}: tint saturation ${ts.toFixed(2)}`);
    assert.ok(tv >= 0.8, `${t.id}: tint value ${tv.toFixed(2)} would darken the room`);
    const [, as, av] = hsv(t.lighting.ambient);
    assert.ok(as >= 0.35 && as <= 0.9 && av >= 0.34 && av <= 0.8, `${t.id}: ambient s ${as.toFixed(2)} v ${av.toFixed(2)}`);
    const [, fs, fv] = hsv(t.lighting.fogColor);
    assert.ok(fs >= 0.3 && fv >= 0.05 && fv <= 0.22, `${t.id}: fog s ${fs.toFixed(2)} v ${fv.toFixed(2)}`);
    const [, ls, lv] = hsv(t.lighting.light);
    assert.ok(ls >= 0.25 && lv >= 0.6, `${t.id}: light s ${ls.toFixed(2)} v ${lv.toFixed(2)}`);
  }
});
