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
  foreR: 'mixamorigRightForeArm',
  foreL: 'mixamorigLeftForeArm',
  /**
   * Strength of the pose's raise and spread on the arms. The pose is worked out in the MODEL's axes (it faces +z, +y up: x swings an arm forward,
   * z spreads it, y twists the spine) and converted into each bone's frame, because the rigs rest differently: the elementals and the wraith hang
   * their arms, the Maw holds a rolled T-pose with quarter-turn shoulders, so no one local axis suits them all.
   */
  armRaiseGain: 1,
  armSpreadGain: 1,
  /** Spine bend per unit of the pose's tilt, and twist per unit of its yaw. */
  spineTilt: 0.5,
  spineTwist: 0.6,
  headTilt: 0.3,
};

interface BoneDrive {
  bone: THREE.Object3D;
  kind: 'armR' | 'armL' | 'spine' | 'head';
  /** An arm's forearm: the direction from the bone to it is the direction of the arm. */
  child?: THREE.Object3D;
}

export interface RigParts {
  /** The pivot the scythe hangs from, when the model has one. */
  weapon: THREE.Group | null;
  book: { covers: THREE.Object3D[]; pages: THREE.Object3D[]; baseRot: Map<THREE.Object3D, THREE.Euler> } | null;
  /** In the order they are driven: the spine first, then the arms and the head that ride on it. */
  bones: BoneDrive[];
  /** The model the bones belong to; poses are worked out in its frame. */
  root: THREE.Object3D;
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
  const parts: RigParts = { weapon, book: null, bones: [], root: model };
  if (modelId === BOOK_RIG.model) {
    const get = (n: string) => model.getObjectByName(n);
    const covers = [get('cover_left'), get('cover_right')].filter((o): o is THREE.Object3D => !!o);
    const pages = [get('pages_left'), get('pages_right')].filter((o): o is THREE.Object3D => !!o);
    const baseRot = new Map<THREE.Object3D, THREE.Euler>();
    for (const o of [...covers, ...pages]) baseRot.set(o, o.rotation.clone());
    parts.book = { covers, pages, baseRot };
  }
  const animated = (name: string) => clips.some((c) => c.tracks.some((t) => t.name.startsWith(`${name}.`)));
  const add = (name: string, kind: BoneDrive['kind'], child?: string) => {
    const bone = model.getObjectByName(name);
    if (bone && animated(name)) parts.bones.push({ bone, kind, child: child ? model.getObjectByName(child) ?? undefined : undefined });
  };
  // the spine first: the arms and the head ride on it, so they are worked out after it has turned
  add(BONE_RIG.spine, 'spine');
  add(BONE_RIG.armR, 'armR', BONE_RIG.foreR);
  add(BONE_RIG.armL, 'armL', BONE_RIG.foreL);
  add(BONE_RIG.head, 'head');
  return parts;
}

const eul = new THREE.Euler();
const HANG = new THREE.Vector3(0, -1, 0);
const tmpQ = new THREE.Quaternion();
const modelQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const conj = new THREE.Quaternion();
const rot = new THREE.Quaternion();
const pa = new THREE.Vector3();
const pb = new THREE.Vector3();
const dRest = new THREE.Vector3();
const dTarget = new THREE.Vector3();

/**
 * Turns a bone by a rotation given in the model's frame: local = P^-1 * R * P * local, where P is the parent's rotation in the model. Whatever
 * way the bone's own axes point, the model's x then bends it forward, its y twists it and its z spreads it.
 */
function turnInModel(bone: THREE.Object3D, rModel: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(parentQ);
  parentQ.premultiply(tmpQ.copy(modelQ).invert()); // the parent's rotation in the model's frame
  conj.copy(parentQ).invert().multiply(rModel).multiply(parentQ);
  bone.quaternion.premultiply(conj);
}

/**
 * The direction an arm should point for a pose (model frame): a hanging arm swung forward and up by `raise` (about x, negative is forward and
 * overhead), then spread by `spread` (about z), moved by how far this rig's arm rests from hanging, so a rolled T-pose arm starts at rest and goes
 * where the pose sends it instead of dropping to the side. Pure.
 */
export function armTarget(rest: THREE.Vector3, raise: number, spread: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(HANG).applyEuler(eul.set(raise, 0, 0)).applyEuler(eul.set(0, 0, spread));
  return out.add(rest).sub(HANG).normalize();
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
  if (!parts.bones.length) return;
  parts.root.updateMatrixWorld(true);
  for (const { bone, kind, child } of parts.bones) {
    if (!bone.parent) continue;
    parts.root.getWorldQuaternion(modelQ);
    if ((kind === 'armR' || kind === 'armL') && child) {
      const right = kind === 'armR';
      const raise = (right ? pose.armRx : pose.armLx) * R.armRaiseGain * weight;
      const spread = (right ? pose.armRz : pose.armLz) * R.armSpreadGain * weight;
      if (raise !== 0 || spread !== 0) {
        // the arm's direction now, in the model's frame
        bone.getWorldPosition(pa);
        child.getWorldPosition(pb);
        dRest.copy(pb).sub(pa).applyQuaternion(tmpQ.copy(modelQ).invert()).normalize();
        armTarget(dRest, raise, spread, dTarget);
        turnInModel(bone, rot.setFromUnitVectors(dRest, dTarget));
      }
    } else if (kind === 'spine') {
      turnInModel(bone, rot.setFromEuler(eul.set(pose.tilt * R.spineTilt * weight, pose.yaw * R.spineTwist * weight, 0, 'YXZ')));
    } else if (kind === 'head') {
      turnInModel(bone, rot.setFromEuler(eul.set(pose.tilt * R.headTilt * weight, 0, 0)));
    }
    // what is driven next (the arms, the head) rides on this bone
    bone.updateWorldMatrix(false, true);
  }
}
