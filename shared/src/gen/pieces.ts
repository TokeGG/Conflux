// Bounds of the kit pieces the room generator places. The data is built by scripts/gen-pieces.ts from the environment index.
import pieces from '../../data/pieces.json' with { type: 'json' };

export interface Bounds {
  size: [number, number, number];
  min: [number, number, number];
}

export function pieceBounds(kit: string, id: string): Bounds {
  const b = (pieces as unknown as Record<string, Record<string, Bounds>>)[kit]?.[id];
  if (!b) throw new Error(`no bounds for piece ${kit}/${id}`);
  return b;
}

import type { EnvIndex } from '../room.ts';

/** The generator's pieces in the shape `genColliders` reads. */
export function envIndexFromPieces(): EnvIndex {
  const out: EnvIndex = {};
  for (const [kit, items] of Object.entries(pieces as unknown as Record<string, Record<string, Bounds>>)) {
    out[kit] = { title: kit, license: 'CC0', items: Object.entries(items).map(([id, b]) => ({ id, size: b.size, min: b.min, tris: 0 })) };
  }
  return out;
}
