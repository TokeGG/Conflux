// Meshes for the procedural props (kit `proc`): each prop's boxes are merged into one geometry per material, and every placement of a prop in
// a room is one instance of it, so a room of 40 bookshelves costs two draw calls per kind of prop, not hundreds of meshes.
import * as THREE from 'three';
import { PROC_KIT, PROC_PIECES, type ProcDef, type RoomPiece } from '@conflux/shared';

/** How many texture repeats a metre of wood gets. */
const WOOD_UV_PER_METRE = 0.6;

export interface ProcGeometries {
  /** The boxes with the wood texture laid over them (null when there are none). */
  wood: THREE.BufferGeometry | null;
  /** The boxes that are just coloured. */
  plain: THREE.BufferGeometry | null;
}

const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/** One indexed geometry (positions, normals, vertex colours, uvs by world metres) for the boxes that pass `pick`. */
function merge(def: ProcDef, pick: (wood: number) => boolean): THREE.BufferGeometry | null {
  const boxes = def.boxes.filter((b) => pick(b[7]));
  if (!boxes.length) return null;
  const pos = new Float32Array(boxes.length * 24 * 3);
  const nor = new Float32Array(boxes.length * 24 * 3);
  const col = new Float32Array(boxes.length * 24 * 3);
  const uv = new Float32Array(boxes.length * 24 * 2);
  const idx = new Uint32Array(boxes.length * 36);
  const c = new THREE.Color();
  let v = 0;
  let i = 0;
  for (const [x, y, z, w, h, d, color] of boxes) {
    c.set(color);
    for (const f of FACES) {
      const base = v;
      for (const q of f.v) {
        const px = x + q[0] * w;
        const py = y + q[1] * h;
        const pz = z + q[2] * d;
        pos.set([px, py, pz], v * 3);
        nor.set(f.n, v * 3);
        col.set([c.r, c.g, c.b], v * 3);
        // the texture is laid on by the face's two free axes, so a plank looks like a plank on every side
        const u = f.n[0] !== 0 ? pz : px;
        const t = f.n[1] !== 0 ? pz : py;
        uv.set([u * WOOD_UV_PER_METRE, t * WOOD_UV_PER_METRE], v * 2);
        v++;
      }
      idx.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function procGeometries(def: ProcDef): ProcGeometries {
  return { wood: merge(def, (w) => w === 1), plain: merge(def, (w) => w === 0) };
}

/** The matrix that puts a prop at a piece's place (the same as a model: scale, turn about y, then move). */
export function pieceMatrix(p: Pick<RoomPiece, 'pos' | 'rotY' | 'scale'>): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY), new THREE.Vector3(p.scale, p.scale, p.scale));
}

/**
 * Every procedural piece of a room as instanced meshes, tinted like the rest of the room. The geometries and materials belong to the returned
 * group (flagged `userData.own`, freed by disposeProc); the wood texture is the loader's and is shared.
 */
export function buildProcGroup(pieces: readonly RoomPiece[], woodTex: THREE.Texture | null, tint: THREE.Color | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'proc';
  const byId = new Map<string, RoomPiece[]>();
  for (const p of pieces) if (p.kit === PROC_KIT) (byId.get(p.id) ?? byId.set(p.id, []).get(p.id)!).push(p);
  if (!byId.size) return group;
  if (woodTex) woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  const mat = (map: THREE.Texture | null) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, map });
    if (tint) m.color.copy(tint);
    m.userData.own = true;
    return m;
  };
  const wood = mat(woodTex);
  const plain = mat(null);
  for (const [id, list] of byId) {
    const def = PROC_PIECES[id];
    if (!def) throw new Error(`unknown procedural prop ${id}`);
    const g = procGeometries(def);
    for (const [geometry, material] of [[g.wood, wood], [g.plain, plain]] as const) {
      if (!geometry) continue;
      geometry.userData.own = true;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, k) => mesh.setMatrixAt(k, pieceMatrix(p)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `proc.${id}`;
      mesh.userData.surface = 'prop';
      group.add(mesh);
    }
  }
  return group;
}

/** Frees what buildProcGroup made: the geometries, the instance buffers and the two materials. */
export function disposeProc(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if ((o as THREE.Mesh).isMesh && !m.isInstancedMesh && (o as THREE.Mesh).geometry.userData.own) {
      (o as THREE.Mesh).geometry.dispose(); // a merged patch of the room
      return;
    }
    if (!m.isInstancedMesh) return;
    if (m.geometry.userData.own) m.geometry.dispose();
    const mat = m.material as THREE.Material;
    if (mat.userData.own) mat.dispose();
    m.dispose();
  });
}
