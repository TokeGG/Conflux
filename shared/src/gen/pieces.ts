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
