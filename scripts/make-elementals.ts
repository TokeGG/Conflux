// Builds the three elemental mobs from the owner's rigged uploads (kept outside the repo): splits the water and fire golems that
// share one file, rigs the water golem to the same Mixamo skeleton, shares the wraith's walk with all three, and cuts each to the
// import budget. Usage: npx tsx scripts/make-elementals.ts <golems.glb> <wraith.glb>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import sharp from 'sharp';
import { prepareModel } from '../client/src/dev/import/prepare.ts';

const [golemsPath, wraithPath] = process.argv.slice(2);
if (!golemsPath || !wraithPath) throw new Error('usage: make-elementals.ts <golems.glb> <wraith.glb>');
const out = (name: string) => fileURLToPath(new URL(`../client/public/assets/models/enemies/${name}.glb`, import.meta.url));
const io = new NodeIO();
const resize = async (img: Uint8Array, _m: string, max: number) => new Uint8Array(await sharp(img).resize(max, max, { fit: 'inside' }).png().toBuffer());

/** Connected pieces of the mesh, as sets of vertex indices (the two golems do not touch). */
function components(index: ArrayLike<number>, count: number): number[][] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let i = 0; i < index.length; i += 3) {
    parent[find(index[i + 1])] = find(index[i]);
    parent[find(index[i + 2])] = find(index[i]);
  }
  const groups = new Map<number, number[]>();
  for (let v = 0; v < count; v++) (groups.get(find(v)) ?? groups.set(find(v), []).get(find(v))!).push(v);
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

type Prim = ReturnType<ReturnType<Document['getRoot']>['listMeshes']>[number]['listPrimitives'] extends () => (infer P)[] ? P : never;

/** Keeps only `keep` vertices of the primitive (and the triangles made of them), with positions moved and re-weighted by `edit`. */
function restrict(doc: Document, keep: number[], edit?: (pos: Float32Array, joints: Uint16Array | Uint8Array, weights: Float32Array) => void): void {
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const remap = new Map(keep.map((v, i) => [v, i]));
  const idx = prim.getIndices()!.getArray()!;
  const tris: number[] = [];
  for (let i = 0; i < idx.length; i += 3) if (remap.has(idx[i]) && remap.has(idx[i + 1]) && remap.has(idx[i + 2])) tris.push(remap.get(idx[i])!, remap.get(idx[i + 1])!, remap.get(idx[i + 2])!);
  const take = (sem: string, n: number, Ctor: any) => {
    const acc = prim.getAttribute(sem)!;
    const src = acc.getArray()!;
    const dst = new Ctor(keep.length * n);
    keep.forEach((v, i) => { for (let k = 0; k < n; k++) dst[i * n + k] = src[v * n + k]; });
    return dst;
  };
  const pos = take('POSITION', 3, Float32Array);
  const joints = take('JOINTS_0', 4, prim.getAttribute('JOINTS_0')!.getArray()!.constructor);
  const weights = take('WEIGHTS_0', 4, Float32Array);
  edit?.(pos, joints, weights);
  prim.getAttribute('POSITION')!.setArray(pos);
  prim.getAttribute('NORMAL')!.setArray(take('NORMAL', 3, Float32Array));
  prim.getAttribute('TEXCOORD_0')!.setArray(take('TEXCOORD_0', 2, Float32Array));
  prim.getAttribute('JOINTS_0')!.setArray(joints);
  prim.getAttribute('WEIGHTS_0')!.setArray(weights);
  prim.getIndices()!.setArray(new Uint32Array(tris));
}

function boneSegments(doc: Document): { name: string; a: number[]; b: number[] }[] {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const set = new Set(joints);
  return joints.map((j) => {
    const a = j.getWorldTranslation();
    const kids = j.listChildren().filter((c) => set.has(c as Node));
    const b = kids.length ? [0, 1, 2].map((k) => kids.reduce((s, c) => s + c.getWorldTranslation()[k], 0) / kids.length) : a;
    return { name: j.getName(), a, b };
  });
}

const dist2Segment = (p: number[], a: number[], b: number[]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2));
  return (p[0] - a[0] - ab[0] * t) ** 2 + (p[1] - a[1] - ab[1] * t) ** 2 + (p[2] - a[2] - ab[2] * t) ** 2;
};

