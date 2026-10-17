// What the crosshair points at: the nearest of the level and the enemies along the camera ray.
import { aimDir, rayVsCapsule, v3, type Vec3 } from './math.ts';
import type { World } from './world.ts';
import type { HurtCapsule } from './sim/state.ts';

export interface AimResult {
  point: Vec3;
  hitEnemy: number | null;
  hitWorld: boolean;
}

/** Always returns a finite point: where the ray ends at maxRange when it hits nothing. */
export function resolveAim(world: World, hurtboxes: readonly HurtCapsule[], camOrigin: Vec3, yaw: number, pitch: number, maxRange: number): AimResult {
  const d = aimDir(yaw, pitch);
  const wall = world.raycast(camOrigin, d, maxRange);
  let enemyT: number | null = null;
  let enemyId: number | null = null;
  for (const h of hurtboxes) {
    const t = rayVsCapsule(camOrigin, d, h.a, h.b, h.r);
    if (t !== null && t <= maxRange && (enemyT === null || t < enemyT)) {
      enemyT = t;
      enemyId = h.enemyId;
    }
  }
  if (enemyT !== null && (!wall || enemyT < wall.t)) return { point: v3.add(camOrigin, v3.scale(d, enemyT)), hitEnemy: enemyId, hitWorld: false };
  if (wall) return { point: wall.point, hitEnemy: null, hitWorld: true };
  return { point: v3.add(camOrigin, v3.scale(d, maxRange)), hitEnemy: null, hitWorld: false };
}
