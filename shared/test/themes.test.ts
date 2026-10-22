import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData, validateData } from '../src/data.ts';
import { DATA_FILES, defaultData } from '../src/files.ts';
import { USED_PIECES } from '../../scripts/gen-pieces.ts';

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
    for (const [kit, id] of named) assert.ok(USED_PIECES[kit]?.includes(id), `${t.id}: ${kit}/${id} is not in USED_PIECES`);
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