/** Gives every vertex the four nearest bones, weighted by closeness (a plain auto-skin: good enough for chunky creatures). */
function autoSkin(segs: { a: number[]; b: number[] }[], pos: Float32Array, joints: Uint16Array | Uint8Array, weights: Float32Array): void {
  for (let v = 0; v < pos.length / 3; v++) {
    const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const near = segs.map((s, i) => ({ i, d: dist2Segment(p, s.a, s.b) })).sort((x, y) => x.d - y.d).slice(0, 4);
    const w = near.map((n) => 1 / (n.d + 0.0004) ** 1.5);
    const sum = w.reduce((s, x) => s + x, 0);
    near.forEach((n, k) => { joints[v * 4 + k] = n.i; weights[v * 4 + k] = w[k] / sum; });
  }
}

/** Copies the wraith's walk onto a document whose bones share the Mixamo names, as 'walk' and 'idle'. */
function shareWalk(from: Document, to: Document): void {
  const src = from.getRoot().listAnimations()[0];
  for (const name of ['walk', 'idle']) {
    const anim = to.createAnimation(name);
    for (const ch of src.listChannels()) {
      const node = to.getRoot().listNodes().find((n) => n.getName() === ch.getTargetNode()?.getName());
      if (!node) continue;
      const s = ch.getSampler()!;
      const input = to.createAccessor().setType('SCALAR').setArray(s.getInput()!.getArray()!.slice());
      const output = to.createAccessor().setType(s.getOutput()!.getType()).setArray(s.getOutput()!.getArray()!.slice());
      const sampler = to.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
      anim.addSampler(sampler).addChannel(to.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()!).setSampler(sampler));
    }
  }
}

async function finish(doc: Document, name: string, height: number): Promise<void> {
  const glb = await io.writeBinary(doc);
  const r = await prepareModel(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, { heightM: height, kind: 'mob', resize }, `${name}.glb`);
  if ('error' in r) throw new Error(`${name}: ${r.error}`);
  writeFileSync(out(name), r.glb);
  console.log(`${name}: ${r.report.triangles} triangles, ${r.report.clips?.length ?? 0} clips, ${(r.glb.length / 1e6).toFixed(1)} MB`);
}

const wraith = await io.read(wraithPath);

// the two golems: the fire golem is the one the skeleton was built for; the water golem is moved onto it and re-weighted
const pair = await io.read(golemsPath);
const prim = pair.getRoot().listMeshes()[0].listPrimitives()[0];
const posAll = prim.getAttribute('POSITION')!.getArray()!;
// the file has about a thousand loose pieces (UV seams); the two characters stand either side of this x
const SPLIT_X = -0.05;
const pieces = components(prim.getIndices()!.getArray()!, prim.getAttribute('POSITION')!.getCount());
const comps: number[][] = [[], []];
for (const c of pieces) comps[c.reduce((s, v) => s + posAll[v * 3], 0) / c.length < SPLIT_X ? 0 : 1].push(...c);
const pos = posAll;
const stats = comps.map((c) => {
  const xs = c.map((v) => pos[v * 3]);
  const ys = c.map((v) => pos[v * 3 + 1]);
  const zs = c.map((v) => pos[v * 3 + 2]);
  return { c, cz: zs.reduce((s, x) => s + x, 0) / zs.length, cx: xs.reduce((s, x) => s + x, 0) / xs.length, minY: Math.min(...ys), maxY: Math.max(...ys), minX: Math.min(...xs), maxX: Math.max(...xs) };
});
const [fire, water] = stats[0].cx > stats[1].cx ? [stats[0], stats[1]] : [stats[1], stats[0]];
console.log('fire', { cx: fire.cx.toFixed(2), h: (fire.maxY - fire.minY).toFixed(2) }, 'water', { cx: water.cx.toFixed(2), h: (water.maxY - water.minY).toFixed(2) });

const fireDoc = await io.read(golemsPath);
restrict(fireDoc, fire.c);
shareWalk(wraith, fireDoc);
await finish(fireDoc, 'fire_elemental', 1.5);

const waterDoc = await io.read(golemsPath);
const segs = boneSegments(waterDoc);
const k = (fire.maxY - fire.minY) / (water.maxY - water.minY);
restrict(waterDoc, water.c, (p, j, w) => {
  for (let v = 0; v < p.length / 3; v++) {
    p[v * 3] = (p[v * 3] - water.cx) * k + fire.cx;
    p[v * 3 + 1] = (p[v * 3 + 1] - water.minY) * k + fire.minY;
    p[v * 3 + 2] = (p[v * 3 + 2] - water.cz) * k + fire.cz;
  }
  autoSkin(segs, p, j, w);
});
shareWalk(wraith, waterDoc);
await finish(waterDoc, 'water_elemental', 1.5);

shareWalk(wraith, wraith);
await finish(wraith, 'wraith', 1.6);
