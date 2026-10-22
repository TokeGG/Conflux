// What a quiet room adds to the scene: a pedestal with a glowing gem at every stall, the shop's keeper, and the stairs down at the
// gates of a floor's last room. Plain boxes and cylinders, built from the plan; nothing here decides anything.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { RoomPlan, Ware } from '@conflux/shared';
import type { AssetLoader } from '../assets/loader.ts';
import { fitHeight } from './scene.ts';

const GEM: Record<string, number> = { skill: 0xff9a3c, augment: 0xb98cff, heal: 0x6fe39a, element: 0x4aa8ff, boon: 0xffd86a, trade: 0xff5a4a, rest: 0x6fe39a };

export class QuietView {
  private group = new THREE.Group();
  private gems: THREE.Mesh[] = [];
  private keeper: THREE.Object3D | null = null;
  private token = 0;

  constructor(
    private scene: THREE.Scene,
    private loader: AssetLoader,
  ) {
    scene.add(this.group);
  }

  clear(): void {
    this.token++;
    this.group.clear();
    this.gems = [];
    this.keeper = null;
  }

  /** Sets out the stalls (and the keeper, and the stairs) of the plan. */
  set(plan: RoomPlan): void {
    this.clear();
    (plan.stalls ?? []).forEach((s) => {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.9 }));
      base.position.set(s.x, 0.45, s.z);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      gem.position.set(s.x, 1.25, s.z);
      this.group.add(base, gem);
      this.gems.push(gem);
    });
    if (plan.stairs) {
      for (const d of plan.def?.spawns.doors ?? []) {
        for (let k = 0; k < 4; k++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(2.4 - k * 0.3, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x24242c, emissive: 0x331a08, roughness: 1 }));
          step.position.set(d.x, 0.06, d.z + (k - 1.5) * 0.35);
          this.group.add(step);
        }
      }
    }
    if (plan.keeper) void this.addKeeper(plan.keeper, this.token);
  }

  private async addKeeper(at: { x: number; z: number }, token: number): Promise<void> {
    try {
      const gltf = await this.loader.loadModel('model.keeper');
      if (token !== this.token) return;
      const model = cloneSkinned(gltf.scene);
      fitHeight(model, 1.8);
      model.position.set(at.x, 0, at.z);
      this.keeper = model;
      this.group.add(model);
    } catch {
      /* no model: the stalls still work */
    }
  }

  /** Colours the gems by what lies on the stall (grey once taken) and makes them turn. */
  update(wares: readonly Ware[], time: number, player: { x: number; z: number } | null): void {
    this.gems.forEach((g, i) => {
      const w = wares[i];
      (g.material as THREE.MeshBasicMaterial).color.setHex(!w || w.sold ? 0x444444 : (GEM[w.kind] ?? 0xffffff));
      g.rotation.y = time * 1.5;
      g.position.y = 1.25 + Math.sin(time * 2 + i) * 0.06;
    });
    if (this.keeper && player) this.keeper.rotation.y = Math.atan2(player.x - this.keeper.position.x, player.z - this.keeper.position.z);
  }
}
