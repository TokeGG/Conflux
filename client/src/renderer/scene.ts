// The Three.js scene: lighting, camera, ground and helpers. Rooms (Task 9) fill it with real geometry.
import * as THREE from 'three';
import type { LightingPreset } from '@conflux/shared';
import { applyLighting, lightingRig } from './lighting.ts';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(width: number, height: number): void;
}

export function createScene(preset: LightingPreset): GameScene {
  const scene = new THREE.Scene();
  applyLighting(scene, lightingRig(preset));
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(2.2, 2.2, -4.5);
  camera.lookAt(0, 1, 0);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x5fa86a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  return {
    scene,
    camera,
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}

/** Scales a model so it is `height` metres tall, stands on y = 0 and is centred on x and z. */
export function fitHeight(obj: THREE.Object3D, height: number): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.y <= 0) return;
  obj.scale.multiplyScalar(height / size.y);
  const fitted = new THREE.Box3().setFromObject(obj);
  const c = fitted.getCenter(new THREE.Vector3());
  obj.position.set(obj.position.x - c.x, obj.position.y - fitted.min.y, obj.position.z - c.z);
}
