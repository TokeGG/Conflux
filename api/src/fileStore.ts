// Local backend: the same store kept in one JSON file. Node only (tests and server/dev.ts); the Pages Function never imports this.
import fs from 'node:fs';
import { MemoryStore } from './store.ts';

export class FileStore extends MemoryStore {
  override readonly kind: string = 'file';
  constructor(private path: string, now?: () => number) {
    super(now);
    try {
      const saved = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, { v: string; exp: number }>;
      for (const [k, e] of Object.entries(saved)) this.data.set(k, e);
    } catch {
      /* no file yet, or unreadable: start empty */
    }
  }
  protected override changed(): void {
    if (!this.path) return;
    fs.writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.data)), { mode: 0o600 });
  }
}
