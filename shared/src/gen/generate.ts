// A room from a seed: pick a theme, lay out the floor and walls, scatter props in layers, place the player and the enemy spots,
// and make sure a player can get to every exit and every spot. Pure: the same inputs always give the same room.
import { makeStreams } from '../rng.ts';
import { genColliders } from '../room.ts';
import { World } from '../world.ts';
import type { GameData, LightDef, RoomDef, RoomPiece, ThemeDef } from '../types.ts';
import { boundaryEdges, CELL, makeFootprint, pickExits, type Edge, type Footprint } from './footprint.ts';
import { envIndexFromPieces } from './pieces.ts';
import { freeSpot, inside, piece, placeLayer, placeWallDecor, type PlaceCtx } from './place.ts';
import { isSolvable } from './reach.ts';

export interface GeneratedRoom {
  room: RoomDef;
  theme: string;
}

/** Most props a layer holds (the spec's figures: 2 to 5 set pieces, 10 to 20 medium, 40 to 100 small). */
const CAPS = { set: 5, medium: 20, small: 100 };
/** Floor cells of the reference room (6 x 6) that CAPS and the pools' counts were made for; a bigger floor scales them up. */
const REFERENCE_CELLS = 30;
/** The least share of the floor that stays clear for a body (the owner's rule: stuff on the ground, but not in the way). */
const MIN_CLEAR = 0.78;
const OUTWARD_TURN = (nx: number, nz: number) => (nz > 0 ? 0 : nz < 0 ? Math.PI : nx < 0 ? Math.PI / 2 : -Math.PI / 2);

function structure(fp: Footprint, theme: ThemeDef, edges: Edge[], exits: Edge[], gate: (e: Edge) => string, rng: ReturnType<typeof makeStreams>['map']): RoomPiece[] {
  const out: RoomPiece[] = [];
  for (const [i, j] of fp.cells) {
    if (rng.next() < theme.detailChance) out.push(piece(theme.floor.kit, theme.floor.detail, fp.cx(i), fp.cz(j), rng.int(4) * (Math.PI / 2), 1));
  }
  for (const e of edges) {
    const isExit = exits.includes(e);
    const id = isExit ? gate(e) : rng.next() < 0.3 ? theme.wall.detail : theme.wall.plain;
    out.push(piece(theme.wall.kit, id, e.x + e.nx, e.z + e.nz, OUTWARD_TURN(e.nx, e.nz), 1));
  }
  // the square left outside every convex corner (a lattice point with exactly one floor cell round it)
  for (let i = 0; i <= fp.cw; i++) {
    for (let j = 0; j <= fp.cd; j++) {
      const around = [fp.solid(i - 1, j - 1), fp.solid(i, j - 1), fp.solid(i - 1, j), fp.solid(i, j)];
      if (around.filter(Boolean).length !== 1) continue;
      const sx = around[0] || around[2] ? 1 : -1; // the floor cell is to the left (-x) of the point when sx is 1
      const sz = around[0] || around[1] ? 1 : -1;
      out.push(piece(theme.wall.kit, theme.wall.corner, -(fp.cw * CELL) / 2 + i * CELL + sx, -(fp.cd * CELL) / 2 + j * CELL + sz, 0, 2));
    }
  }
  return out;
}

