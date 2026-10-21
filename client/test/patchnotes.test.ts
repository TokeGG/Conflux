import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visiblePatches } from '../src/hud/patchNotes.ts';

const p = (version: string, notes: string[]) => ({ version, date: '2026-10-21', at: '2026-10-21T10:00:00Z', notes });

test('owner and dev tool notes are not shown', () => {
  const out = visiblePatches([p('0.1.3', ['Add your own mobs from the dev panel.', 'Fire spreads between burning enemies.']), p('0.1.2', ['Owner-only tools for training bots.'])]);
  assert.deepEqual(out.map((x) => x.version), ['0.1.3']);
  assert.deepEqual(out[0].notes, ['Fire spreads between burning enemies.']);
});

test('a version with nothing left to show is dropped, and the order is kept', () => {
  const out = visiblePatches([p('0.1.4', ['Six rooms.']), p('0.1.3', ['Dev tools: a new bot switch.']), p('0.1.2', ['Elites.'])]);
  assert.deepEqual(out.map((x) => x.version), ['0.1.4', '0.1.2']);
});

test('the shipped patch list shows no owner or dev tool words', async () => {
  const { default: patches } = await import('../../shared/data/patches.json', { with: { type: 'json' } });
  for (const v of visiblePatches(patches)) for (const n of v.notes) assert.doesNotMatch(n, /dev panel|dev tool|owner|developer/i);
});
