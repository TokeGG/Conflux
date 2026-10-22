// Rate limiting kept in the store, so it holds across Worker instances (best effort: KV is eventually consistent).
import type { Store } from './store.ts';

export class Limiter {
  constructor(private store: Store, private now: () => number = Date.now) {}

  private async read(key: string, windowMs: number): Promise<number[]> {
    const raw = await this.store.get(`rl:${key}`);
    const hits = raw ? (JSON.parse(raw) as number[]) : [];
    const t = this.now();
    return hits.filter((h) => t - h < windowMs);
  }

  /** True while fewer than `max` hits happened in the window. Does not count a hit. */
  async allowed(key: string, max: number, windowMs: number): Promise<boolean> {
    return (await this.read(key, windowMs)).length < max;
  }

  async hit(key: string, windowMs: number): Promise<void> {
    const hits = await this.read(key, windowMs);
    hits.push(this.now());
    await this.store.put(`rl:${key}`, JSON.stringify(hits.slice(-50)), Math.ceil(windowMs / 1000));
  }

  async clear(key: string): Promise<void> {
    await this.store.delete(`rl:${key}`);
  }
}
