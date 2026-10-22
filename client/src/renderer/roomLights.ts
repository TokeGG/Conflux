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
  /** The boss's own light: one slot reserved out of the cap, dark when no boss is about. */
  readonly aura = new THREE.PointLight(0xffffff, 0, 8, 1.6);
  /** Room lights in the pool: the cap counts the torch and the boss aura too, so eight lights in all. */
  private readonly room: number;
  private lights: LightDef[] = [];

  constructor(
    private scene: THREE.Scene,
    cap = 8,
  ) {
    this.room = Math.max(0, cap - 2);
    for (let i = 0; i < this.room; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 10, 1.6);
      this.pool.push(p);
      scene.add(p);
    }
    scene.add(this.torch);
    this.aura.visible = false;
    scene.add(this.aura);
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

  /** Lights the reserved slot on a boss (colour, brightness and reach come from its aura), or darkens it with null. */
  setAura(a: { x: number; y: number; z: number; color: string; intensity: number; radius: number } | null): void {
    this.aura.visible = !!a;
    if (!a) {
      this.aura.intensity = 0;
      return;
    }
    this.aura.position.set(a.x, a.y, a.z);
    this.aura.color.set(a.color);
    this.aura.intensity = a.intensity;
    this.aura.distance = a.radius;
  }

  update(time: number, player: Vec3 | null): void {
    const from = player ?? { x: 0, y: 0, z: 0 };
    if (player) this.torch.position.set(player.x, 2.4, player.z - 0.6);
    this.torch.intensity = flicker(18, time, 0.7);
    const near = pickLights(this.lights, from, this.room);
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