/** Straight-line distance in metres, up to 6, from a point to the nearest bit of ground that is not floor (a wall side, or the corner of a cut). */
function wallClearance(fp: Footprint, x: number, z: number): number {
  let best = 6;
  for (let i = -2; i <= fp.cw + 1; i++) {
    for (let j = -2; j <= fp.cd + 1; j++) {
      if (fp.solid(i, j)) continue;
      const dx = Math.max(fp.cx(i) - CELL / 2 - x, 0, x - (fp.cx(i) + CELL / 2));
      const dz = Math.max(fp.cz(j) - CELL / 2 - z, 0, z - (fp.cz(j) + CELL / 2));
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best;
}

/** The point of the floor on a 1 m grid with at least 3.5 m of floor all round it (or the roomiest point there is) that is farthest from the exits. */
function chooseStart(fp: Footprint, doors: { x: number; z: number }[]): { x: number; z: number } {
  const half = { x: (fp.cw * CELL) / 2, z: (fp.cd * CELL) / 2 };
  const pts: { x: number; z: number; clear: number; far: number }[] = [];
  for (let x = -half.x + 0.5; x < half.x; x += 1) {
    for (let z = -half.z + 0.5; z < half.z; z += 1) {
      if (!inside(fp, x, z, 0)) continue;
      pts.push({ x, z, clear: wallClearance(fp, x, z), far: Math.min(...doors.map((d) => Math.hypot(d.x - x, d.z - z))) });
    }
  }
  const room = Math.min(3.5, Math.max(...pts.map((p) => p.clear)));
  const ok = pts.filter((p) => p.clear >= room);
  const best = ok.reduce((b, p) => (p.far > b.far ? p : b), ok[0]);
  return { x: best.x, z: best.z };
}

export function generateRoom(data: GameData, seed: number, depth: number, roomIndex: number, themeId?: string): GeneratedRoom {
  const rng = makeStreams(seed).map.fork(`gen/${depth}/${roomIndex}`);
  const candidates = Object.values(data.themes).filter((t) => t.minDepth <= depth);
  const theme = themeId ? data.themes[themeId] : rng.weighted(candidates, (t) => t.weight);
  if (!theme) throw new Error(`unknown theme ${themeId}`);
  const floorTex = rng.pick(theme.floor.tex);
  const wallTex = rng.pick(theme.wall.tex);

  const fp = makeFootprint(rng, theme);
  const edges = boundaryEdges(fp);
  const exits = pickExits(rng, fp, edges);
  const doorSpots = exits.map((e) => ({ x: e.x - e.nx * 1.2, z: e.z - e.nz * 1.2 }));
  const fixed = structure(fp, theme, edges, exits, () => rng.pick(theme.wall.gates), rng);

  // the player starts well away from every wall (the camera sits four metres behind them) and as far from the exits as that allows
  const start = chooseStart(fp, doorSpots);

  const scale = Math.max(1, fp.cells.length / REFERENCE_CELLS);
  const enemySpots = Math.min(28, Math.round(8 + fp.cells.length / 4));
  const ctx: PlaceCtx = { rng, theme, fp, scale, taken: [{ ...start, r: 4, hard: true }, ...doorSpots.map((d) => ({ ...d, r: 3.2, hard: true }))], props: [] };
  const spots: { x: number; z: number }[] = [];
  for (let k = 0; k < enemySpots; k++) {
    const p = freeSpot(ctx, 2.4, 1.8, 1, true) ?? (spots.length < 5 ? (freeSpot(ctx, 1.4, 1.4, 1, true) ?? freeSpot(ctx, 0.9, 1.0, 1, true)) : null);
    if (p) spots.push({ x: Math.round(p.x * 1e3) / 1e3, z: Math.round(p.z * 1e3) / 1e3 });
  }
  placeLayer(ctx, theme.pools.set, Math.round(CAPS.set * scale));
  placeWallDecor(ctx, theme.pools.wall, edges, exits);
  // a room is never lit by less than three lights: more braziers until it is
  for (let k = 0; k < 6 && exits.length + ctx.props.reduce((n, p) => n + p.lights.length, 0) < 3; k++) placeWallDecor(ctx, [{ ...theme.pools.wall[0], count: [1, 1] }], edges, exits);
  placeLayer(ctx, theme.pools.medium, Math.round(CAPS.medium * scale));
  placeLayer(ctx, theme.pools.small, Math.round(CAPS.small * scale), 0.45);

  const exitLights: LightDef[] = exits.map((e) => ({ x: e.x - e.nx * 1.6, y: 2.4, z: e.z - e.nz * 1.6, color: theme.lights.brazier, intensity: 14, dist: 12 }));
  const index = envIndexFromPieces();
  const assemble = (): RoomDef => {
    const pieces = [...fixed, ...ctx.props.flatMap((p) => p.parts)];
    const colliders = genColliders(pieces, index);
    // a spot must have room for a 0.8 m body, not just a free grid cell beside it
    const world = new World(colliders, 0);
    const open = spots.filter((s) => !world.blocked({ x: s.x, y: 0, z: s.z }, 0.8));
    return {
      id: `gen_${seed}_${depth}_${roomIndex}`,
      biome: theme.id,
      size: [fp.cw * CELL, fp.cd * CELL],
      floor: { kit: theme.floor.kit, tile: theme.floor.tile, tileSize: CELL },
      pieces,
      colliders,
      spawns: { player: { x: start.x, y: 0, z: start.z }, enemies: open.map((s) => ({ ...s, y: 0 })), doors: doorSpots.map((d) => ({ x: Math.round(d.x * 1e3) / 1e3, y: 0, z: Math.round(d.z * 1e3) / 1e3 })) },
      lighting: theme.lighting,
      cells: fp.cells,
      lights: [...exitLights, ...ctx.props.flatMap((p) => p.lights)],
      look: { floorTex, wallTex, tint: theme.tint },
      theme: theme.id,
    };
  };

  // a prop that closes a path is taken away again, the latest first
  // the floor must stay at least 75% clear for a body to stand on (props that block take the room's space, the latest first)
  const clearShare = (r: RoomDef): number => {
    const w = new World(r.colliders, 0);
    let total = 0;
    let open = 0;
    for (let x = -r.size[0] / 2 + 0.25; x < r.size[0] / 2; x += 0.5) {
      for (let z = -r.size[1] / 2 + 0.25; z < r.size[1] / 2; z += 0.5) {
        if (!inside(fp, x, z, 0)) continue;
        total++;
        if (!w.blocked({ x, y: 0, z }, 0.5)) open++;
      }
    }
    return total === 0 ? 1 : open / total;
  };
  let room = assemble();
  // thin the blocking props a few at a time until enough floor is clear (a cheap pass before the one-by-one solvability one)
  for (let share = clearShare(room); share < MIN_CLEAR; share = clearShare(room)) {
    let cut = 0;
    for (let k = ctx.props.length - 1; k >= 0 && cut < 4; k--) {
      if (ctx.props[k].blocks) {
        ctx.props.splice(k, 1);
        cut++;
      }
    }
    if (cut === 0) break;
    room = assemble();
  }
  while (!isSolvable(room) || room.spawns.enemies.length < 5) {
    let k = ctx.props.length - 1;
    while (k >= 0 && !ctx.props[k].blocks) k--;
    if (k < 0) throw new Error(`generated room ${seed}/${depth}/${roomIndex} cannot be solved even without props (${room.spawns.enemies.length} enemy spots, solvable ${isSolvable(room)})`);
    ctx.props.splice(k, 1);
    room = assemble();
  }
  return { room, theme: theme.id };
}
