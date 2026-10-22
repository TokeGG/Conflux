// Builds the book mob's model from boxes: two covers that open like wings, a stack of pages and a spine. Each part is its own mesh so
// the 'part_sway' motion can flap them. Usage: npx tsx scripts/make-book.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('book');

function box(sx: number, sy: number, sz: number) {
  const [x, y, z] = [sx / 2, sy / 2, sz / 2];
  const faces: [number[], number[]][] = [
    [[0, 0, 1], [-x, -y, z, x, -y, z, x, y, z, -x, y, z]],
    [[0, 0, -1], [x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z]],
    [[1, 0, 0], [x, -y, z, x, -y, -z, x, y, -z, x, y, z]],
    [[-1, 0, 0], [-x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z]],
    [[0, 1, 0], [-x, y, z, x, y, z, x, y, -z, -x, y, -z]],
    [[0, -1, 0], [-x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z]],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  faces.forEach(([n, p], f) => {
    pos.push(...p);
    for (let i = 0; i < 4; i++) nor.push(...n);
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

function part(name: string, size: [number, number, number], at: [number, number, number], rotZ: number, color: [number, number, number], emissive = 0) {
  const b = box(...size);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(b.pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(b.nor).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(b.idx).setBuffer(buffer))
    .setMaterial(doc.createMaterial(name).setBaseColorFactor([...color, 1]).setRoughnessFactor(0.85).setMetallicFactor(0).setEmissiveFactor([color[0] * emissive, color[1] * emissive, color[2] * emissive]));
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setTranslation(at);
  const h = rotZ / 2;
  node.setRotation([0, 0, Math.sin(h), Math.cos(h)]);
  scene.addChild(node);
}

const LEATHER: [number, number, number] = [0.24, 0.07, 0.06];
const PAGES: [number, number, number] = [0.72, 0.64, 0.45];
// a book seen from the front, open like a bird: the spine in the middle, a cover and a page block on each side
part('spine', [0.12, 0.62, 0.2], [0, 0.5, 0], 0, LEATHER);
part('cover_left', [0.5, 0.62, 0.05], [-0.3, 0.55, 0], 0.5, LEATHER);
part('cover_right', [0.5, 0.62, 0.05], [0.3, 0.55, 0], -0.5, LEATHER);
part('pages_left', [0.44, 0.56, 0.1], [-0.27, 0.57, 0.04], 0.5, PAGES, 0.35);
part('pages_right', [0.44, 0.56, 0.1], [0.27, 0.57, -0.04 * -1], -0.5, PAGES, 0.35);
part('clasp', [0.1, 0.1, 0.06], [0, 0.78, 0.12], 0, [0.8, 0.6, 0.2], 0.4);

await new NodeIO().write(fileURLToPath(new URL('../client/public/assets/models/enemies/book.glb', import.meta.url)), doc);
console.log('book.glb written');
