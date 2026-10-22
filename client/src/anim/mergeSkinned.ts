// The wizard pack's body is one mesh of 126 primitives on 7 materials, and three draws every primitive on its own. The primitives that share a
// material and a skeleton are joined into one skinned mesh, so the player costs 7 draw calls instead of 126 (the bones and clips are untouched).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Joins the skinned meshes under `root` that share a parent, a material and a skeleton. Returns how many meshes were removed. */
export function mergeSkinnedMeshes(root: THREE.Object3D): number {
  const groups = new Map<string, THREE.SkinnedMesh[]>();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || Array.isArray(m.material) || !m.parent) return;
    const key = `${m.parent.uuid}|${(m.material as THREE.Material).uuid}|${m.skeleton.uuid}|${m.bindMode}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  });
  let removed = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const geometries = meshes.map((m) => {
      const g = m.geometry.clone();
      g.clearGroups();
      g.morphAttributes = {};
      return g;
    });
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue; // the parts did not agree on their attributes: leave them as they are
    const mesh = new THREE.SkinnedMesh(merged, first.material);
    mesh.name = first.name;
    mesh.frustumCulled = false; // a skinned mesh's bounds are those of its rest pose
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    first.parent!.add(mesh);
    mesh.bind(first.skeleton, first.bindMatrix);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    removed += meshes.length - 1;
  }
  return removed;
}
