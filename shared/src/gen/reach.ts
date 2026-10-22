// Can a player get from the start of a generated room to every exit and every enemy spot? A flood fill on a 1 m grid, treating
// a spot as blocked when a body of radius 0.5 would overlap a collider or stand off the floor.
import { buildWorld } from '../room.ts';
import type { RoomDef } from '../types.ts';

const CELL = 4;
const STEP = 1;
const RADIUS = 0.5;

export function isSolvable(room: RoomDef): boolean {
  const [w, d] = room.size;
  const world = buildWorld(room);
  const floor = room.cells ? new Set(room.cells.map(([i, j]) => `${i},${j}`)) : null;
  const onFloor = (x: number, z: number) => !floor || floor.has(`${Math.floor((x + w / 2) / CELL)},${Math.floor((z + d / 2) / CELL)}`);
  const nx = Math.ceil(w / STEP);
  const nz = Math.ceil(d / STEP);
  const px = (ix: number) => -w / 2 + (ix + 0.5) * STEP;
  const pz = (iz: number) => -d / 2 + (iz + 0.5) * STEP;
  const free = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < nx && iz < nz && onFloor(px(ix), pz(iz)) && !world.blocked({ x: px(ix), y: 0, z: pz(iz) }, RADIUS);
  const at = (p: { x: number; z: number }): [number, number] => [Math.floor((p.x + w / 2) / STEP), Math.floor((p.z + d / 2) / STEP)];
  const seen = new Uint8Array(nx * nz);
  const [sx, sz] = at(room.spawns.player);
  if (!free(sx, sz)) return false;
  const queue: number[] = [sx * nz + sz];
  seen[sx * nz + sz] = 1;
  for (let head = 0; head < queue.length; head++) {
    const ix = Math.floor(queue[head] / nz);
    const iz = queue[head] % nz;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = ix + dx;
      const az = iz + dz;
      if (!free(ax, az) || seen[ax * nz + az]) continue;
      seen[ax * nz + az] = 1;
      queue.push(ax * nz + az);
    }
  }
  return [...room.spawns.doors, ...room.spawns.enemies].every((p) => {
    const [ix, iz] = at(p);
    return ix >= 0 && iz >= 0 && ix < nx && iz < nz && seen[ix * nz + iz] === 1;
  });
}
