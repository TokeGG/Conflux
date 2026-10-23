// Where a spell leaves the caster: the casting hand, a point beside and in front of the feet (player.json castOrigin).
import { v3, type Vec3 } from '../math.ts';

export interface CastOrigin {
  forward: number;
  right: number;
  up: number;
}

/** The hand's world position for a caster at `feet` looking along `facing` (yaw; forward is (sin, cos), the character's right is (-cos, sin)). */
export function castOriginAt(feet: Vec3, facing: number, o: CastOrigin): Vec3 {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  return { x: feet.x + s * o.forward - c * o.right, y: feet.y + o.up, z: feet.z + c * o.forward + s * o.right };
}

/** The direction from the hand at the aim point (so the shot lands on the crosshair). An aim point that is not ahead of the hand (a wall against the camera) would send the shot backwards or sideways: it goes along the facing, tilted toward the point's height. */
export function shotDirection(origin: Vec3, aim: Vec3, facing: number): Vec3 {
  const to = v3.sub(aim, origin);
  const ahead = to.x * Math.sin(facing) + to.z * Math.cos(facing);
  if (ahead > 0.3) return v3.norm(to);
  return v3.norm({ x: Math.sin(facing), y: Math.max(-0.5, Math.min(0.5, to.y)), z: Math.cos(facing) });
}
