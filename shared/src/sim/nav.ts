// Finding the way round walls and props: a 1 m grid over the room, a breadth-first distance field from the target, and the
// step downhill from where an enemy stands. Pure and deterministic; one field is shared by every enemy chasing the same cell.
import type { World } from '../world.ts';

const CELL = 1;
const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Cells walked ahead along the route, so the heading is smooth instead of cell by cell. */
const LOOKAHEAD = 3;

export class NavGrid {
  private x0 = 0;
  private z0 = 0;
  private w = 0;
  private h = 0;
  private blocked: Uint8Array;
  private dist: Int32Array;
  private target = -1;

  /** `radius` is the body the grid keeps clear: a cell is blocked when a body that wide standing in it would touch something. */
  constructor(readonly world: World, readonly radius = 0.65) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const c of world.colliders) {
      minX = Math.min(minX, c.min.x);
      minZ = Math.min(minZ, c.min.z);
      maxX = Math.max(maxX, c.max.x);
      maxZ = Math.max(maxZ, c.max.z);
    }
    if (!Number.isFinite(minX)) (minX = minZ = -1), (maxX = maxZ = 1);
    this.x0 = Math.floor(minX);
    this.z0 = Math.floor(minZ);
    this.w = Math.ceil(maxX) - this.x0 + 1;
    this.h = Math.ceil(maxZ) - this.z0 + 1;
    this.blocked = new Uint8Array(this.w * this.h);
    this.dist = new Int32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) this.blocked[j * this.w + i] = world.blocked({ x: this.x0 + (i + 0.5) * CELL, y: 0, z: this.z0 + (j + 0.5) * CELL }, radius) ? 1 : 0;
  }

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / CELL);
    const j = Math.floor((z - this.z0) / CELL);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  private centre(cell: number): { x: number; z: number } {
    return { x: this.x0 + ((cell % this.w) + 0.5) * CELL, z: this.z0 + (Math.floor(cell / this.w) + 0.5) * CELL };
  }

  isBlocked(x: number, z: number): boolean {
    const c = this.cellOf(x, z);
    return c < 0 || this.blocked[c] === 1;
  }

  /** The free cell nearest to `cell` within two cells (the cell itself when it is free), or -1. */
  private nearestFree(cell: number): number {
    if (cell >= 0 && !this.blocked[cell]) return cell;
    if (cell < 0) return -1;
    const ci = cell % this.w;
    const cj = Math.floor(cell / this.w);
    let best = -1;
    let bestD = Infinity;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h || this.blocked[j * this.w + i]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) (bestD = d), (best = j * this.w + i);
      }
    }
    return best;
  }

  private fill(target: number): void {
    this.dist.fill(-1);
    this.target = target;
    const queue = new Int32Array(this.w * this.h);
    let head = 0;
    let tail = 0;
    queue[tail++] = target;
    this.dist[target] = 0;
    while (head < tail) {
      const c = queue[head++];
      const ci = c % this.w;
      const cj = Math.floor(c / this.w);
      for (const [di, dj] of NEIGHBOURS) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const n = j * this.w + i;
        if (this.blocked[n] || this.dist[n] >= 0) continue;
        // no cutting a corner: a diagonal step needs both cells beside it free
        if (di !== 0 && dj !== 0 && (this.blocked[cj * this.w + i] || this.blocked[j * this.w + ci])) continue;
        this.dist[n] = this.dist[c] + 1;
        queue[tail++] = n;
      }
    }
  }

  /** The point to walk to from (fx, fz) to get to (tx, tz) round whatever is in the way, or null when there is no route. */
  step(fx: number, fz: number, tx: number, tz: number): { x: number; z: number } | null {
    const target = this.nearestFree(this.cellOf(tx, tz));
    let cell = this.nearestFree(this.cellOf(fx, fz));
    if (target < 0 || cell < 0) return null;
    if (target !== this.target) this.fill(target);
    if (this.dist[cell] < 0) return null;
    for (let s = 0; s < LOOKAHEAD && this.dist[cell] > 0; s++) {
      const ci = cell % this.w;
      const cj = Math.floor(cell / this.w);
      let best = cell;
      for (const [di, dj] of NEIGHBOURS) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const n = j * this.w + i;
        if (this.dist[n] < 0 || this.dist[n] >= this.dist[best]) continue;
        if (di !== 0 && dj !== 0 && (this.blocked[cj * this.w + i] || this.blocked[j * this.w + ci])) continue;
        best = n;
      }
      if (best === cell) break;
      cell = best;
    }
    return this.centre(cell);
  }
}
