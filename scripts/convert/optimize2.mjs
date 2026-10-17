// Heavy-decimation variant: drops baked normals (their seams block collapses), welds, simplifies, recomputes smooth normals, resizes textures.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
const [, , inp, out, maxTex = '1024', ratio = '0.02', err = '0.05'] = process.argv;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const prims = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const tris = () => Math.round(prims().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0));
const before = tris();
for (const p of prims()) p.setAttribute('NORMAL', null);
await doc.transform(weld({ tolerance: 1e-5 }), simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: +err, lockBorder: false }), dedup(), prune(), textureCompress({ encoder: sharp, resize: [+maxTex, +maxTex] }));
for (const p of prims()) {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices(); const P = pos.getArray(), I = idx.getArray(); const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(pos.getBuffer()));
}
await io.write(out, doc);
console.log(inp.split('/').pop(), '->', out.split('/').pop(), `${(fs.statSync(inp).size / 1e6).toFixed(1)}MB -> ${(fs.statSync(out).size / 1e6).toFixed(2)}MB`, `tris ${before} -> ${tris()}`);
