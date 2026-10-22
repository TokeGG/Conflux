// The procedural props, as boxes. scripts/gen-pieces.ts writes them to shared/data/proc.json. Everything here is deterministic (a fixed
// seed per prop), in metres, with the origin at the prop's low corner. Colours are dark and muted: rooms are lit by braziers and candles.
import type { ProcBox, ProcDef } from '../shared/src/gen/proc.ts';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;
const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string, wood: 0 | 1 = 0): ProcBox => [r3(x), r3(y), r3(z), r3(w), r3(h), r3(d), color, wood];

const WOOD = '#9a7048';
const WOOD_DARK = '#7a5638';
const BOOKS = ['#6a1f24', '#2c4a63', '#3d5a34', '#6b5222', '#4a2a5c', '#7a3b22', '#25403f', '#8a7a55'];
const BONE = ['#cdc5aa', '#bdb497', '#d8d1b8', '#aaa38a'];
const IRON = '#3a3f47';
const STONE = '#5c5a58';

/** A row of upright books between x0 and x1 on a shelf board, standing on `y`, from `z` back, with the odd gap and leaning stack. */
function bookRow(r: () => number, x0: number, x1: number, y: number, z: number, maxH: number, out: ProcBox[]): void {
  let x = x0;
  while (x < x1 - 0.1) {
    if (r() < 0.07) {
      x += 0.12 + r() * 0.2; // a gap
      continue;
    }
    const w = 0.06 + r() * 0.1;
    const h = maxH * (0.72 + r() * 0.28);
    const d = 0.24 + r() * 0.1;
    if (x + w > x1) break;
    out.push(box(x, y, z + (0.34 - d) * 0.5, w, h, d, BOOKS[Math.floor(r() * BOOKS.length)]));
    x += w + 0.005;
  }
}

function bookshelf(rows: number, seed: number): ProcDef {
  const r = rng(seed);
  const w = 2.4;
  const d = 0.5;
  const rowH = 0.5;
  const h = 0.12 + rows * rowH + 0.1;
  const boxes: ProcBox[] = [];
  boxes.push(box(0, 0, 0, w, 0.12, d, WOOD_DARK, 1)); // plinth
  boxes.push(box(0, 0, 0, 0.1, h, d, WOOD, 1)); // sides
  boxes.push(box(w - 0.1, 0, 0, 0.1, h, d, WOOD, 1));
  boxes.push(box(0.1, 0.12, 0, w - 0.2, h - 0.12, 0.05, WOOD_DARK, 1)); // back
  boxes.push(box(-0.04, h - 0.1, -0.04, w + 0.08, 0.1, d + 0.08, WOOD, 1)); // cornice
  for (let i = 0; i < rows; i++) {
    const y = 0.12 + i * rowH;
    if (i > 0) boxes.push(box(0.1, y, 0.05, w - 0.2, 0.05, d - 0.05, WOOD, 1)); // board
    bookRow(r, 0.12, w - 0.12, y + (i > 0 ? 0.05 : 0), 0.1, rowH - 0.1, boxes);
  }
  return { boxes };
}

function readingTable(): ProcDef {
  const r = rng(11);
  const boxes: ProcBox[] = [];
  boxes.push(box(0, 0.8, 0, 1.8, 0.1, 0.9, WOOD, 1)); // top
  for (const [x, z] of [[0.08, 0.08], [1.64, 0.08], [0.08, 0.74], [1.64, 0.74]]) boxes.push(box(x, 0, z, 0.1, 0.8, 0.1, WOOD_DARK, 1));
  boxes.push(box(0.1, 0.45, 0.4, 1.6, 0.06, 0.08, WOOD_DARK, 1)); // stretcher
  // an open book and a short stack
  boxes.push(box(0.4, 0.9, 0.2, 0.34, 0.03, 0.46, '#5a1c20'));
  boxes.push(box(0.43, 0.93, 0.23, 0.3, 0.02, 0.4, '#d8d0b4'));
  boxes.push(box(0.74, 0.9, 0.2, 0.34, 0.03, 0.46, '#5a1c20'));
  boxes.push(box(0.74, 0.93, 0.23, 0.3, 0.02, 0.4, '#cfc7a8'));
  let y = 0.9;
  for (let i = 0; i < 3; i++) {
    const h = 0.05 + r() * 0.04;
    boxes.push(box(1.3 + r() * 0.06, y, 0.3 + r() * 0.08, 0.3, h, 0.22, BOOKS[Math.floor(r() * BOOKS.length)]));
    y += h;
  }
  return { boxes };
}

