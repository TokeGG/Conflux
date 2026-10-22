// The movable parts of the mob models that are made of pieces or have bones, and how an attack pose moves them.
// Models with neither are moved as a whole body by EnemyView. The numbers are exported so the dev panel can edit them.
import * as THREE from 'three';
import type { AttackPose } from './attackAnim.ts';

/** The reaper's scythe is eight loose meshes (a blade, a collar and a shaft) that swing together about the grip. */
export const REAPER_RIG = {
  model: 'model.reaper',
  scytheMeshes: ['Object_16', 'Object_17', 'Object_18', 'Object_19', 'Object_20', 'Object_21', 'Object_22', 'Object_23'],
  /** The grip, in the model's own units. */
  pivot: [-1.3, 0.5, 0] as [number, number, number],
  /** Radians of scythe swing per unit of the pose's weapon channel. */
  gain: 1,
};

/** The books: covers and pages open outward, pages spin. */
export const BOOK_RIG = {
  model: 'model.book',
  coverOpen: 0.55,
  pagesOpen: 0.75,
  pageSpin: 1,
};

/** Skinned mixamo rigs without an attack clip (the elementals, the wraith, the Maw) get their arms and spine driven by bone. */
export const BONE_RIG = {
  armR: 'mixamorigRightArm',
  armL: 'mixamorigLeftArm',
  spine: 'mixamorigSpine1',
  head: 'mixamorigHead',
  /** Axis, sign and strength with which the pose's arm channels turn a bone. */
  armRaise: { axis: 'x' as 'x' | 'y' | 'z', gain: 1 },
  armSpread: { axis: 'z' as 'x' | 'y' | 'z', gain: 1 },
  /** Spine bend per unit of the pose's tilt, and twist per unit of its yaw. */
  spineTilt: 0.5,
  spineTwist: 0.6,
  headTilt: 0.3,
};

interface BoneDrive {
  bone: THREE.Object3D;
  kind: 'armR' | 'armL' | 'spine' | 'head';
}

export interface RigParts {
  /** The pivot the scythe hangs from, when the model has one. */
  weapon: THREE.Group | null;
  book: { covers: THREE.Object3D[]; pages: THREE.Object3D[]; baseRot: Map<THREE.Object3D, THREE.Euler> } | null;
  bones: BoneDrive[];
}

/** Makes the scythe pivot for a reaper model: its meshes move into a group at the grip, and the group is what swings. Call before collecting parts. */
export function makeScythePivot(model: THREE.Object3D): THREE.Group | null {
  const meshes = REAPER_RIG.scytheMeshes.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (!meshes.length) return null;
  const pivot = new THREE.Group();
  pivot.name = 'scythe_pivot';
  pivot.position.fromArray(REAPER_RIG.pivot);
  model.add(pivot);
  for (const m of meshes) {
    pivot.add(m);
    m.position.sub(pivot.position);
  }
  return pivot;
}

/** Finds what an attack can move on this model. `animated` names the bones that the model's own clips already drive (only those are safe to add to). */
export function findRigParts(model: THREE.Object3D, modelId: string, weapon: THREE.Group | null, clips: THREE.AnimationClip[]): RigParts {
  const parts: RigParts = { weapon, book: null, bones: [] };
  if (modelId === BOOK_RIG.model) {
    const get = (n: string) => model.getObjectByName(n);
    const covers = [get('cover_left'), get('cover_right')].filter((o): o is THREE.Object3D => !!o);
    const pages = [get('pages_left'), get('pages_right')].filter((o): o is THREE.Object3D => !!o);
    const baseRot = new Map<THREE.Object3D, THREE.Euler>();
    for (const o of [...covers, ...pages]) baseRot.set(o, o.rotation.clone());
    parts.book = { covers, pages, baseRot };
  }
  const animated = (name: string) => clips.some((c) => c.tracks.some((t) => t.name.startsWith(`${name}.`)));
  const add = (name: string, kind: BoneDrive['kind']) => {
    const bone = model.getObjectByName(name);
    if (bone && animated(name)) parts.bones.push({ bone, kind });
  };
  add(BONE_RIG.armR, 'armR');
  add(BONE_RIG.armL, 'armL');
  add(BONE_RIG.spine, 'spine');
  add(BONE_RIG.head, 'head');
  return parts;
}

const eul = new THREE.Euler();
const quat = new THREE.Quaternion();

function turn(bone: THREE.Object3D, x: number, y: number, z: number): void {
  quat.setFromEuler(eul.set(x, y, z));
  bone.quaternion.multiply(quat);
}

/**
 * Lays an attack pose on the parts. Bones are added to after the mixer has written them this frame; the scythe and the book parts are set
 * from their rest values. `weight` fades the pose in and out (1 is the full pose).
 */
export function poseRig(parts: RigParts, pose: AttackPose, weight: number): void {
  if (parts.weapon) parts.weapon.rotation.set(pose.weapon * REAPER_RIG.gain * weight, 0, 0);
  if (parts.book) {
    const o = pose.open * weight;
    parts.book.covers.forEach((c, i) => {
      const base = parts.book!.baseRot.get(c)!;
      c.rotation.set(base.x, base.y, base.z + (i === 0 ? 1 : -1) * o * BOOK_RIG.coverOpen);
    });
    parts.book.pages.forEach((p, i) => {
      const base = parts.book!.baseRot.get(p)!;
      p.rotation.set(base.x, base.y + pose.spin * BOOK_RIG.pageSpin * weight * (i === 0 ? 1 : -1), base.z + (i === 0 ? 1 : -1) * o * BOOK_RIG.pagesOpen);
    });
  }
  const R = BONE_RIG;
  for (const { bone, kind } of parts.bones) {
    const v = [0, 0, 0] as [number, number, number];
    const idx = (a: 'x' | 'y' | 'z') => (a === 'x' ? 0 : a === 'y' ? 1 : 2);
    if (kind === 'armR' || kind === 'armL') {
      const right = kind === 'armR';
      const raise = (right ? pose.armRx : pose.armLx) * R.armRaise.gain * weight;
      const spread = (right ? pose.armRz : pose.armLz) * R.armSpread.gain * weight;
      v[idx(R.armRaise.axis)] += raise;
      v[idx(R.armSpread.axis)] += right ? spread : -spread;
    } else if (kind === 'spine') {
      v[0] = pose.tilt * R.spineTilt * weight;
      v[1] = pose.yaw * R.spineTwist * weight;
    } else {
      v[0] = pose.tilt * R.headTilt * weight;
    }
    turn(bone, v[0], v[1], v[2]);
  }
}
