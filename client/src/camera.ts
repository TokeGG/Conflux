// Over-the-shoulder camera. It sits behind and to the right of the character and moves closer when a wall is in the way.
import { aimDir, v3, type Vec3, type World } from '@conflux/shared';

export class ThirdPersonCamera {
  distance = 4.2;
  shoulder = 0.7;
  height = 1.6;
  private readonly radius = 0.25;

  constructor(private world: World) {}

  update(player: Vec3, yaw: number, pitch: number): { origin: Vec3; yaw: number; pitch: number } {
    const pivot = { x: player.x, y: player.y + this.height, z: player.z };
    const forward = aimDir(yaw, pitch);
    const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    const shoulderPoint = v3.add(pivot, v3.scale(right, this.shoulder));
    const wanted = v3.add(shoulderPoint, v3.scale(forward, -this.distance));
    const hit = this.world.sweepSphere(shoulderPoint, wanted, this.radius);
    const origin = hit === null ? wanted : v3.add(shoulderPoint, v3.scale(v3.norm(v3.sub(wanted, shoulderPoint)), Math.max(0, hit)));
    return { origin, yaw, pitch };
  }
}
