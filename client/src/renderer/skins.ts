// How a generated room is skinned. The Kenney pieces carry one flat colour palette, so each room lays a stone, brick or tile texture
// over its floors and walls in world space (projected along the dominant axis of the surface) and tints everything cool and dark.
import * as THREE from 'three';
import type { RoomLook } from '@conflux/shared';

export interface Skin {
  floorTex: string;
  wallTex: string;
  tint: THREE.Color;
}

export function skinFor(look: RoomLook | undefined): Skin | null {
  return look ? { floorTex: look.floorTex, wallTex: look.wallTex, tint: new THREE.Color(look.tint) } : null;
}

/** Gives every material under `root` its own copy (`copies` remembers which material became which) and multiplies its colour by the tint. */
export function tintMaterials(root: THREE.Object3D, tint: THREE.Color, copies: Map<THREE.Material, THREE.Material>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const swap = (m: THREE.Material) => {
      let c = copies.get(m);
      if (!c) {
        c = m.clone();
        c.userData.roomCopy = true;
        (c as THREE.MeshStandardMaterial).color?.multiply(tint);
        if ((c as THREE.MeshStandardMaterial).metalness !== undefined) (c as THREE.MeshStandardMaterial).metalness = Math.min((c as THREE.MeshStandardMaterial).metalness, 0.1);
        copies.set(m, c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/** Lays a texture over the material in world space: `scale` repeats per metre, `strength` from 0 (none) to 1 (full). */
export function addDetail(material: THREE.Material, texture: THREE.Texture, scale: number, strength: number): void {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: texture };
    shader.uniforms.detailScale = { value: scale };
    shader.uniforms.detailStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nuniform sampler2D detailMap;\nuniform float detailScale;\nuniform float detailStrength;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n{ vec3 an = abs(normalize(vWN)); vec2 duv = an.y > 0.6 ? vWP.xz : (an.x > an.z ? vWP.zy : vWP.xy); vec3 d = texture2D(detailMap, duv * detailScale).rgb; diffuseColor.rgb *= mix(vec3(1.0), d * 1.7, detailStrength); float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.55); }',
      );
  };
  material.customProgramCacheKey = () => `detail-${scale}-${strength}`;
  material.needsUpdate = true;
}

/** Frees the material copies a room made (the shared ones, and the geometry, belong to the loader's cache). */
export function disposeCopies(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.userData.roomCopy) m.dispose();
  });
}
