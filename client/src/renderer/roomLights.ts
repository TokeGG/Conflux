// The lights of a generated room: a small pool of point lights that the nearest sources borrow each frame (so the GPU never draws
// more than the cap, however many braziers a room holds), a flicker, and the player's own torch.
import * as THREE from 'three';
import type { LightDef, Vec3 } from '@conflux/shared';

/** The `cap` lights nearest to a point, nearest first. */
export function pickLights(lights: readonly LightDef[], from: Vec3, cap: number): LightDef[] {
  return lights
    .map((l, i) => ({ l, i, d: Math.hypot(l.x - from.x, l.z - from.z) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, Math.max(0, cap))
    .map((e) => e.l);
}

/** A flame's brightness: between 75% and 100% of the base, wavering at two speeds. */
export function flicker(base: number, t: number, phase: number): number {
  const wave = 0.5 + 0.5 * Math.sin(t * 9 + phase) * Math.sin(t * 4.3 + phase * 2);
  return base * (0.75 + 0.25 * Math.max(0, Math.min(1, wave)));
}

const TORCH = 0xffb060;

export class RoomLights {
  readonly torch = new THREE.PointLight(TORCH, 18, 14, 1.6);
  private pool: THREE.PointLight[] = [];
  private lights: LightDef[] = [];

  constructor(
    private scene: THREE.Scene,
    private cap = 8,
  ) {
    for (let i = 0; i < cap; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      this.pool.push(p);
      scene.add(p);
    }
    scene.add(this.torch);
    this.setRoom([]);
  }

  /** The lights of the room the player is now in. */
  setRoom(lights: readonly LightDef[]): void {
    this.lights = [...lights];
    // an unlit room (an old bright one) draws with none of these, so they cost nothing there
    const lit = this.lights.length > 0;
    for (const p of this.pool) (p.intensity = 0), (p.visible = lit);
    this.torch.visible = lit;
  }

  update(time: number, player: Vec3 | null): void {
    const from = player ?? { x: 0, y: 0, z: 0 };
    if (player) this.torch.position.set(player.x, 2.4, player.z - 0.6);
    this.torch.intensity = flicker(18, time, 0.7);
    const near = pickLights(this.lights, from, this.cap);
    this.pool.forEach((p, i) => {
      const l = near[i];
      if (!l) {
        p.intensity = 0;
        return;
      }
      p.position.set(l.x, l.y, l.z);
      p.color.set(l.color);
      p.distance = l.dist;
      p.intensity = flicker(l.intensity, time, this.lights.indexOf(l) * 1.7);
    });
  }
}
