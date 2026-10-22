// Scattering props over a generated room in layers, each prop keeping a circle of floor clear round it.
import type { Rng } from '../rng.ts';
import { colliderKindFor } from '../room.ts';
import type { LightDef, PoolItem, RoomPiece, ThemeDef } from '../types.ts';
import type { Edge, Footprint } from './footprint.ts';
import { pieceBounds } from './pieces.ts';

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** Never packed into: the start, exits and enemy spots. Soft circles (props) may be crowded by small things. */
  hard?: boolean;
}

/** One placed prop: its pieces, the lights it carries, and whether it can block a path. */
export interface Prop {
  parts: RoomPiece[];
  lights: LightDef[];
  blocks: boolean;
}

export interface PlaceCtx {
  rng: Rng;
  theme: ThemeDef;
  fp: Footprint;
  taken: Circle[];
  props: Prop[];
}

const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;

/** A piece whose bounding box is centred on (cx, cz), whatever the model's own origin is. */
export function piece(kit: string, id: string, cx: number, cz: number, rotY = 0, scale = 1, y = 0): RoomPiece {
  const b = pieceBounds(kit, id);
  const lx = (b.min[0] + b.size[0] / 2) * scale;
  const lz = (b.min[2] + b.size[2] / 2) * scale;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { kit, id, pos: { x: r3(cx - (lx * c + lz * s)), y, z: r3(cz - (-lx * s + lz * c)) }, rotY: r3(rotY), scale: r3(scale) };
}

const angleFor = (rng: Rng, turn: PoolItem['turn']) => (turn === 'none' ? 0 : turn === 'quarter' ? rng.int(4) * (Math.PI / 2) : rng.next() * Math.PI * 2);

/** True when a point is on the floor with at least `m` metres of floor all round it. */
export function inside(fp: Footprint, x: number, z: number, m: number): boolean {
  const at = (px: number, pz: number) => fp.solid(Math.floor((px + (fp.cw * 4) / 2) / 4), Math.floor((pz + (fp.cd * 4) / 2) / 4));
  return at(x, z) && at(x + m, z) && at(x - m, z) && at(x, z + m) && at(x, z - m);
}

export function freeSpot(ctx: PlaceCtx, r: number, margin: number, pack = 1, hard = false): { x: number; z: number } | null {
  const hw = (ctx.fp.cw * 4) / 2;
  const hd = (ctx.fp.cd * 4) / 2;
  for (let t = 0; t < 120; t++) {
    const p = { x: (ctx.rng.next() * 2 - 1) * (hw - 1), z: (ctx.rng.next() * 2 - 1) * (hd - 1) };
    if (!inside(ctx.fp, p.x, p.z, margin)) continue;
    if (ctx.taken.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < (q.hard ? q.r : q.r * pack) + r)) continue;
    ctx.taken.push({ ...p, r, hard });
    return p;
  }
  return null;
}

function lightFor(ctx: PlaceCtx, kind: NonNullable<PoolItem['light']>, x: number, z: number, y: number): LightDef {
  if (kind === 'brazier') return { x, y: 1.6, z, color: ctx.theme.lights.brazier, intensity: 16, dist: 13 };
  if (kind === 'candle') return { x, y: y + 1.1, z, color: ctx.theme.lights.candle, intensity: 5, dist: 6 };
  return { x, y: 0.8, z, color: '#7fffd0', intensity: 4, dist: 6 };
}

function propAt(ctx: PlaceCtx, item: PoolItem, x: number, z: number): Prop {
  const parts = [piece(item.kit, item.id, x, z, angleFor(ctx.rng, item.turn), item.scale)];
  const lights: LightDef[] = [];
  if (item.light === 'candle' && !item.id.startsWith('candle')) {
    // a candle stands on the prop (an altar, a coffin) and lights it
    parts.push(piece('graveyard', 'candle-multiple', x + 0.5, z + 0.4, ctx.rng.next() * 6, 2.4, 0.55));
    lights.push(lightFor(ctx, 'candle', x + 0.5, z + 0.4, 0.55));
  } else if (item.light) lights.push(lightFor(ctx, item.light, x, z, 0));
  return { parts, lights, blocks: parts.some((p) => colliderKindFor(p.id) !== null) };
}

/** A shuffled copy (Fisher-Yates: a random comparator in `sort` gives different orders in different engines, which breaks determinism). */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Places each pool item a random number of times (its count range), up to `cap` props for the layer. */
export function placeLayer(ctx: PlaceCtx, items: PoolItem[], cap: number, pack = 1): void {
  let placed = 0;
  const order = shuffled(ctx.rng, items);
  for (const item of order) {
    const n = item.count[0] + ctx.rng.int(item.count[1] - item.count[0] + 1);
    for (let k = 0; k < n && placed < cap; k++) {
      const p = freeSpot(ctx, item.clear, Math.max(pack < 1 ? 1.0 : 1.4, item.clear * 0.6), pack);
      if (!p) break;
      ctx.props.push(propAt(ctx, item, p.x, p.z));
      placed++;
    }
  }
}

/** Braziers, torches and the like along the walls, away from the exits. */
export function placeWallDecor(ctx: PlaceCtx, items: PoolItem[], edges: Edge[], exits: Edge[]): void {
  const usable = edges.filter((e) => !exits.some((x) => Math.hypot(x.x - e.x, x.z - e.z) < 4.5));
  if (!usable.length) return;
  for (const item of items) {
    const n = item.count[0] + ctx.rng.int(item.count[1] - item.count[0] + 1);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < 20; t++) {
        const e = usable[ctx.rng.int(usable.length)];
        const u = (ctx.rng.next() * 2 - 1) * 1.4;
        const x = e.x - e.nx * 1.3 + Math.abs(e.nz) * u;
        const z = e.z - e.nz * 1.3 + Math.abs(e.nx) * u;
        if (!inside(ctx.fp, x, z, 0.6) || ctx.taken.some((q) => Math.hypot(q.x - x, q.z - z) < (q.hard ? q.r : q.r * 0.4) + item.clear)) continue;
        ctx.taken.push({ x, z, r: item.clear });
        ctx.props.push(propAt(ctx, item, x, z));
        break;
      }
    }
  }
}
