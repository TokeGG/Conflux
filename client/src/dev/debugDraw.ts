// Debug lines over the game: enemy hurtboxes and the room's colliders, switched on from the Run tools page.
import * as THREE from 'three';
import { hurtboxesFor, type Collider, type GameData, type Snapshot, type Vec3 } from '@conflux/shared';
import type { DebugFlags } from './tools.ts';

const RING = 16;

/** The 12 edges of a box as a flat list of segment end points (x y z, x y z, ...). */
export function boxLines(min: Vec3, max: Vec3): number[] {
  const c = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, min.y, max.z], [min.x, min.y, max.z],
    [min.x, max.y, min.z], [max.x, max.y, min.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return edges.flatMap(([a, b]) => [...c[a], ...c[b]]);
}

/** A ring at each end of the capsule and four struts between them. */
export function capsuleLines(a: Vec3, b: Vec3, r: number): number[] {
  const out: number[] = [];
  for (const end of [a, b]) {
    for (let i = 0; i < RING; i++) {
      const t0 = (i / RING) * Math.PI * 2;
      const t1 = ((i + 1) / RING) * Math.PI * 2;
      out.push(end.x + Math.cos(t0) * r, end.y, end.z + Math.sin(t0) * r, end.x + Math.cos(t1) * r, end.y, end.z + Math.sin(t1) * r);
    }
  }
  for (let k = 0; k < 4; k++) {
    const t = (k / 4) * Math.PI * 2;
    const dx = Math.cos(t) * r;
    const dz = Math.sin(t) * r;
    out.push(a.x + dx, a.y, a.z + dz, b.x + dx, b.y, b.z + dz);
  }
  return out;
}

const cylinderLines = (min: Vec3, max: Vec3): number[] => {
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const r = (max.x - min.x) / 2;
  return capsuleLines({ x: cx, y: min.y, z: cz }, { x: cx, y: max.y, z: cz }, r);
};

export class DebugDraw {
  private hurt = this.makeLines(0xff7a30);
  private world = this.makeLines(0x4ad0ff);
  private worldBuilt = false;

  constructor(
    scene: THREE.Scene,
    private data: () => GameData,
    private colliders: Collider[],
  ) {
    scene.add(this.hurt, this.world);
  }

  private makeLines(color: number): THREE.LineSegments {
    const l = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    l.frustumCulled = false;
    l.renderOrder = 20;
    l.visible = false;
    return l;
  }

  private set(l: THREE.LineSegments, pts: number[]): void {
    l.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  update(s: Snapshot, flags: DebugFlags): void {
    this.hurt.visible = flags.hurtboxes;
    if (flags.hurtboxes) {
      const pts: number[] = [];
      for (const e of s.enemies) {
        const def = this.data().enemies[e.defId];
        if (!def) continue;
        for (const h of hurtboxesFor(def, e.pos, e.facing, e.id)) pts.push(...capsuleLines(h.a, h.b, h.r));
      }
      this.set(this.hurt, pts);
    }
    this.world.visible = flags.colliders;
    if (flags.colliders && !this.worldBuilt) {
      this.worldBuilt = true;
      this.set(this.world, this.colliders.flatMap((c) => (c.kind === 'box' ? boxLines(c.min, c.max) : cylinderLines(c.min, c.max))));
    }
  }
}
