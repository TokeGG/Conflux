import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REST_FRAME, type AttackPose } from '../src/anim/attackAnim.ts';
import { findRigParts, poseRig } from '../src/anim/mobParts.ts';

const pose = (o: Partial<AttackPose>): AttackPose => ({ ...REST_FRAME, energy: 0, ...o });

/**
 * A mixamo-named skeleton in the model's space (it faces +z, +y up). `tpose` rolls the shoulders a quarter turn so the arms lie along +-x like the
 * Maw's; otherwise they hang down like the elementals'. Every bone is driven by a clip, as findRigParts requires.
 */
function skeleton(tpose: boolean) {
  const model = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D, pos: [number, number, number], quat?: THREE.Quaternion) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...pos);
    if (quat) b.quaternion.copy(quat);
    parent.add(b);
    return b;
  };
  const hips = bone('mixamorigHips', model, [0, 1, 0]);
  const spine = bone('mixamorigSpine1', hips, [0, 0.3, 0]);
  const neck = bone('mixamorigNeck', spine, [0, 0.4, 0]);
  const head = bone('mixamorigHead', neck, [0, 0.2, 0]);
  const upper = (side: 1 | -1) => {
    // the arm's own y axis runs along the arm: down when hanging, out to the side in the T-pose (a quarter turn about z)
    const q = new THREE.Quaternion();
    if (tpose) q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * Math.PI / 2);
    const name = side === -1 ? 'Right' : 'Left';
    const arm = bone(`mixamorig${name}Arm`, spine, [side * 0.3, 0.3, 0], q);
    bone(`mixamorig${name}ForeArm`, arm, [0, -0.5, 0]);
    return arm;
  };
  const armR = upper(-1);
  const armL = upper(1);
  // the hanging arm's local y points down: flip it when hanging so "child offset (0,-0.5,0)" is down in the model; in the T-pose the quarter turn does it
  void head;
  const clip = new THREE.AnimationClip('idle', 1, ['mixamorigRightArm', 'mixamorigLeftArm', 'mixamorigSpine1', 'mixamorigHead'].map((n) => {
    const b = model.getObjectByName(n)!;
    return new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, [0, 1], [...b.quaternion.toArray(), ...b.quaternion.toArray()]);
  }));
  model.updateMatrixWorld(true);
  const parts = findRigParts(model, 'model.x', null, [clip]);
  return { model, parts, spine, head, armR, armL };
}

const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
/** The direction of an arm in the model (upper arm to forearm). */
function armDir(model: THREE.Object3D, side: 'Right' | 'Left'): THREE.Vector3 {
  model.updateMatrixWorld(true);
  return world(model.getObjectByName(`mixamorig${side}ForeArm`)!).sub(world(model.getObjectByName(`mixamorig${side}Arm`)!)).normalize();
}

for (const tpose of [false, true]) {
  const label = tpose ? 'a rolled T-pose rig' : 'a hanging-arm rig';

  test(`${label}: a zero pose changes nothing`, () => {
    const { model, parts } = skeleton(tpose);
    const before = [armDir(model, 'Right'), armDir(model, 'Left')];
    poseRig(parts, pose({}), 1);
    model.updateMatrixWorld(true);
    assert.ok(armDir(model, 'Right').distanceTo(before[0]) < 1e-6);
    assert.ok(armDir(model, 'Left').distanceTo(before[1]) < 1e-6);
  });

  test(`${label}: the raise swings the arms forward and up, whatever the rest pose`, () => {
    const { model, parts } = skeleton(tpose);
    poseRig(parts, pose({ armRx: -Math.PI / 2, armLx: -Math.PI / 2 }), 1);
    for (const side of ['Right', 'Left'] as const) {
      const d = armDir(model, side);
      assert.ok(d.z > 0.45, `${side} arm points forward (${d.toArray().map((x) => x.toFixed(2))})`);
      assert.ok(d.y > -0.05, `${side} arm is not below the shoulder (${d.y.toFixed(2)})`);
    }
  });

  test(`${label}: raising overhead puts both arms above the shoulders, mirrored left to right`, () => {
    const { model, parts } = skeleton(tpose);
    poseRig(parts, pose({ armRx: -2.6, armLx: -2.6 }), 1);
    const r = armDir(model, 'Right');
    const l = armDir(model, 'Left');
    assert.ok(r.y > 0.4 && l.y > 0.4, `both overhead (${r.y.toFixed(2)}, ${l.y.toFixed(2)})`);
    assert.ok(Math.abs(r.x + l.x) < 0.08 && Math.abs(r.y - l.y) < 0.08 && Math.abs(r.z - l.z) < 0.08, 'the two sides mirror');
  });

  test(`${label}: a spine tilt leans the head forward and a twist turns it about the vertical`, () => {
    const { model, parts, head } = skeleton(tpose);
    const rest = world(head).clone();
    poseRig(parts, pose({ tilt: 0.8 }), 1);
    model.updateMatrixWorld(true);
    assert.ok(world(head).z - rest.z > 0.05, `head moved forward (${(world(head).z - rest.z).toFixed(3)})`);
    const { model: m2, parts: p2, armR } = skeleton(tpose);
    const x0 = world(armR).x;
    const z0 = world(armR).z;
    poseRig(p2, pose({ yaw: 1 }), 1);
    m2.updateMatrixWorld(true);
    assert.ok(Math.abs(world(armR).z - z0) > 0.02 && Math.abs(world(armR).x - x0) > 0.0, 'the shoulder swung round the spine');
  });

  test(`${label}: the weight fades the pose and everything stays finite`, () => {
    const { model, parts } = skeleton(tpose);
    const rest = armDir(model, 'Right');
    poseRig(parts, pose({ armRx: -2.4, armRz: 1 }), 0);
    assert.ok(armDir(model, 'Right').distanceTo(rest) < 1e-6, 'weight 0 is the rest pose');
    const { model: m2, parts: p2 } = skeleton(tpose);
    poseRig(p2, pose({ armRx: -2.4, armRz: 1, tilt: 1, yaw: 2 }), 1);
    m2.updateMatrixWorld(true);
    for (const n of ['mixamorigRightArm', 'mixamorigLeftArm', 'mixamorigSpine1', 'mixamorigHead']) {
      assert.ok(m2.getObjectByName(n)!.quaternion.toArray().every(Number.isFinite), n);
    }
  });
}
