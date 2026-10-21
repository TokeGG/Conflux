// Writes the small model fixtures the import tests read. Run once; the files are committed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../client/test/fixtures/build.ts';

const dir = fileURLToPath(new URL('../client/test/fixtures/', import.meta.url));
const cube = await buildModel();
writeFileSync(`${dir}cube.glb`, cube);
writeFileSync(`${dir}skinned.glb`, await buildModel({ grid: 8, skinned: true }));
// a model cut off part way through, as a failed download leaves it
writeFileSync(`${dir}broken.glb`, cube.subarray(0, Math.floor(cube.length * 0.6)));
console.log('fixtures written');
