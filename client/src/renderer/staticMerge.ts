// A room is hundreds of small meshes (floor tiles, wall pieces, props), each its own draw call. They never move, so the meshes that share a
// material and sit in the same patch of floor are baked into one mesh: a room that cost 950 draw calls seen from above costs a few dozen,
// and a patch still goes out of view as a whole, so looking along a corridor does not draw the far side.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Side of a patch, in metres. */
export const PATCH = 12;
const KEEP = ['position', 'normal', 'uv', 'color'];

/** Materials that draw the same share a merged mesh: the models each bring their own copy of the kit's one palette material. */
function looks(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return [m.type, s.color?.getHexString(), s.map?.uuid, s.roughness, s.metalness, s.emissive?.getHexString(), s.vertexColors, m.transparent, m.opacity, m.side, m.alphaTest, m.customProgramCacheKey()].join(':');
}

export interface MergeResult {
  before: number;
  after: number;
}

/** Replaces the plain meshes under `root` by merged ones (one per material per patch). `root` must sit at the origin, unscaled. */
export function mergeStatic(root: THREE.Object3D, patch = PATCH): MergeResult {
  root.updateMatrixWorld(true);
  const groups = new Map<string, THREE.Mesh[]>();
  const centre = new THREE.Vector3();
  let before = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material) || !m.geometry.getAttribute('position')) return;
    before++;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    centre.copy(m.geometry.boundingBox!.getCenter(new THREE.Vector3())).applyMatrix4(m.matrixWorld);
    const attrs = KEEP.filter((k) => m.geometry.getAttribute(k)).join(',');
    const key = `${looks(m.material as THREE.Material)}|${attrs}|${Math.floor(centre.x / patch)},${Math.floor(centre.z / patch)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  });
  for (const meshes of groups.values()) {
    const parts = meshes.map((m) => {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
      g.morphAttributes = {};
      g.clearGroups();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    // mergeGeometries wants all parts indexed or none
    const indexed = parts.filter((g) => g.index).length;
    const same = indexed === 0 || indexed === parts.length ? parts : parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(same, false);
    for (const g of parts) g.dispose();
    for (const g of same) g.dispose();
    if (!merged) continue; // the parts did not agree: leave them as they are
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    merged.userData.own = true;
    const mesh = new THREE.Mesh(merged, meshes[0].material);
    mesh.name = 'merged';
    mesh.userData.surface = meshes[0].userData.surface ?? meshes[0].parent?.userData.surface ?? 'prop';
    for (const m of meshes) m.removeFromParent();
    root.add(mesh);
  }
  // the groups the meshes were in are empty shells now
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.children.length === 0 && !(o as THREE.Mesh).isMesh && !(o as THREE.Light).isLight) empty.push(o);
  });
  for (const o of empty) o.removeFromParent();
  let left = 0;
  root.traverse((o) => ((o as THREE.Mesh).isMesh ? left++ : 0));
  return { before, after: left };
}
