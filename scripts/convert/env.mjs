import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { getBounds } from '@gltf-transform/functions';
const ex = process.argv[2], out = process.argv[3];
const kits = { graveyard: 'Graveyard Kit 5.0', dungeon: 'Modular Dungeon Kit 2.1', cave: 'Modular Cave Kit 1.0', forest: 'Mini Forest 1.0', minidungeon: 'Mini Dungeon 2.0', nature: 'Nature Kit' };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS); const index = {};
for (const [k, title] of Object.entries(kits)) {
  const dir = path.join(ex, 'kenney-' + k); const glbs = walk(dir).filter((f) => f.endsWith('.glb'));
  const gdir = path.dirname(glbs[0]); const dest = path.join(out, k); fs.mkdirSync(dest, { recursive: true });
  const texDir = fs.existsSync(path.join(gdir, 'Textures')) ? path.join(gdir, 'Textures') : walk(dir).map((f) => path.dirname(f)).find((d) => path.basename(d) === 'Textures');
  if (texDir) fs.cpSync(texDir, path.join(dest, 'Textures'), { recursive: true });
  const items = [];
  for (const f of glbs.filter((x) => path.dirname(x) === gdir)) {
    fs.copyFileSync(f, path.join(dest, path.basename(f)));
    try { const d = await io.read(f); const b = getBounds(d.getRoot().listScenes()[0]); let t = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? 0) / 3;
      items.push({ id: path.basename(f, '.glb'), size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)), min: b.min.map((v) => +v.toFixed(3)), tris: Math.round(t) }); } catch (e) { items.push({ id: path.basename(f, '.glb'), error: String(e).slice(0, 60) }); }
  }
  index[k] = { title, license: 'CC0 (Kenney)', items };
  const bytes = walk(dest).reduce((s, f) => s + fs.statSync(f).size, 0);
  console.log(k, items.length, 'pieces,', (bytes / 1e6).toFixed(1) + 'MB', 'textures:', texDir ? fs.readdirSync(texDir).join(',') : 'none');
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
