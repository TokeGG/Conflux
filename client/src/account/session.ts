// The player's account as the client knows it: a token in this browser, the account the server says it belongs to, and the calls to /api.
// Every call fails soft: no answer (local Vite without the API, offline, a missing KV binding) means playing as a guest.
import type { DataPatch } from '@conflux/shared';

export interface AccountInfo {
  name: string;
  role: 'owner' | 'player';
  grants: string[];
  dev: boolean;
  admin: boolean;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface TokenStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = 'conflux.token';

/** Where the API lives: same origin by default; VITE_API_URL overrides it (empty by default). */
export const apiBase = (env: Record<string, unknown> = {}): string => String(env.VITE_API_URL ?? '').replace(/\/+$/, '');

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string; offline?: boolean };

export class AccountSession {
  account: AccountInfo | null = null;

  constructor(
    private storage: TokenStorage | null,
    private fetcher: Fetch,
    private base = '',
    private timeoutMs = 3000,
  ) {}

  get token(): string | null {
    try {
      return this.storage?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  }

  private setToken(t: string | null): void {
    try {
      if (t) this.storage?.setItem(KEY, t);
      else this.storage?.removeItem(KEY);
    } catch {
      /* blocked storage: the session lasts until reload */
    }
  }

  /** One call to the API. A reply that is not JSON (the static site answering a path it does not know) counts as no API. */
  async call<T>(method: string, path: string, body?: unknown): Promise<Outcome<T>> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const token = this.token;
      const res = await this.fetcher(`${this.base}/api/${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl?.signal,
      });
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return { ok: false, error: 'No account server here.', offline: true };
      }
      if (res.status === 503) return { ok: false, error: 'Accounts are not set up on this server.', offline: true };
      if (!res.ok) return { ok: false, error: String((data as { error?: string })?.error ?? `Error ${res.status}`) };
      return { ok: true, value: data as T };
    } catch {
      return { ok: false, error: 'No account server here.', offline: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Looks the stored token up. Null (a guest) when there is none, it is stale, or the server does not answer. */
  async resume(): Promise<AccountInfo | null> {
    this.account = null;
    if (!this.token) return null;
    const r = await this.call<{ account: AccountInfo }>('GET', 'me');
    if (r.ok) this.account = r.value.account;
    else if (!r.offline) this.setToken(null); // the server said no: the session ended
    return this.account;
  }

  private async enter(path: string, body: Record<string, string>): Promise<Outcome<AccountInfo>> {
    const r = await this.call<{ token: string; account: AccountInfo }>('POST', path, body);
    if (!r.ok) return r;
    this.setToken(r.value.token);
    this.account = r.value.account;
    return { ok: true, value: r.value.account };
  }

  register(name: string, password: string, code?: string) {
    return this.enter('register', { name, password, ...(code ? { code } : {}) });
  }

  login(name: string, password: string) {
    return this.enter('login', { name, password });
  }

  async logout(): Promise<void> {
    await this.call('POST', 'logout', {});
    this.setToken(null);
    this.account = null;
  }

  async fetchTuning(): Promise<DataPatch[]> {
    const r = await this.call<{ patches: DataPatch[] }>('GET', 'tuning');
    return r.ok && Array.isArray(r.value.patches) ? r.value.patches : [];
  }

  saveTuning(patches: DataPatch[]) {
    return this.call<{ patches: DataPatch[] }>('PUT', 'tuning', { patches });
  }
}