function lectern(): ProcDef {
  const boxes: ProcBox[] = [];
  boxes.push(box(0.05, 0, 0.05, 0.6, 0.08, 0.5, WOOD_DARK, 1)); // foot
  boxes.push(box(0.2, 0.08, 0.2, 0.3, 0.8, 0.2, WOOD, 1)); // stem
  // a sloped desk as three steps
  boxes.push(box(0, 0.88, 0.02, 0.7, 0.06, 0.12, WOOD, 1));
  boxes.push(box(0, 0.94, 0.12, 0.7, 0.06, 0.12, WOOD, 1));
  boxes.push(box(0, 1.0, 0.22, 0.7, 0.06, 0.12, WOOD, 1));
  boxes.push(box(0, 1.06, 0.32, 0.7, 0.06, 0.12, WOOD, 1));
  boxes.push(box(-0.02, 0.88, 0.02, 0.04, 0.28, 0.44, WOOD_DARK, 1)); // cheeks
  boxes.push(box(0.68, 0.88, 0.02, 0.04, 0.28, 0.44, WOOD_DARK, 1));
  boxes.push(box(0.1, 1.1, 0.18, 0.5, 0.04, 0.3, '#5a1c20')); // the book
  boxes.push(box(0.14, 1.14, 0.2, 0.42, 0.02, 0.26, '#d2cab0'));
  return { boxes };
}

function bookStack(): ProcDef {
  const r = rng(5);
  const boxes: ProcBox[] = [];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const h = 0.06 + r() * 0.05;
    boxes.push(box(r() * 0.06, y, r() * 0.05, 0.34 - r() * 0.06, h, 0.24 - r() * 0.04, BOOKS[Math.floor(r() * BOOKS.length)]));
    y += h;
  }
  return { boxes };
}

function bonePile(): ProcDef {
  const r = rng(21);
  const boxes: ProcBox[] = [];
  // a mound: bones laid across each other, lower toward the edge
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const dist = Math.sqrt(r()) * 0.7;
    const px = 0.8 + Math.cos(a) * dist;
    const pz = 0.8 + Math.sin(a) * dist;
    const top = 0.45 * (1 - dist / 0.85);
    const y = Math.max(0, top * r());
    const len = 0.35 + r() * 0.5;
    const t = 0.05 + r() * 0.04;
    const along = r() < 0.5;
    const c = BONE[Math.floor(r() * BONE.length)];
    boxes.push(along ? box(px - len / 2, y, pz - t / 2, len, t, t, c) : box(px - t / 2, y, pz - len / 2, t, t, len, c));
    // the knobbed ends
    boxes.push(along ? box(px - len / 2 - 0.02, y - 0.01, pz - t * 0.8, 0.08, t * 1.4, t * 1.6, c) : box(px - t * 0.8, y - 0.01, pz - len / 2 - 0.02, t * 1.6, t * 1.4, 0.08, c));
  }
  boxes.push(box(0.4, 0, 0.45, 0.8, 0.12, 0.8, '#5a5240')); // the packed dirt under it, so it stands on something
  for (let i = 0; i < 3; i++) skull(boxes, 0.45 + r() * 0.7, 0.14 + i * 0.1, 0.45 + r() * 0.7, 0.22, r);
  return { boxes };
}

/** A skull: a cube with dark eye sockets and a jaw. */
function skull(out: ProcBox[], x: number, y: number, z: number, s: number, r: () => number): void {
  const c = BONE[Math.floor(r() * BONE.length)];
  out.push(box(x, y + s * 0.3, z, s, s * 0.7, s * 0.85, c));
  out.push(box(x + s * 0.12, y, z + s * 0.1, s * 0.76, s * 0.3, s * 0.6, '#b3ab90'));
  out.push(box(x + s * 0.15, y + s * 0.5, z + s * 0.84, s * 0.2, s * 0.22, 0.02, '#16130f'));
  out.push(box(x + s * 0.65, y + s * 0.5, z + s * 0.84, s * 0.2, s * 0.22, 0.02, '#16130f'));
}

function skullHeap(): ProcDef {
  const r = rng(33);
  const boxes: ProcBox[] = [];
  const s = 0.24;
  // a pyramid of skulls: 4 x 4, 3 x 3, 2 x 2, 1
  for (let layer = 0; layer < 4; layer++) {
    const n = 4 - layer;
    const off = (layer * s * 1.1) / 2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        skull(boxes, off + i * s * 1.1 + (r() - 0.5) * 0.04, layer * s * 0.78, off + j * s * 1.1 + (r() - 0.5) * 0.04, s, r);
      }
    }
  }
  return { boxes };
}

