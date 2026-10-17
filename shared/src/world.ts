// Static level geometry the simulation collides with: boxes and vertical cylinders plus a flat ground plane.
import { type Vec3, v3, rayVsBox } from './math.ts';

/** A box, or a vertical cylinder whose axis is the box's xz centre and whose radius is half its x width. */
export interface Collider {
  kind: 'box' | 'cyl';
  min: Vec3;
  max: Vec3;
}

export interface RayHit {
  t: number;
  point: Vec3;
  collider: Collider | null;
}

/** A character's body for `blocked`: a vertical cylinder this tall standing on the given position. */
export const BODY_HEIGHT = 1.8;

function rayVsCylinder(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const r = (max.x - min.x) / 2;
  const ox = o.x - cx;
  const oz = o.z - cz;
  const inside = ox * ox + oz * oz <= r * r && o.y >= min.y && o.y <= max.y;
  if (inside) return 0;
  let best: number | null = null;
  const consider = (t: number) => {
    if (t >= 0 && (best === null || t < best)) best = t;
  };
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = o.y + t * d.y;
      if (y >= min.y && y <= max.y) consider(t);
    }
  }
  if (Math.abs(d.y) > 1e-12) {
    for (const py of [min.y, max.y]) {
      const t = (py - o.y) / d.y;
      const x = ox + t * d.x;
      const z = oz + t * d.z;
      if (x * x + z * z <= r * r) consider(t);
    }
  }
  return best;
}

const rayVsCollider = (c: Collider, o: Vec3, d: Vec3): number | null => (c.kind === 'box' ? rayVsBox(o, d, c.min, c.max) : rayVsCylinder(o, d, c.min, c.max));

/** The same collider grown by r on every side (used to sweep a sphere as a ray). */
function inflate(c: Collider, r: number): Collider {
  return { kind: c.kind, min: { x: c.min.x - r, y: c.min.y - r, z: c.min.z - r }, max: { x: c.max.x + r, y: c.max.y + r, z: c.max.z + r } };
}

export class World {
  constructor(
    readonly colliders: readonly Collider[],
    readonly groundY = 0,
  ) {}

  raycast(o: Vec3, d: Vec3, maxT: number): RayHit | null {
    let best: { t: number; collider: Collider | null } | null = null;
    for (const c of this.colliders) {
      const t = rayVsCollider(c, o, d);
      if (t !== null && t <= maxT && (best === null || t < best.t)) best = { t, collider: c };
    }
    if (d.y < 0 && o.y > this.groundY) {
      const t = (this.groundY - o.y) / d.y;
      if (t <= maxT && (best === null || t < best.t)) best = { t, collider: null };
    }
    return best && { t: best.t, point: v3.add(o, v3.scale(d, best.t)), collider: best.collider };
  }

  /** Distance along from to to at which a sphere of radius r first touches something, or null if the path is free. */
  sweepSphere(from: Vec3, to: Vec3, r: number): number | null {
    const delta = v3.sub(to, from);
    const length = v3.len(delta);
    if (length < 1e-12) return null;
    const d = v3.scale(delta, 1 / length);
    let best: number | null = null;
    for (const c of this.colliders) {
      const t = rayVsCollider(inflate(c, r), from, d);
      if (t !== null && t <= length && (best === null || t < best)) best = t;
    }
    const floor = this.groundY + r;
    if (d.y < 0 && from.y > floor) {
      const t = (floor - from.y) / d.y;
      if (t <= length && (best === null || t < best)) best = t;
    }
    return best;
  }

  /** True when a body of radius r standing with its feet at p overlaps a collider. */
  blocked(p: Vec3, r: number): boolean {
    const top = p.y + BODY_HEIGHT;
    for (const c of this.colliders) {
      if (c.max.y <= p.y || c.min.y >= top) continue;
      if (c.kind === 'box') {
        const dx = Math.max(c.min.x - p.x, 0, p.x - c.max.x);
        const dz = Math.max(c.min.z - p.z, 0, p.z - c.max.z);
        if (dx * dx + dz * dz < r * r) return true;
      } else {
        const cx = (c.min.x + c.max.x) / 2;
        const cz = (c.min.z + c.max.z) / 2;
        const reach = (c.max.x - c.min.x) / 2 + r;
        if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < reach * reach) return true;
      }
    }
    return false;
  }

  groundAt(_x: number, _z: number): number {
    return this.groundY;
  }
}
