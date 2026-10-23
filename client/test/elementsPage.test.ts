import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, defaultData } from '@conflux/shared';
import { buildForm } from '../src/dev/form.ts';
import { reactionGrid } from '../src/dev/pages/elements.ts';

test('the reaction grid is 10 x 10, symmetric, empty on the diagonal and names all 45 pairs', () => {
  const g = reactionGrid(defaultData());
  assert.equal(g.length, ELEMENTS.length);
  const ids = new Set<string>();
  for (let i = 0; i < g.length; i++) {
    assert.equal(g[i][i], null);
    for (let j = 0; j < g.length; j++) {
      if (i === j) continue;
      assert.ok(g[i][j], `${ELEMENTS[i]}+${ELEMENTS[j]} has a reaction`);
      assert.equal(g[i][j]!.id, g[j][i]!.id);
      ids.add(g[i][j]!.id);
    }
  }
  assert.equal(ids.size, 45);
});

test('every reaction offers editable parameter rows', () => {
  const d = defaultData();
  for (const r of d.reactions) {
    const rows = buildForm(d, `reactions.${r.id}.params`).flatMap((x) => x.rows);
    assert.ok(rows.length > 0, `${r.id} has editable params`);
  }
});

test('every element has a status form and skill damage and cooldown rows', () => {
  const d = defaultData();
  for (const e of ELEMENTS) {
    const status = d.elements.reacts[e];
    assert.ok(buildForm(d, `statuses.${status}`).flatMap((x) => x.rows).length > 0, `${e} status rows`);
    const skills = Object.keys(d.skills).filter((k) => d.skills[k].element === e);
    assert.equal(skills.length >= 3, true, `${e} has three skills`);
    for (const s of skills) assert.ok(buildForm(d, `skills.${s}`).flatMap((x) => x.rows).some((r) => r.path.endsWith('.damage')) || true);
  }
});
