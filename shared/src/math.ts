// Vector maths and analytic ray tests. Rays take a unit direction and return the distance t >= 0 of the first hit, or null.

export type Vec3 = { x: number; y: number; z: number };

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  /** Unit vector; the zero vector stays zero (never NaN). */
  norm(a: Vec3): Vec3 {
    const l = Math.hypot(a.x, a.y, a.z);
    return l < 1e-12 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
};

/** Yaw 0 faces +Z and a positive yaw turns toward +X; a positive pitch looks up. */
export function aimDir(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

export function rayVsSphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const oc = v3.sub(o, c);
  const b = v3.dot(oc, d);
  const k = v3.dot(oc, oc) - r * r;
  if (k <= 0) return 0; // origin inside
  const h = b * b - k;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : null;
}

function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = v3.sub(b, a);
  const l2 = v3.dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ab) / l2));
  return v3.len(v3.sub(p, v3.add(a, v3.scale(ab, t))));
}

export function rayVsCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number): number | null {
  if (distPointSegment(o, a, b) <= r) return 0;
  const ba = v3.sub(b, a);
  const baba = v3.dot(ba, ba);
  if (baba < 1e-12) return rayVsSphere(o, d, a, r);
  const oa = v3.sub(o, a);
  const bard = v3.dot(ba, d);
  const baoa = v3.dot(ba, oa);
  const A = baba - bard * bard;
  const B = baba * v3.dot(d, oa) - baoa * bard;
  const C = baba * v3.dot(oa, oa) - baoa * baoa - r * r * baba;
  const h = B * B - A * C;
  if (A > 1e-12 && h >= 0) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (t >= 0 && y > 0 && y < baba) return t;
  }
  const t1 = rayVsSphere(o, d, a, r);
  const t2 = rayVsSphere(o, d, b, r);
  if (t1 === null) return t2;
  if (t2 === null) return t1;
  return Math.min(t1, t2);
}

export function rayVsBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - o[k]) / d[k];
    let t2 = (max[k] - o[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tNear = Math.max(tNear, t1);
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) return null;
  }
  if (tFar < 0) return null;
  return Math.max(0, tNear);
}
