// Builds the visible side of a room: floor tiles and the kit pieces, from the room data and the asset manifest.
import * as THREE from 'three';
import { pieceAssetId, slugId, type RoomDef } from '@conflux/shared';
import type { AssetLoader } from '../assets/loader.ts';
import { applyTextureFilters, CHUNKY } from './profile.ts';

export async function buildRoomScene(room: RoomDef, loader: AssetLoader): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = room.id;

  // floor: a grid of tiles, with a dirt path along the middle from the player to the door
  const { kit, tile, path, tileSize } = room.floor;
  const grass = (await loader.loadModel(`env.${kit}.${slugId(tile)}`)).scene;
  const dirt = path ? (await loader.loadModel(`env.${kit}.${slugId(path)}`)).scene : grass;
  const native = new THREE.Box3().setFromObject(grass).getSize(new THREE.Vector3());
  const k = tileSize / Math.max(native.x, native.z);
  const [w, d] = room.size;
  const pathZ0 = room.spawns.player.z - tileSize;
  const pathZ1 = Math.max(...room.spawns.doors.map((p) => p.z)) + tileSize;
  const columns = Math.ceil(w / tileSize);
  const rows = Math.ceil(d / tileSize);
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + (i + 0.5) * tileSize;
      const z = -d / 2 + (j + 0.5) * tileSize;
      const onPath = path !== undefined && Math.abs(x) < tileSize / 2 && z > pathZ0 && z < pathZ1;
      const t = (onPath ? dirt : grass).clone(true);
      t.scale.setScalar(k);
      t.position.set(x, 0, z);
      group.add(t);
    }
  }

  // pieces
  const cache = new Map<string, THREE.Object3D>();
  for (const p of room.pieces) {
    const id = pieceAssetId(p);
    let src = cache.get(id);
    if (!src) cache.set(id, (src = (await loader.loadModel(id)).scene));
    const o = src.clone(true);
    o.scale.setScalar(p.scale);
    o.rotation.y = p.rotY;
    o.position.set(p.pos.x, p.pos.y, p.pos.z);
    group.add(o);
  }
  applyTextureFilters(group, CHUNKY);
  return group;
}
