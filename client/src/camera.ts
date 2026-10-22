// Over-the-shoulder camera. It sits behind and to the right of the character and moves closer when a wall is in the way.
// Every number comes from camera.json (the game data), read on each call, so the dev panel changes it live.
import { aimDir, v3, type CameraCfg, type Vec3, type World } from '@conflux/shared';

/** The field of view the player's own setting is measured from: 55 changes nothing. */
export const NEUTRAL_FOV = 55;

/** The lens angle: the data's field of view moved up or down by how far the player's setting is from 55. */
export const effectiveFov = (settingFov: number, dataFov: number): number => Math.min(120, Math.max(20, dataFov + (settingFov - NEUTRAL_FOV)));

/** Moves `current` toward `target` by the share of the gap that `rate` per second gives in `dt`; a rate of 0 is rigid (it lands on the target). */
export const smoothTo = (current: number, target: number, rate: number, dt: number): number => (rate <= 0 ? target : current + (target - current) * (1 - Math.exp(-rate * dt)));

export class ThirdPersonCamera {
  private smoothed: Vec3 | null = null;

  constructor(
    private world: World,
    private cfg: () => CameraCfg,
  ) {}

  /** `dt` (seconds) only matters when the data asks for smoothing; without it the camera is rigid. */
  update(player: Vec3, yaw: number, pitch: number, dt = 0): { origin: Vec3; yaw: number; pitch: number } {
    const c = this.cfg();
    const pivot = { x: player.x, y: player.y + c.height, z: player.z };
    const forward = aimDir(yaw, pitch);
    const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    const shoulderPoint = v3.add(pivot, v3.scale(right, c.shoulder));
    const wanted = v3.add(shoulderPoint, v3.scale(forward, -c.distance));
    const hit = this.world.sweepSphere(shoulderPoint, wanted, c.collisionRadius);
    const goal = hit === null ? wanted : v3.add(shoulderPoint, v3.scale(v3.norm(v3.sub(wanted, shoulderPoint)), Math.max(0, hit)));
    if (c.followRate <= 0 || !this.smoothed || dt <= 0) {
      this.smoothed = goal;
      return { origin: goal, yaw, pitch };
    }
    const s = this.smoothed;
    // a wall pulling the camera in is never smoothed (the lens must not sit in the wall); everything else catches up
    const pulledIn = hit !== null;
    const origin = pulledIn ? goal : { x: smoothTo(s.x, goal.x, c.followRate, dt), y: smoothTo(s.y, goal.y, c.followRate, dt), z: smoothTo(s.z, goal.z, c.followRate, dt) };
    this.smoothed = origin;
    return { origin, yaw, pitch };
  }
}
