// Procedural props: furniture and heaps built from coloured boxes, so a theme can have things the model kits lack (a bookshelf, a bone pile,
// cell bars). The boxes live in shared/data/proc.json (written by scripts/gen-pieces.ts from scripts/proc-defs.ts); the room generator places
// them as pieces of the kit `proc`, the colliders come from their bounds, and the client builds the meshes from the same boxes.
import proc from '../../data/proc.json' with { type: 'json' };

/** The kit name of procedural pieces in a room's piece list. */
export const PROC_KIT = 'proc';

/** One box: the corner with the smallest coordinates (x, y, z), the size (w, h, d), a colour, and 1 when the wood texture is laid over it. */
export type ProcBox = [number, number, number, number, number, number, string, 0 | 1];
export interface ProcDef {
  boxes: ProcBox[];
}

export const PROC_PIECES = proc as unknown as Record<string, ProcDef>;

export const isProc = (kit: string): boolean => kit === PROC_KIT;

/** The bounds of a procedural piece, from its boxes (the same shape as an environment index item). */
export function procBounds(def: ProcDef): { size: [number, number, number]; min: [number, number, number] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of def.boxes) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b[a] as number);
      hi[a] = Math.max(hi[a], (b[a] as number) + (b[a + 3] as number));
    }
  }
  const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;
  return { size: [r3(hi[0] - lo[0]), r3(hi[1] - lo[1]), r3(hi[2] - lo[2])], min: [r3(lo[0]), r3(lo[1]), r3(lo[2])] };
}
