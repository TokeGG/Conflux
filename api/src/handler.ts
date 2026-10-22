// The whole API as one function from Request to Response, so the Cloudflare Pages Function and the local Node server run the same code.
// Routes (all under /api): health, register, login, logout, me, tuning (GET all, PUT dev), admin/accounts, admin/grant, admin/log.
import { applyPatches, validatePatch, type DataPatch } from '../../shared/src/patch.ts';
import { defaultData } from '../../shared/src/files.ts';
import { Accounts, GRANTS, parseOwnerNames, type AccountRecord, type Grant } from './accounts.ts';
import type { Store } from './store.ts';

/** Configuration from the Pages project's environment variables. Nothing here is ever sent to the client. */
export interface ApiEnv {
  OWNER_CODE?: string;
  /** Comma-separated reserved names; default "toke". */
  OWNER_NAMES?: string;
}

export interface ApiOptions {
  /** Null when the KV binding is missing: every call but health answers 503 and the client plays as a guest. */
  store: Store | null;
  env: ApiEnv;
  now?: () => number;
}

const LOG_KEEP = 200;
const MAX_PATCHES = 500;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status: number, error: string): Response => json(status, { error });

export function createApi(opts: ApiOptions): (req: Request) => Promise<Response> {
  const now = opts.now ?? Date.now;
  const store = opts.store;
  const accounts = store ? new Accounts(store, { ownerCode: opts.env.OWNER_CODE || undefined, ownerNames: parseOwnerNames(opts.env.OWNER_NAMES), now }) : null;
  const base = defaultData();

  const log = async (text: string): Promise<void> => {
    if (!store) return;
    const rows = JSON.parse((await store.get('adminlog')) ?? '[]') as { at: number; text: string }[];
    rows.unshift({ at: now(), text });
    await store.put('adminlog', JSON.stringify(rows.slice(0, LOG_KEEP)));
  };

  return async (req) => {
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, '');
    if (!route.startsWith('/api/')) return fail(404, 'not found');
    const name = route.slice(5);
    if (name === 'health') return json(200, { ok: true, store: store?.kind ?? 'none' });
    if (!store || !accounts) return fail(503, 'Accounts are not set up on this server.');
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown';
    const token = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;
    const body = async (): Promise<Record<string, unknown>> => {
      try {
        const text = await req.text();
        if (text.length > 200_000) return {};
        const v = JSON.parse(text || '{}');
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    };
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const need = (method: string): Response | null => (req.method === method ? null : fail(405, `use ${method}`));
    const who = async (): Promise<AccountRecord | null> => accounts.resume(token);

    try {
      switch (name) {
        case 'register':
        case 'login': {
          const wrong = need('POST');
          if (wrong) return wrong;
          const b = await body();
          const r = name === 'register' ? await accounts.register(str(b.name), str(b.password), ip, str(b.code)) : await accounts.login(str(b.name), str(b.password), ip);
          if (!r.ok) return fail(r.status, r.reason);
          await log(`${name === 'register' ? 'registered' : 'signed in'}: ${r.account.name}`);
          return json(200, { token: r.token, account: accounts.info(r.account) });
        }
        case 'logout': {
          const wrong = need('POST');
          if (wrong) return wrong;
          if (token) await accounts.logout(token);
          return json(200, { ok: true });
        }
        case 'me': {
          const wrong = need('GET');
          if (wrong) return wrong;
          const a = await who();
          return a ? json(200, { account: accounts.info(a) }) : fail(401, 'Not signed in.');
        }
        case 'tuning': {
          if (req.method === 'GET') return json(200, { patches: JSON.parse((await store.get('tuning')) ?? '[]') });
          const wrong = need('PUT');
          if (wrong) return wrong;
          const a = await who();
          if (!a) return fail(401, 'Not signed in.');
          if (!accounts.info(a).dev) return fail(403, 'Dev access needed.');
          const raw = (await body()).patches;
          if (!Array.isArray(raw) || raw.length > MAX_PATCHES) return fail(400, 'patches must be a list');
          const patches: DataPatch[] = [];
          for (const p of raw as DataPatch[]) {
            if (!p || typeof p.path !== 'string' || !['number', 'boolean', 'string'].includes(typeof p.value)) return fail(400, 'bad patch');
            const err = validatePatch(base, p);
            if (err) return fail(400, err);
            patches.push({ path: p.path, value: p.value });
          }
          try {
            applyPatches(base, patches);
          } catch (e) {
            return fail(400, e instanceof Error ? e.message : 'patches do not apply');
          }
          await store.put('tuning', JSON.stringify(patches));
          await log(`${a.name} saved ${patches.length} tuning patches for everyone`);
          return json(200, { patches });
        }
        case 'admin/accounts':
        case 'admin/log':
        case 'admin/grant': {
          const a = await who();
          if (!a) return fail(401, 'Not signed in.');
          const me = accounts.info(a);
          if (name === 'admin/grant') {
            const wrong = need('POST');
            if (wrong) return wrong;
            if (me.role !== 'owner') return fail(403, 'Only the owner can change grants.');
            const b = await body();
            if (!GRANTS.includes(b.grant as Grant)) return fail(400, 'Unknown grant.');
            const t = await accounts.setGrant(str(b.name), b.grant as Grant, b.on === true);
            if (!t) return fail(404, 'No such account.');
            await log(`${b.on === true ? 'granted' : 'revoked'} ${b.grant} ${b.on === true ? 'to' : 'from'} ${t.name}`);
            return json(200, { account: accounts.info(t) });
          }
          if (me.role !== 'owner') return fail(403, 'Owner only.');
          const wrong = need('GET');
          if (wrong) return wrong;
          if (name === 'admin/accounts') return json(200, { accounts: await accounts.list() });
          return json(200, { log: ((JSON.parse((await store.get('adminlog')) ?? '[]') as { at: number; text: string }[]) ?? []) });
        }
        default:
          return fail(404, 'not found');
      }
    } catch (e) {
      return fail(500, e instanceof Error ? e.message : 'server error');
    }
  };
}
