import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData } from '@conflux/shared';
import { guideRows, guideMatrix, filterGuide, heldPairs } from '../src/hud/reactionGuide.ts';

const data = defaultData();
const order = data.elements.order as string[];

test('all 45 pairs appear exactly once, each with a name and a description', () => {
  const rows = guideRows(data);
  assert.equal(rows.length, 45);
  assert.equal(new Set(rows.map((r) => [r.a, r.b].sort().join('|'))).size, 45);
  for (const r of rows) {
    assert.ok(r.name.trim().length > 0, r.id);
    assert.ok(r.text.trim().length > 10, `${r.id} needs a description`);
  }
});

test('the matrix is 10 x 10, symmetric, with a reaction off the diagonal only', () => {
  const m = guideMatrix(data);
  assert.equal(m.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(m[i].length, 10);
    for (let j = 0; j < 10; j++) {
      if (i === j) assert.equal(m[i][j], null);
      else assert.equal(m[i][j], m[j][i]);
    }
  }
});

test('filtering by an element gives the 9 reactions it takes part in, with the partner', () => {
  for (const el of order) {
    const rows = filterGuide(guideRows(data), { element: el });
    assert.equal(rows.length, 9, el);
    for (const r of rows) assert.notEqual(r.partner(el), el);
  }
});

test('search matches the name, the description or an element, ignoring case', () => {
  const all = guideRows(data);
  assert.ok(filterGuide(all, { query: 'STEAM' }).some((r) => r.id === 'steam'));
  assert.equal(filterGuide(all, { query: '' }).length, 45);
  assert.equal(filterGuide(all, { query: 'zzzz-nothing' }).length, 0);
  assert.ok(filterGuide(all, { element: 'fire', query: 'water' }).length >= 1);
});

test('heldPairs marks the reactions whose both elements are held', () => {
  const rows = guideRows(data);
  const held = heldPairs(rows, ['fire', 'water', 'earth']);
  assert.deepEqual([...held].sort(), ['magma', 'mud', 'steam']);
  assert.equal(heldPairs(rows, []).size, 0);
});
