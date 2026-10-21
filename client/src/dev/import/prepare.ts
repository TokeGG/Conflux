// Gets an uploaded model ready for the game: fitted to a height with its feet on the ground, within the triangle budget, with
// textures no bigger than the limit. Skins and clips are kept. Runs in the browser; the image resizer is passed in.
import { dedup, getBounds, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { imageSize, IMPORT_LIMITS } from './limits.ts';
import { countTriangles, isImportError, makeIO, readModel, reportOf, type ImportError, type ModelReport } from './inspect.ts';

export interface PreparedModel {
  glb: Uint8Array;
  report: ModelReport;
}

export interface PrepareOptions {
  heightM: number;
  kind: 'mob' | 'boss';
  /** Shrinks an encoded image so neither side is above max, returning the same format. */
  resize: (img: Uint8Array, mime: string, max: number) => Promise<Uint8Array>;
  /** Extra turn about the vertical axis, for models that do not face +Z. */
  turnDegrees?: number;
}

export async function prepareModel(buf: ArrayBuffer, opts: PrepareOptions, name = 'model.glb'): Promise<PreparedModel | ImportError> {
  try {
    const doc = await readModel(buf, name);
    if (isImportError(doc)) return doc;
    const first = reportOf(doc);
    if (isImportError(first)) return first;
    if (!(opts.heightM > 0)) return { error: 'The height must be more than zero.' };

    // fit: turn, scale to the height, centre on x and z, stand on y = 0 (one parent node, so skins and clips scale with it)
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
    const wrapper = doc.createNode('ImportRoot');
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      wrapper.addChild(child);
    }
    scene.addChild(wrapper);
    const half = ((opts.turnDegrees ?? 0) * Math.PI) / 360;
    wrapper.setRotation([0, Math.sin(half), 0, Math.cos(half)]);
    const scale = opts.heightM / (first.size.y || 1);
    wrapper.setScale([scale, scale, scale]);
    const b = getBounds(scene);
    wrapper.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);

    // triangles: cut to the budget with the meshopt simplifier
    const budget = opts.kind === 'boss' ? IMPORT_LIMITS.bossTris : IMPORT_LIMITS.mobTris;
    await MeshoptSimplifier.ready;
    let ratio = (budget * 0.95) / Math.max(1, countTriangles(doc));
    for (let pass = 0; pass < 5 && countTriangles(doc) > budget; pass++) {
      await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 1, lockBorder: false }));
      ratio = (budget * 0.9) / Math.max(1, countTriangles(doc));
    }
    if (countTriangles(doc) > budget) return { error: `The model could not be reduced to ${budget.toLocaleString()} triangles.` };

    // textures: nothing bigger than the limit
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      const size = img ? imageSize(img) : null;
      if (img && size && Math.max(size.w, size.h) > IMPORT_LIMITS.maxTexture) tex.setImage(await opts.resize(img, tex.getMimeType(), IMPORT_LIMITS.maxTexture));
    }
    await doc.transform(dedup(), prune({ keepSolidTextures: true }));

    const io = await makeIO();
    const glb = await io.writeBinary(doc);
    const report = reportOf(await io.readBinary(glb));
    if (isImportError(report)) return report;
    return { glb, report };
  } catch (e) {
    return { error: `The model could not be prepared: ${e instanceof Error ? e.message : String(e)}` };
  }
}
