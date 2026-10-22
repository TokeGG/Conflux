// Turning a room's pieces into the colliders the sim needs, and a room into a World.
import type { Collider } from './world.ts';
import { World } from './world.ts';
import type { RoomDef, RoomPiece } from './types.ts';
import { slugId } from './assets.ts';

export interface EnvItem {
  id: string;
  size: [number, number, number];
  min: [number, number, number];
  tris: number;
}
export type EnvIndex = Record<string, { title: string; license: string; items: EnvItem[] }>;

/** A trunk is about this share of a tree model's width. */
const TRUNK_RATIO = 0.18;
const BOUNDARY_THICKNESS = 1;
const BOUNDARY_HEIGHT = 10;

/** What a kit piece collides as: trees as cylinders, solid props as boxes, floor tiles and small decor not at all. */
export function colliderKindFor(pieceId: string): 'box' | 'cyl' | null {
  if (/^(tree|pine)/.test(pieceId)) return 'cyl';
  if (/^(rocks|rock_(?!small)|tent|fence|building|platform|bridge|template-wall|column|pillar|crypt|altar|coffin|stone-wall|brick-wall)/.test(pieceId)) return 'box';
  return null;
}

export const pieceAssetId = (p: Pick<RoomPiece, 'kit' | 'id'>): string => `env.${p.kit}.${slugId(p.id)}`;

const r5 = (v: number) => Math.round(v * 1e5) / 1e5 + 0; // rounded, and never -0, so stored JSON is stable

export function genColliders(pieces: readonly RoomPiece[], index: EnvIndex): Collider[] {
  const out: Collider[] = [];
  for (const p of pieces) {
    const kind = colliderKindFor(p.id);
    if (!kind) continue;
    const item = index[p.kit]?.items.find((i) => i.id === p.id);
    if (!item) throw new Error(`unknown piece ${p.kit}/${p.id}`);
    const [sx, sy, sz] = item.size.map((v) => v * p.scale);
    const [mx, my, mz] = item.min.map((v) => v * p.scale);
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    const toWorld = (x: number, z: number) => ({ x: p.pos.x + x * c + z * s, z: p.pos.z - x * s + z * c });
    let xs: number[];
    let zs: number[];
    if (kind === 'cyl') {
      const centre = toWorld(mx + sx / 2, mz + sz / 2);
      const r = TRUNK_RATIO * Math.max(sx, sz);
      xs = [centre.x - r, centre.x + r];
      zs = [centre.z - r, centre.z + r];
    } else {
      const corners = [toWorld(mx, mz), toWorld(mx + sx, mz), toWorld(mx, mz + sz), toWorld(mx + sx, mz + sz)];
      xs = corners.map((q) => q.x);
      zs = corners.map((q) => q.z);
    }
    out.push({
      kind,
      min: { x: r5(Math.min(...xs)), y: r5(p.pos.y + my), z: r5(Math.min(...zs)) },
      max: { x: r5(Math.max(...xs)), y: r5(p.pos.y + my + sy), z: r5(Math.max(...zs)) },
    });
  }
  return out;
}

/** The room's colliders plus four boundary walls so nobody can leave it. */
export function buildWorld(room: RoomDef): World {
  const [w, d] = room.size;
  const hx = w / 2;
  const hz = d / 2;
  const t = BOUNDARY_THICKNESS;
  const walls: Collider[] = [
    { kind: 'box', min: { x: hx, y: 0, z: -hz - t }, max: { x: hx + t, y: BOUNDARY_HEIGHT, z: hz + t } },
    { kind: 'box', min: { x: -hx - t, y: 0, z: -hz - t }, max: { x: -hx, y: BOUNDARY_HEIGHT, z: hz + t } },
    { kind: 'box', min: { x: -hx, y: 0, z: hz }, max: { x: hx, y: BOUNDARY_HEIGHT, z: hz + t } },
    { kind: 'box', min: { x: -hx, y: 0, z: -hz - t }, max: { x: hx, y: BOUNDARY_HEIGHT, z: -hz } },
  ];
  return new World([...room.colliders, ...walls], 0);
}
