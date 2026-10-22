// Accounts: name + password (PBKDF2), sessions by token, reserved owner names, grants. Only Web-standard APIs.
import { hashPassword, fromB64, newToken, randomBytes, safeEqual, sha256, toB64, PBKDF2_ITERATIONS } from './crypto.ts';
import { Limiter } from './limiter.ts';
import type { Store } from './store.ts';

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const GRANTS = ['dev', 'admin'] as const;
export type Grant = (typeof GRANTS)[number];
const SESSION_SECONDS = 30 * 24 * 3600;

export interface AccountRecord {
  key: string;
  name: string;
  salt: string;
  hash: string;
  iterations: number;
  createdAt: number;
  role: 'owner' | 'player';
  grants: Grant[];
  lastSeen: number;
}

/** What the client may see of an account. `dev` and `admin` already include the owner's powers. */
export interface AccountInfo {
  name: string;
  role: 'owner' | 'player';
  grants: Grant[];
  dev: boolean;
  admin: boolean;
}

export interface AccountsConfig {
  ownerCode?: string;
  /** Lower-case names only the owner code can register. */
  ownerNames: string[];
  now?: () => number;
}

export type AuthResult = { ok: true; account: AccountRecord; token: string } | { ok: false; status: number; reason: string };

export const parseOwnerNames = (raw: string | undefined): string[] =>
  (raw ?? 'toke')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

export class Accounts {
  private limiter: Limiter;
  private now: () => number;

  constructor(private store: Store, private cfg: AccountsConfig) {
    this.now = cfg.now ?? Date.now;
    this.limiter = new Limiter(store, this.now);
  }

  isOwnerName(name: string): boolean {
    return this.cfg.ownerNames.includes(name.toLowerCase());
  }

  /** The owner is an account made with the owner code whose name is still on the reserved list. */
  isOwner(a: AccountRecord): boolean {
    return a.role === 'owner' && this.isOwnerName(a.name);
  }

  info(a: AccountRecord): AccountInfo {
    const owner = this.isOwner(a);
    return { name: a.name, role: owner ? 'owner' : 'player', grants: a.grants, dev: owner || a.grants.includes('dev'), admin: owner || a.grants.includes('admin') };
  }

  async get(name: string): Promise<AccountRecord | null> {
    const raw = await this.store.get(`acct:${name.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as AccountRecord) : null;
  }

  private save(a: AccountRecord): Promise<void> {
    return this.store.put(`acct:${a.key}`, JSON.stringify(a));
  }

  private async session(key: string): Promise<string> {
    const token = newToken();
    await this.store.put(`sess:${await sha256(token)}`, key, SESSION_SECONDS);
    return token;
  }

  async register(name: string, password: string, ip: string, code?: string): Promise<AuthResult> {
    if (!NAME_RE.test(name)) return { ok: false, status: 400, reason: 'Names are 3-16 letters, numbers or underscores.' };
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, status: 400, reason: `Passwords are ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` };
    const reserved = this.isOwnerName(name);
    if (reserved) {
      // nobody can prove they are the owner without a code on the server, so then the name is simply not available
      const key = `owner:${ip}`;
      if (!(await this.limiter.allowed(key, 5, 10 * 60_000))) return { ok: false, status: 429, reason: 'Too many wrong codes. Wait a few minutes.' };
      if (!this.cfg.ownerCode || typeof code !== 'string' || !safeEqual(code, this.cfg.ownerCode)) {
        await this.limiter.hit(key, 10 * 60_000);
        return { ok: false, status: 403, reason: 'That name is reserved. Enter the owner code to register it.' };
      }
    }
    if (!(await this.limiter.allowed(`reg:${ip}`, 5, 3600_000))) return { ok: false, status: 429, reason: 'Too many new accounts from your network. Try again later.' };
    const key = name.toLowerCase();
    if (await this.store.get(`acct:${key}`)) return { ok: false, status: 409, reason: 'That name is taken.' };
    const salt = randomBytes(16);
    const record: AccountRecord = { key, name, salt: toB64(salt), hash: await hashPassword(password, salt), iterations: PBKDF2_ITERATIONS, createdAt: this.now(), role: reserved ? 'owner' : 'player', grants: [], lastSeen: this.now() };
    await this.save(record);
    await this.limiter.hit(`reg:${ip}`, 3600_000);
    return { ok: true, account: record, token: await this.session(key) };
  }

  async login(name: string, password: string, ip: string): Promise<AuthResult> {
    const ipKey = `login:${ip}|${name.toLowerCase()}`;
    const nameKey = `loginname:${name.toLowerCase()}`;
    if (!(await this.limiter.allowed(ipKey, 6, 10 * 60_000)) || !(await this.limiter.allowed(nameKey, 30, 15 * 60_000))) return { ok: false, status: 429, reason: 'Too many failed attempts. Wait a few minutes.' };
    const a = await this.get(name);
    // hash even for unknown names so timing does not show which accounts exist
    const salt = a ? fromB64(a.salt) : randomBytes(16);
    const got = await hashPassword(password, salt, a?.iterations ?? PBKDF2_ITERATIONS);
    if (!a || !safeEqual(got, a.hash)) {
      await this.limiter.hit(ipKey, 10 * 60_000);
      await this.limiter.hit(nameKey, 15 * 60_000);
      return { ok: false, status: 401, reason: 'Wrong name or password.' };
    }
    await this.limiter.clear(ipKey);
    a.lastSeen = this.now();
    await this.save(a);
    return { ok: true, account: a, token: await this.session(a.key) };
  }

  /** The account a session token belongs to, or null. */
  async resume(token: string | null): Promise<AccountRecord | null> {
    if (!token) return null;
    const key = await this.store.get(`sess:${await sha256(token)}`);
    return key ? this.get(key) : null;
  }

  async logout(token: string): Promise<void> {
    await this.store.delete(`sess:${await sha256(token)}`);
  }

  /** Grants or revokes. The caller has already checked that the actor is the owner. Null when the account does not exist. */
  async setGrant(name: string, grant: Grant, on: boolean): Promise<AccountRecord | null> {
    const a = await this.get(name);
    if (!a) return null;
    a.grants = on ? [...new Set([...a.grants, grant])] : a.grants.filter((g) => g !== grant);
    await this.save(a);
    return a;
  }

  async list(): Promise<AccountInfo[]> {
    const out: AccountInfo[] = [];
    for (const k of await this.store.list('acct:')) {
      const raw = await this.store.get(k);
      if (raw) out.push({ ...this.info(JSON.parse(raw) as AccountRecord) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
