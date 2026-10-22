// Local stand-in for the Pages Function: serves the same handler from Node with a JSON file as the store.
//   OWNER_CODE=letmein npx tsx server/dev.ts          (port 8788, file .superpowers/dev-store.json; Vite proxies /api to it)
// Never use this in production: the store is a plain file.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApi } from '../api/src/handler.ts';
import { FileStore } from '../api/src/fileStore.ts';

export function startDevServer(opts: { port: number; storeFile: string; env: { OWNER_CODE?: string; OWNER_NAMES?: string } }): Promise<http.Server> {
  fs.mkdirSync(path.dirname(opts.storeFile), { recursive: true });
  const api = createApi({ store: new FileStore(opts.storeFile), env: opts.env });
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('cf-connecting-ip', req.socket.remoteAddress ?? 'local');
    const body = chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined;
    const r = await api(new Request(`http://localhost${req.url ?? '/'}`, { method: req.method, headers, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(opts.port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1]?.endsWith('dev.ts')) {
  const port = Number(process.env.PORT) || 8788;
  await startDevServer({ port, storeFile: process.env.STORE_FILE ?? '.superpowers/dev-store.json', env: { OWNER_CODE: process.env.OWNER_CODE, OWNER_NAMES: process.env.OWNER_NAMES } });
  console.log(`conflux dev API on http://127.0.0.1:${port}/api (owner code ${process.env.OWNER_CODE ? 'set' : 'NOT set: reserved names cannot be registered'})`);
}
