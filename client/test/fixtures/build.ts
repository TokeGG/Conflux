// Builds the small test models for the import pipeline (cube, skinned, big, textured, broken) with glTF Transform.
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

export interface BuildOptions {
  /** A wavy sheet of grid x grid quads (2 triangles each); omit for a unit cube. */
  grid?: number;
  skinned?: boolean;
  /** Add a second set of joints and weights, so a vertex carries 8 of them. */
  extraWeights?: boolean;
  /** Edge length in pixels of a texture to attach. */
  texture?: number;
  /** A file with a node and no mesh at all. */
  noMesh?: boolean;
  /** Height of the model before import. */
  height?: number;
  /** Move the model off the ground and off centre, to test the fitting. */
  offset?: [number, number, number];
}

function cube(): { positions: number[]; indices: number[] } {
  const p: number[] = [];
  for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) p.push(x, y, z);
  const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  return { positions: p, indices: idx };
}

function sheet(n: number, height: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = i / n - 0.5;
      const y = (j / n) * height;
      positions.push(x, y, 0.1 * Math.sin(i * 0.7) * Math.cos(j * 0.9));
    }
  }
  const row = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  return { positions, indices };
}

export async function buildModel(o: BuildOptions = {}): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const root = doc.createNode('Root');
  if (o.offset) root.setTranslation(o.offset);
  scene.addChild(root);
  if (!o.noMesh) {
    const geo = o.grid ? sheet(o.grid, o.height ?? 2) : cube();
    const verts = geo.positions.length / 3;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.positions)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(verts > 65535 ? new Uint32Array(geo.indices) : new Uint16Array(geo.indices)).setBuffer(buffer));
    if (o.texture) {
      const uv = new Float32Array(verts * 2);
      for (let v = 0; v < verts; v++) uv.set([geo.positions[v * 3] + 0.5, geo.positions[v * 3 + 1] / (o.height ?? 1)], v * 2);
      prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
      const png = await sharp({ create: { width: o.texture, height: o.texture, channels: 3, background: { r: 200, g: 90, b: 40 } } }).png().toBuffer();
      const tex = doc.createTexture('albedo').setImage(new Uint8Array(png)).setMimeType('image/png');
      prim.setMaterial(doc.createMaterial('skin').setBaseColorTexture(tex));
    }
    const mesh = doc.createMesh('Body').addPrimitive(prim);
    const node = doc.createNode('BodyNode').setMesh(mesh);
    if (o.skinned) {
      const hips = doc.createNode('Hips').setTranslation([0, 0, 0]);
      const spine = doc.createNode('Spine').setTranslation([0, 1, 0]);
      hips.addChild(spine);
      root.addChild(hips);
      const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]);
      const skin = doc.createSkin('Rig').addJoint(hips).addJoint(spine).setSkeleton(hips).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
      const joints = new Uint8Array(verts * 4);
      const weights = new Float32Array(verts * 4);
      for (let v = 0; v < verts; v++) {
        const t = Math.min(1, Math.max(0, geo.positions[v * 3 + 1] / (o.height ?? 1)));
        joints.set([0, 1, 0, 0], v * 4);
        weights.set([1 - t, t, 0, 0], v * 4);
      }
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
      if (o.extraWeights) {
        const j1 = new Uint8Array(verts * 4);
        const w1 = new Float32Array(verts * 4);
        for (let v = 0; v < verts; v++) {
          j1.set([1, 0, 1, 0], v * 4);
          w1.set([0.05, 0.05, 0, 0], v * 4);
        }
        prim.setAttribute('JOINTS_1', doc.createAccessor().setType('VEC4').setArray(j1).setBuffer(buffer));
        prim.setAttribute('WEIGHTS_1', doc.createAccessor().setType('VEC4').setArray(w1).setBuffer(buffer));
      }
      node.setSkin(skin);
      for (const [name, seconds] of [['Idle', 1], ['Walk', 0.8]] as const) {
        const anim = doc.createAnimation(name);
        const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, seconds / 2, seconds])).setBuffer(buffer);
        const output = doc.createAccessor().setType('VEC4').setArray(new Float32Array([0, 0, 0, 1, 0, 0.1, 0, 0.995, 0, 0, 0, 1])).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(spine).setTargetPath('rotation').setSampler(sampler));
      }
    }
    root.addChild(node);
  }
  return new NodeIO().writeBinary(doc);
}
