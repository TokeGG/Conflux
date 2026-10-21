// Reads a model file and reports what is in it, or says in plain words why it cannot be used. Nothing here throws at the caller.
import { Document, WebIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { Vec3 } from '@conflux/shared';
import { IMPORT_LIMITS, imageSize } from './limits.ts';

export interface ModelReport {
  meshes: number;
  triangles: number;
  hasSkin: boolean;
  bones: string[];
  clips: { name: string; duration: number }[];
  textures: { name: string; w: number; h: number }[];
  size: Vec3;
  /** The lowest corner of the bounding box. */
  min: Vec3;
  warnings: string[];
}

export interface ImportError {
  error: string;
}

export const isImportError = (x: unknown): x is ImportError => typeof x === 'object' && x !== null && 'error' in x;

export async function makeIO(): Promise<WebIO> {
  await MeshoptDecoder.ready;
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

const MB = Math.round(IMPORT_LIMITS.maxFileBytes / 1e6);
const UNREADABLE = 'That file could not be read as a 3D model. It may be cut off, damaged, or a different kind of file.';

function dataUri(uri: string): Uint8Array<ArrayBuffer> | null {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  if (m[1]) {
    const s = atob(m[2]);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(new TextEncoder().encode(decodeURIComponent(m[2])));
}

/** The document in a file, or the reason it cannot be read. Accepts .glb, and .gltf with everything embedded. */
export async function readModel(buf: ArrayBuffer, name: string): Promise<Document | ImportError> {
  if (buf.byteLength > IMPORT_LIMITS.maxFileBytes) return { error: `That file is bigger than the ${MB} MB limit (${(buf.byteLength / 1e6).toFixed(0)} MB).` };
  if (buf.byteLength < 12) return { error: UNREADABLE };
  const bytes = new Uint8Array(buf);
  try {
    const io = await makeIO();
    if (bytes[0] === 0x7b) {
      const json = JSON.parse(new TextDecoder().decode(bytes));
      const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
      for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])] as { uri?: string }[]) {
        if (!ref.uri) continue;
        const data = dataUri(ref.uri);
        if (!data) return { error: `${name} needs other files next to it (${ref.uri}). Upload a single .glb, or a .zip with everything inside.` };
        resources[ref.uri] = data;
      }
      return await io.readJSON({ json, resources });
    }
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'glTF') return { error: UNREADABLE };
    return await io.readBinary(bytes);
  } catch {
    return { error: UNREADABLE };
  }
}

const triangleCount = (p: Primitive): number => {
  if (p.getMode() !== 4) return 0;
  const idx = p.getIndices();
  const pos = p.getAttribute('POSITION');
  return Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
};

export function countTriangles(doc: Document): number {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += triangleCount(p);
  return t;
}

/** What is in a model, with warnings for things the game will not like. An error when there is nothing to show. */
export function reportOf(doc: Document): ModelReport | ImportError {
  const root = doc.getRoot();
  const meshes = root.listMeshes().length;
  const triangles = countTriangles(doc);
  if (meshes === 0 || triangles === 0) return { error: 'The file has no mesh in it, so there is nothing to show.' };
  const warnings: string[] = [];
  const bones = [...new Set(root.listSkins().flatMap((s) => s.listJoints().map((j) => j.getName())))];
  const clips = root.listAnimations().map((a) => ({
    name: a.getName(),
    duration: Math.max(0, ...a.listSamplers().map((s) => Math.max(0, ...(s.getInput()?.getArray() ?? [0])))),
  }));
  const textures = root.listTextures().map((t) => {
    const img = t.getImage();
    const size = img ? imageSize(img) : null;
    if (!size) warnings.push(`The texture "${t.getName() || 'unnamed'}" is in a format the importer cannot measure; it may not display.`);
    return { name: t.getName() || t.getURI() || 'texture', w: size?.w ?? 0, h: size?.h ?? 0 };
  });
  if (triangles > IMPORT_LIMITS.bossTris) warnings.push(`${triangles.toLocaleString()} triangles is a lot; it will be reduced to the budget (${IMPORT_LIMITS.mobTris.toLocaleString()} for a mob, ${IMPORT_LIMITS.bossTris.toLocaleString()} for a boss).`);
  else if (triangles > IMPORT_LIMITS.mobTris) warnings.push(`${triangles.toLocaleString()} triangles is over the mob budget of ${IMPORT_LIMITS.mobTris.toLocaleString()}; it will be reduced.`);
  for (const t of textures) if (Math.max(t.w, t.h) > IMPORT_LIMITS.maxTexture) warnings.push(`The texture "${t.name}" is ${t.w} by ${t.h}; it will be scaled down to ${IMPORT_LIMITS.maxTexture}.`);
  const extra = root.listMeshes().some((m) => m.listPrimitives().some((p) => p.getAttribute('JOINTS_1') || p.getAttribute('WEIGHTS_1')));
  if (extra) warnings.push('Some vertices have more than 4 skin weights. The extra weights are kept but the game only uses 4, so bending may look slightly off.');
  if (root.listSkins().length > 0 && clips.length === 0) warnings.push('The model has a skeleton but no animation clips; it will need procedural motion or clips of its own.');
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = getBounds(scene);
  const size = { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
  return { meshes, triangles, hasSkin: root.listSkins().length > 0, bones, clips, textures, size, min: { x: b.min[0], y: b.min[1], z: b.min[2] }, warnings };
}

export async function inspectModel(buf: ArrayBuffer, name: string): Promise<ModelReport | ImportError> {
  const doc = await readModel(buf, name);
  return isImportError(doc) ? doc : reportOf(doc);
}
