import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { IMPORT_LIMITS } from '../src/dev/import/limits.ts';
import { inspectModel } from '../src/dev/import/inspect.ts';
import { prepareModel } from '../src/dev/import/prepare.ts';
import { fbxToGlb } from '../src/dev/import/fbx.ts';
import { buildModel } from './fixtures/build.ts';

const file = (name: string) => {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const resize = async (img: Uint8Array, _mime: string, max: number) => new Uint8Array(await sharp(img).resize(max, max, { fit: 'inside' }).png().toBuffer());
const opts = (kind: 'mob' | 'boss' = 'mob', heightM = 1.8) => ({ heightM, kind, resize });

function isError(x: unknown): x is { error: string } {
  return typeof x === 'object' && x !== null && 'error' in x;
}

test('the limits are the ones in the spec', () => {
  assert.deepEqual(IMPORT_LIMITS, { maxFileBytes: 100e6, mobTris: 30000, bossTris: 60000, maxTexture: 1024 });
});

test('inspecting the cube reports 12 triangles, one mesh and no skin', async () => {
  const r = await inspectModel(file('cube.glb'), 'cube.glb');
  assert.ok(!isError(r));
  assert.equal(r.triangles, 12);
  assert.equal(r.meshes, 1);
  assert.equal(r.hasSkin, false);
  assert.deepEqual(r.bones, []);
  assert.deepEqual(r.clips, []);
  assert.ok(Math.abs(r.size.x - 1) < 1e-6 && Math.abs(r.size.y - 1) < 1e-6 && Math.abs(r.size.z - 1) < 1e-6);
});

test('inspecting the skinned model lists its bones and clips with durations', async () => {
  const r = await inspectModel(file('skinned.glb'), 'skinned.glb');
  assert.ok(!isError(r));
  assert.equal(r.hasSkin, true);
  assert.deepEqual([...r.bones].sort(), ['Hips', 'Spine']);
  assert.deepEqual(r.clips.map((c) => c.name).sort(), ['Idle', 'Walk']);
  assert.ok(Math.abs(r.clips.find((c) => c.name === 'Idle')!.duration - 1) < 1e-6);
  assert.ok(Math.abs(r.clips.find((c) => c.name === 'Walk')!.duration - 0.8) < 1e-6);
});

test('inspecting reports texture sizes and warns about big textures and big triangle counts', async () => {
  const big = await buildModel({ grid: 130, texture: 2048 });
  const r = await inspectModel(ab(big), 'big.glb');
  assert.ok(!isError(r));
  assert.deepEqual(r.textures.map((t) => [t.w, t.h]), [[2048, 2048]]);
  assert.ok(r.warnings.some((w) => /texture/i.test(w)), r.warnings.join(' | '));
  assert.ok(r.triangles > 30000 && r.warnings.some((w) => /triangle/i.test(w)), r.warnings.join(' | '));
});

test('a model with more than 4 weights per vertex is accepted with a warning', async () => {
  const m = await buildModel({ grid: 6, skinned: true, extraWeights: true });
  const r = await inspectModel(ab(m), 'eight.glb');
  assert.ok(!isError(r));
  assert.ok(r.warnings.some((w) => /weights/i.test(w)), r.warnings.join(' | '));
  const p = await prepareModel(ab(m), opts());
  assert.ok(!isError(p), 'it can be prepared too');
});

test('a mob of 100,000 triangles is cut to 30,000 or fewer, keeping its skin and clips', async () => {
  const m = await buildModel({ grid: 224, skinned: true });
  const before = await inspectModel(ab(m), 'big.glb');
  assert.ok(!isError(before) && before.triangles > 100000);
  const p = await prepareModel(ab(m), opts('mob', 1.8));
  assert.ok(!isError(p));
  assert.ok(p.report.triangles <= IMPORT_LIMITS.mobTris, `${p.report.triangles} triangles`);
  assert.ok(p.report.triangles > 15000, 'it did not over-simplify');
  assert.equal(p.report.hasSkin, true);
  assert.deepEqual([...p.report.bones].sort(), ['Hips', 'Spine']);
  assert.deepEqual(p.report.clips.map((c) => c.name).sort(), ['Idle', 'Walk']);
});

test('a boss keeps up to 60,000 triangles', async () => {
  const m = await buildModel({ grid: 224, skinned: true });
  const p = await prepareModel(ab(m), opts('boss'));
  assert.ok(!isError(p));
  assert.ok(p.report.triangles <= IMPORT_LIMITS.bossTris && p.report.triangles > IMPORT_LIMITS.mobTris, `${p.report.triangles}`);
});

test('the prepared model is the chosen height with its feet on y = 0, centred', async () => {
  const m = await buildModel({ grid: 40, height: 5, offset: [3, 2, -4] });
  const p = await prepareModel(ab(m), opts('mob', 1.8));
  assert.ok(!isError(p));
  assert.ok(Math.abs(p.report.size.y - 1.8) / 1.8 < 0.01, `height ${p.report.size.y}`);
  const again = await inspectModel(ab(p.glb), 'out.glb');
  assert.ok(!isError(again));
  assert.ok(Math.abs(again.min.y) < 1e-3, `lowest point ${again.min.y}`);
  assert.ok(Math.abs(again.min.x + again.size.x / 2) < 1e-3 && Math.abs(again.min.z + again.size.z / 2) < 1e-3, 'centred on x and z');
});

test('a model already inside its budget keeps every triangle', async () => {
  const p = await prepareModel(file('cube.glb'), opts());
  assert.ok(!isError(p));
  assert.equal(p.report.triangles, 12);
});

test('textures bigger than 1024 are scaled down', async () => {
  const m = await buildModel({ grid: 20, texture: 2048 });
  const p = await prepareModel(ab(m), opts());
  assert.ok(!isError(p));
  assert.ok(p.report.textures.length === 1 && p.report.textures[0].w <= 1024 && p.report.textures[0].h <= 1024, JSON.stringify(p.report.textures));
});

test('a turn is applied about the vertical axis', async () => {
  const m = await buildModel({ grid: 12, height: 2 });
  const flat = await prepareModel(ab(m), opts());
  const turned = await prepareModel(ab(m), { ...opts(), turnDegrees: 90 });
  assert.ok(!isError(flat) && !isError(turned));
  assert.ok(Math.abs(flat.report.size.x - turned.report.size.z) < 0.02, 'width and depth swapped');
});

test('a truncated file, garbage, an oversize file and a model with no mesh give a plain error and never throw', async () => {
  const cases: [string, ArrayBuffer, string][] = [
    ['truncated', file('broken.glb'), 'broken.glb'],
    ['garbage', ab(new Uint8Array(2000).map((_, i) => (i * 37) % 251)), 'junk.glb'],
    ['empty', new ArrayBuffer(0), 'empty.glb'],
    ['oversize', new ArrayBuffer(IMPORT_LIMITS.maxFileBytes + 1), 'huge.glb'],
    ['no mesh', ab(await buildModel({ noMesh: true })), 'nothing.glb'],
  ];
  for (const [what, buf, name] of cases) {
    const inspected = await inspectModel(buf, name);
    assert.ok(isError(inspected), `${what}: inspect refuses`);
    assert.equal(typeof inspected.error, 'string');
    assert.ok(inspected.error.length > 10 && !/\n\s+at /.test(inspected.error), `${what}: a plain message (${inspected.error})`);
    const prepared = await prepareModel(buf, opts());
    assert.ok(isError(prepared), `${what}: prepare refuses`);
  }
  const huge = await inspectModel(new ArrayBuffer(IMPORT_LIMITS.maxFileBytes + 1), 'huge.glb');
  assert.ok(isError(huge) && /100 ?MB/i.test(huge.error), 'the message names the limit');
});

test('a glTF whose resources are in other files is refused with advice', async () => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 10 }], scenes: [{ nodes: [] }], scene: 0 }));
  const r = await inspectModel(ab(json), 'model.gltf');
  assert.ok(isError(r));
  assert.match(r.error, /glb|zip|single file|embedded/i);
});

test('a file that is not an FBX is refused by fbxToGlb', async () => {
  await assert.rejects(() => fbxToGlb(ab(new Uint8Array(500).fill(7))));
});
