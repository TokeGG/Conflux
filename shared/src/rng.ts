// Seeded random numbers. The sim never calls Math.random(): every draw comes from one of four named streams so that
// drawing from one system (say combat) can never change the numbers another system (say the map) sees.

/** xmur3-style string hash producing four 32-bit words from a key. */
function hashWords(key: string): [number, number, number, number] {
  let h = 1779033703 ^ key.length;
  const words: number[] = [];
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  for (let k = 0; k < 4; k++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    words.push((h ^= h >>> 16) >>> 0);
  }
  return words as [number, number, number, number];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private readonly seed: number;
  private readonly path: string;

  constructor(seed: number, path = '') {
    this.seed = seed;
    this.path = path;
    [this.a, this.b, this.c, this.d] = hashWords(`${seed}|${path}`);
    for (let i = 0; i < 15; i++) this.nextU32(); // sfc32 warm-up
  }

  private nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** An integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('cannot pick from an empty array');
    return items[this.int(items.length)];
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    if (!(total > 0)) throw new Error('weighted needs a positive total weight');
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }

  /** The four generator words, for hashing the state of a stream. */
  state(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** A new stream named by `label`. It depends only on this stream's seed and path, never on how much has been drawn. */
  fork(label: string): Rng {
    return new Rng(this.seed, `${this.path}/${label}`);
  }
}

export interface Streams {
  map: Rng;
  encounter: Rng;
  reward: Rng;
  combat: Rng;
}

export function makeStreams(seed: number): Streams {
  const root = new Rng(seed);
  return { map: root.fork('map'), encounter: root.fork('encounter'), reward: root.fork('reward'), combat: root.fork('combat') };
}