function crate(): ProcDef {
  const boxes: ProcBox[] = [];
  const s = 0.9;
  boxes.push(box(0, 0, 0, s, s, s, WOOD_DARK, 1)); // the body
  for (const [x, z] of [[0, 0], [s - 0.1, 0], [0, s - 0.1], [s - 0.1, s - 0.1]]) boxes.push(box(x - 0.01, 0, z - 0.01, 0.12, s, 0.12, WOOD, 1)); // corner posts
  boxes.push(box(-0.015, 0.12, 0.1, s + 0.03, 0.12, s - 0.2, WOOD, 1)); // slats
  boxes.push(box(0.1, 0.12, -0.015, s - 0.2, 0.12, s + 0.03, WOOD, 1));
  boxes.push(box(-0.015, s - 0.26, 0.1, s + 0.03, 0.12, s - 0.2, WOOD, 1));
  boxes.push(box(0.1, s - 0.26, -0.015, s - 0.2, 0.12, s + 0.03, WOOD, 1));
  boxes.push(box(-0.02, s - 0.02, -0.02, s + 0.04, 0.05, s + 0.04, WOOD, 1)); // lid
  return { boxes };
}

function cellBars(): ProcDef {
  const boxes: ProcBox[] = [];
  const w = 4;
  const h = 3;
  boxes.push(box(0, 0, 0, 0.3, h, 0.4, STONE)); // posts
  boxes.push(box(w - 0.3, 0, 0, 0.3, h, 0.4, STONE));
  boxes.push(box(0.3, 0, 0.1, w - 0.6, 0.12, 0.2, IRON)); // bottom rail
  boxes.push(box(0.3, h - 0.18, 0.1, w - 0.6, 0.18, 0.2, IRON)); // top rail
  boxes.push(box(0.3, 1.5, 0.125, w - 0.6, 0.08, 0.15, IRON)); // crossbar
  for (let x = 0.5; x < w - 0.35; x += 0.26) boxes.push(box(x, 0.12, 0.15, 0.07, h - 0.3, 0.1, IRON));
  boxes.push(box(w / 2 - 0.2, 1.2, 0.08, 0.4, 0.5, 0.06, '#4a4f58')); // a lock plate
  return { boxes };
}

function pew(): ProcDef {
  const boxes: ProcBox[] = [];
  const w = 2.2;
  boxes.push(box(0, 0.42, 0.18, w, 0.08, 0.5, WOOD, 1)); // seat
  boxes.push(box(0, 0.5, 0.0, w, 0.7, 0.08, WOOD, 1)); // back
  boxes.push(box(0, 0.0, 0.0, 0.1, 1.2, 0.7, WOOD_DARK, 1)); // ends
  boxes.push(box(w - 0.1, 0.0, 0.0, 0.1, 1.2, 0.7, WOOD_DARK, 1));
  boxes.push(box(0.1, 0.12, 0.2, w - 0.2, 0.3, 0.06, WOOD_DARK, 1)); // seat front board
  boxes.push(box(0.1, 0.0, 0.62, w - 0.2, 0.12, 0.3, WOOD_DARK, 1)); // kneeler
  return { boxes };
}

function cot(): ProcDef {
  const boxes: ProcBox[] = [];
  boxes.push(box(0, 0.3, 0, 1, 0.08, 2, WOOD, 1)); // frame
  for (const [x, z] of [[0, 0], [0.9, 0], [0, 1.9], [0.9, 1.9]]) boxes.push(box(x, 0, z, 0.1, 0.3, 0.1, WOOD_DARK, 1));
  boxes.push(box(0.05, 0.38, 0.05, 0.9, 0.1, 1.9, '#5d553c')); // straw
  boxes.push(box(0.12, 0.48, 0.1, 0.76, 0.04, 0.5, '#7a7260')); // a thin pillow
  boxes.push(box(0.05, 0.48, 0.7, 0.9, 0.05, 1.2, '#3c3a3f')); // a grey blanket
  return { boxes };
}

export const PROC_DEFS: Record<string, ProcDef> = {
  bookshelf: bookshelf(5, 101),
  'bookshelf-low': bookshelf(2, 202),
  'reading-table': readingTable(),
  lectern: lectern(),
  'book-stack': bookStack(),
  'bone-pile': bonePile(),
  'skull-heap': skullHeap(),
  crate: crate(),
  'cell-bars': cellBars(),
  pew: pew(),
  cot: cot(),
};
