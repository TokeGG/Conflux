// The shape of a generated room: cells on a 4 m grid (a rectangle, sometimes with one corner block cut away), the edges where
// the floor ends, and which of those edges become exits.
import type { Rng } from '../rng.ts';
import type { ThemeDef } from '../types.ts';

export const CELL = 4;

export interface Footprint {
  cw: number;
  cd: number;
  cells: [number, number][];
  solid(i: number, j: number): boolean;
  /** World x and z of a cell's centre. */
  cx(i: number): number;
  cz(j: number): number;
}

export interface Edge {
  /** World position of the middle of the edge. */
  x: number;
  z: number;
  /** Outward direction (one of the four axis directions). */
  nx: number;
  nz: number;
  i: number;
  j: number;
}

export function makeFootprint(rng: Rng, theme: ThemeDef): Footprint {
  const [lo, hi] = theme.cells;
  const cw = lo + rng.int(hi - lo + 1);
  const cd = lo + rng.int(hi - lo + 1);
  let cut: { right: boolean; top: boolean; w: number; d: number } | null = null;
  if (rng.next() < theme.cutChance) cut = { right: rng.next() < 0.5, top: rng.next() < 0.5, w: 2 + rng.int(Math.max(1, Math.floor(cw / 2) - 1)), d: 2 + rng.int(Math.max(1, Math.floor(cd / 2) - 1)) };
  const cut_ = (i: number, j: number) => !!cut && (cut.right ? i >= cw - cut.w : i < cut.w) && (cut.top ? j >= cd - cut.d : j < cut.d);
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < cw && j < cd && !cut_(i, j);
  const cells: [number, number][] = [];
  for (let i = 0; i < cw; i++) for (let j = 0; j < cd; j++) if (solid(i, j)) cells.push([i, j]);
  return { cw, cd, cells, solid, cx: (i) => -(cw * CELL) / 2 + CELL / 2 + i * CELL, cz: (j) => -(cd * CELL) / 2 + CELL / 2 + j * CELL };
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Every side of a floor cell that has no floor beyond it. */
export function boundaryEdges(fp: Footprint): Edge[] {
  const out: Edge[] = [];
  for (const [i, j] of fp.cells) {
    for (const [nx, nz] of DIRS) if (!fp.solid(i + nx, j + nz)) out.push({ x: fp.cx(i) + (nx * CELL) / 2, z: fp.cz(j) + (nz * CELL) / 2, nx, nz, i, j });
  }
  return out;
}

/** 1 to 3 exits on straight stretches of wall (never at a corner), at least 8 m apart. */
export function pickExits(rng: Rng, fp: Footprint, edges: Edge[]): Edge[] {
  // an edge is mid-wall when the cells on both sides of it along the wall are floor too
  const mid = edges.filter((e) => {
    const [tx, tz] = [Math.abs(e.nz), Math.abs(e.nx)];
    return fp.solid(e.i + tx, e.j + tz) && fp.solid(e.i - tx, e.j - tz);
  });
  const pool = mid.length ? mid : edges;
  const want = 1 + rng.int(3);
  const out: Edge[] = [pool[rng.int(pool.length)]];
  for (let tries = 0; out.length < want && tries < 60; tries++) {
    const c = pool[rng.int(pool.length)];
    if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= 8)) out.push(c);
  }
  return out;
}
