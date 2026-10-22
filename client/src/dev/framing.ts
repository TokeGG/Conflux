// Where to put a viewer camera so a whole model is in view. Pure.
export interface BoxLike {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface Framing {
  /** The point to look at (the middle of the box). */
  target: { x: number; y: number; z: number };
  /** How far the camera sits from the target to see the whole box. */
  distance: number;
}

/** The camera distance at which a sphere around the box fits both the vertical and the horizontal field of view, with a margin. */
export function frameBox(box: BoxLike, fovDeg: number, aspect: number, margin = 1.2): Framing {
  const target = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  const radius = Math.max(0.05, Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2);
  const vHalf = Math.tan((fovDeg * Math.PI) / 360);
  const hHalf = vHalf * Math.max(0.2, aspect);
  return { target, distance: (radius * margin) / Math.min(vHalf, hHalf) };
}
