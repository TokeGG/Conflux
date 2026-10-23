// A tiny static site for screenshot scripts: serves client/dist with the account API in-process and signs ?dev pages in as the owner.
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../../api/src/handler.ts';
import { MemoryStore } from '../../api/src/store.ts';

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg' };

export async function startSite(): Promise<{ url: string; browser: Browser; open(query: string): Promise<{ page: Page; errors: string[] }>; close(): Promise<void> }> {
  const code = 'shot-owner-code';
  const api = createApi({ store: new MemoryStore(), env: { OWNER_CODE: code, OWNER_NAMES: 'shotowner' } });
  const reg = await api(new Request('http://x.test/api/register', { method: 'POST', body: JSON.stringify({ name: 'shotowner', password: 'shot-password-1', code }) }));
  const token: string = ((await reg.json()) as { token: string }).token;
  const dist = process.env.DIST ?? fileURLToPath(new URL('../../client/dist/', import.meta.url));
  const server = createServer(async (req, res) => {
    if ((req.url ?? '').startsWith('/api/')) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await api(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === 'GET' || !chunks.length ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let f = join(dist, p);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const browser = await chromium.launch({ executablePath: join(root, readdirSync(root).find((d) => d.startsWith('chromium-'))!, 'chrome-linux/chrome'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  return {
    url,
    browser,
    async open(query) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.addInitScript((t) => localStorage.setItem('conflux.token', t), token);
      await page.goto(`${url}${query}`);
      return { page, errors };
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}
