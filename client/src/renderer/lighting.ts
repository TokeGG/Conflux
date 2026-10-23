// A room's mood as data: ambient and sun colours, intensity and fog. The gloomy pass later is just different presets.
import * as THREE from 'three';
import type { LightingPreset } from '@conflux/shared';

export interface LightingRig {
  lights: THREE.Light[];
  fog: THREE.Fog;
  background: THREE.Color;
}

export function lightingRig(p: LightingPreset): LightingRig {
  const ambient = new THREE.Color(p.ambient);
  const sky = new THREE.HemisphereLight(ambient, ambient.clone().multiplyScalar(0.45), 2.2);
  const sun = new THREE.DirectionalLight(new THREE.Color(p.light), p.intensity);
  sun.position.set(-4, 8, -3);
  return { lights: [sky, sun], fog: new THREE.Fog(new THREE.Color(p.fogColor), p.fogNear, p.fogFar), background: new THREE.Color(p.fogColor) };
}

/** Puts the rig into the scene and returns a function that takes it out again. */
export function applyLighting(scene: THREE.Scene, rig: LightingRig): () => void {
  for (const l of rig.lights) scene.add(l);
  scene.fog = rig.fog;
  scene.background = rig.background;
  return () => {
    for (const l of rig.lights) scene.remove(l);
    scene.fog = null;
    scene.background = null;
  };
}
