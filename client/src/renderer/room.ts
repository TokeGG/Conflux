// Builds the visible side of a room: floor tiles and the kit pieces, from the room data and the asset manifest.
import * as THREE from 'three';
import { pieceAssetId, slugId, type RoomDef } from '@conflux/shared';
import type { AssetLoader } from '../assets/loader.ts';
import { applyTextureFilters, CHUNKY } from './profile.ts';
import { addDetail, skinFor, tintMaterials } from './skins.ts';

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
  const floorTiles = new THREE.Group();
  group.add(floorTiles);
  // a generated room lists the cells that have floor (an L-shaped room has none in its cut corner); older rooms fill the rectangle
  const wanted = room.cells ? new Set(room.cells.map(([a, b]) => `${a},${b}`)) : null;
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      if (wanted && !wanted.has(`${i},${j}`)) continue;
      const x = -w / 2 + (i + 0.5) * tileSize;
      const z = -d / 2 + (j + 0.5) * tileSize;
      const onPath = path !== undefined && Math.abs(x) < tileSize / 2 && z > pathZ0 && z < pathZ1;
      const t = (onPath ? dirt : grass).clone(true);
      t.scale.setScalar(k);
      t.position.set(x, 0, z);
      floorTiles.add(t);
    }
  }

  // pieces
  const propsGroup = new THREE.Group();
  group.add(propsGroup);
  const cache = new Map<string, THREE.Object3D>();
  for (const p of room.pieces) {
    const id = pieceAssetId(p);
    let src = cache.get(id);
    if (!src) cache.set(id, (src = (await loader.loadModel(id)).scene));
    const o = src.clone(true);
    o.scale.setScalar(p.scale);
    o.rotation.y = p.rotY;
    o.position.set(p.pos.x, p.pos.y, p.pos.z);
    o.userData.surface = /floor/.test(p.id) ? 'floor' : /wall|gate/.test(p.id) ? 'wall' : 'prop';
    propsGroup.add(o);
  }
  const skin = skinFor(room.look);
  if (skin) {
    // every material is copied for this room, tinted cool, and the floors and walls get their texture laid over them
    const copies = new Map<THREE.Material, THREE.Material>();
    tintMaterials(group, skin.tint, copies);
    const floorTex = await loader.loadTexture(skin.floorTex, 'linear');
    const wallTex = await loader.loadTexture(skin.wallTex, 'linear');
    const detailed = new Set<THREE.Material>();
    const lay = (root: THREE.Object3D, tex: THREE.Texture, strength: number) =>
      root.traverse((n) => {
        const m = (n as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !detailed.has(m)) (detailed.add(m), addDetail(m, tex, 0.5, strength));
      });
    lay(floorTiles, floorTex, 0.9);
    for (const o of propsGroup.children) {
      if (o.userData.surface === 'floor') lay(o, floorTex, 0.9);
      else if (o.userData.surface === 'wall') lay(o, wallTex, 0.75);
    }
  }
  applyTextureFilters(group, CHUNKY);
  return group;
}
