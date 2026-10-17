import { createExtractorFromData } from 'node-unrar-js'; import fs from 'node:fs'; import path from 'node:path';
const [, , rar, out] = process.argv; fs.mkdirSync(out, { recursive: true });
const ex = await createExtractorFromData({ data: new Uint8Array(fs.readFileSync(rar)) });
const { files } = ex.extract(); let n = 0;
for (const f of files) { if (f.fileHeader.flags.directory || !f.extraction) continue; const dest = path.join(out, f.fileHeader.name.replace(/\.\.+/g, '')); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, f.extraction); n++; }
console.log(path.basename(rar), 'extracted', n);
