import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { USED_PIECES, buildPieces } from '../../scripts/gen-pieces.ts';
import { pieceBounds } from '../src/gen/pieces.ts';
import { slugId } from '../src/assets.ts';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const manifest = new Set<string>((json('../../client/public/assets/assets.json') as { id: string }[]).map((a) => a.id));

test('every piece the generator may use has bounds and a model in the manifest, cave kit included', () => {
  const kits = Object.keys(USED_PIECES);
  assert.ok(kits.includes('cave') && kits.includes('dungeon') && kits.includes('graveyard') && kits.includes('nature'));
  for (const [kit, ids] of Object.entries(USED_PIECES)) {
    for (const id of ids) {
      const b = pieceBounds(kit, id);
      assert.ok(b.size.every((v) => v >= 0) && b.size.some((v) => v > 0), `${kit}/${id} bounds`);
      assert.ok(manifest.has(`env.${kit}.${slugId(id)}`), `${kit}/${id} is in the manifest`);
    }
  }
});

test('pieceBounds refuses a piece it does not know', () => {
  assert.throws(() => pieceBounds('dungeon', 'no-such-piece'), /no-such-piece/);
});

test('shared/data/pieces.json is up to date with the environment index', () => {
  assert.deepEqual(json('../data/pieces.json'), buildPieces(json('../../client/public/assets/env/index.json')));
});
