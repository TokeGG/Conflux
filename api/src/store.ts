// The place accounts live. One small interface, three backends: Cloudflare KV (production), memory (tests) and a JSON file (local
// Node server, see server/dev.ts). Web-standard only here; the file backend sits in fileStore.ts because it needs node:fs.
export interface Store {
  readonly kind: string;
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` makes the key expire (Cloudflare KV needs at least 60). */
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every key that starts with the prefix. */
  list(prefix: string): Promise<string[]>;
}

/** The parts of a Cloudflare KV namespace binding that are used. */
export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export class KvStore implements Store {
  readonly kind = 'cloudflare-kv';
  constructor(private kv: KvNamespaceLike) {}
  get(key: string) {
    return this.kv.get(key);
  }
  put(key: string, value: string, ttlSeconds?: number) {
    return this.kv.put(key, value, ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined);
  }
  delete(key: string) {
    return this.kv.delete(key);
  }
  async list(prefix: string) {
    const out: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const r = await this.kv.list({ prefix, cursor });
      out.push(...r.keys.map((k) => k.name));
      if (r.list_complete) break;
      cursor = r.cursor;
    }
    return out;
  }
}

export class MemoryStore implements Store {
  readonly kind: string = 'memory';
  protected data = new Map<string, { v: string; exp: number }>();
  constructor(protected now: () => number = Date.now) {}
  protected live(key: string) {
    const e = this.data.get(key);
    if (e && e.exp && e.exp <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.v ?? null;
  }
  async put(key: string, value: string, ttlSeconds?: number) {
    this.data.set(key, { v: value, exp: ttlSeconds ? this.now() + ttlSeconds * 1000 : 0 });
    this.changed();
  }
  async delete(key: string) {
    this.data.delete(key);
    this.changed();
  }
  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix) && this.live(k));
  }
  protected changed(): void {}
}

/** A fake KV namespace for tests: same behaviour as the real one (pages of keys, a minimum ttl). */
export function fakeKv(pageSize = 1000): KvNamespaceLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    async get(k) {
      return raw.get(k) ?? null;
    },
    async put(k, v, o) {
      if (o?.expirationTtl !== undefined && o.expirationTtl < 60) throw new Error('KV needs an expirationTtl of at least 60');
      raw.set(k, v);
    },
    async delete(k) {
      raw.delete(k);
    },
    async list({ prefix, cursor }) {
      const all = [...raw.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + pageSize).map((name) => ({ name }));
      const done = start + pageSize >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(start + pageSize) };
    },
  };
}
