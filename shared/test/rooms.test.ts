import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, genColliders, pieceAssetId, type EnvIndex } from '../src/room.ts';
import { validateData } from '../src/data.ts';
import { defaultData } from '../src/files.ts';
import { applyElite, stepElites } from '../src/sim/elites.ts';
import { dealDamage } from '../src/sim/damage.ts';
import { spawnEnemy, type EnemyState } from '../src/sim/state.ts';
import { ROOM_TO_ROOM, planRun } from '../src/run/roomToRoom.ts';
import { createRoomSim } from '../src/sim/roomSim.ts';
import type { Vec3 } from '../src/math.ts';
import { idle, makeSim, run } from './helpers.ts';

const data = defaultData();
const envIndex: EnvIndex = JSON.parse(readFileSync(new URL('../../client/public/assets/env/index.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../../client/public/assets/assets.json', import.meta.url), 'utf8')) as { id: string }[];
const assetIds = new Set(manifest.map((a) => a.id));
const PLAYER_R = data.player.radius;

const FOREST = ['forest_clearing', 'forest_grove', 'forest_trail'];
const DUNGEON = ['dungeon_hall', 'dungeon_crypt', 'dungeon_ruins'];
const at = (x: number, z: number) => ({ x, y: 0, z });

test('the data with all the rooms and the elites validates', () => {
  assert.deepEqual(validateData(data), []);
});

test('each biome has its three templates, and each room says which biome it belongs to', () => {
  assert.deepEqual([...data.biomes.forest.rooms].sort(), [...FOREST].sort());
  assert.deepEqual([...data.biomes.dungeon.rooms].sort(), [...DUNGEON].sort());
  for (const id of [...FOREST, ...DUNGEON]) {
    assert.ok(data.rooms[id], id);
    assert.equal(data.biomes[data.rooms[id].biome].rooms.includes(id), true, `${id} is listed by its biome`);
  }
  assert.ok(FOREST.every((id) => data.rooms[id].biome === 'forest') && DUNGEON.every((id) => data.rooms[id].biome === 'dungeon'));
});

test('the templates are different rooms: different layouts, and the dungeon uses the dungeon floor', () => {
  const sigs = new Set([...FOREST, ...DUNGEON].map((id) => JSON.stringify(data.rooms[id].pieces.map((p) => [p.id, p.pos.x, p.pos.z]))));
  assert.equal(sigs.size, 6);
  for (const id of DUNGEON) assert.equal(data.rooms[id].floor.kit, 'dungeon');
  for (const id of FOREST) assert.equal(data.rooms[id].floor.kit, 'forest');
});

test('every piece of every room is a real kit piece with an asset in the manifest', () => {
  for (const id of [...FOREST, ...DUNGEON]) {
    for (const p of data.rooms[id].pieces) {
      assert.ok(envIndex[p.kit]?.items.some((i) => i.id === p.id), `${id}: ${p.kit}/${p.id} is not in the env index`);
      assert.ok(assetIds.has(pieceAssetId(p)), `${id}: ${pieceAssetId(p)} is not in the manifest`);
      assert.ok(p.scale > 0);
    }
    const f = data.rooms[id].floor;
    assert.ok(assetIds.has(`env.${f.kit}.${f.tile.replace(/[^a-z0-9]+/g, '_')}`), `${id} floor tile`);
  }
});

test('the colliders stored for each room are up to date with its pieces', () => {
  for (const id of [...FOREST, ...DUNGEON]) assert.deepEqual(genColliders(data.rooms[id].pieces, envIndex), data.rooms[id].colliders, id);
});

test('spawn points are inside the room, not blocked, and have room to spare for a jittered enemy', () => {
  for (const id of [...FOREST, ...DUNGEON]) {
    const room = data.rooms[id];
    const world = buildWorld(room);
    const [w, d] = room.size;
    const spots: Vec3[] = [room.spawns.player, ...room.spawns.enemies, ...room.spawns.doors];
    assert.ok(room.spawns.enemies.length >= 4, `${id} has at least 4 enemy spots`);
    for (const p of spots) {
      assert.ok(Math.abs(p.x) < w / 2 - 1 && Math.abs(p.z) < d / 2 - 1, `${id}: ${JSON.stringify(p)} is outside`);
      assert.equal(world.blocked(p, 0.8), false, `${id}: blocked at ${JSON.stringify(p)}`);
    }
  }
});

test('every door and every enemy spot can be reached from the player\'s spawn on a 0.5 m grid', () => {
  for (const id of [...FOREST, ...DUNGEON]) {
    const room = data.rooms[id];
    const world = buildWorld(room);
    const [w, d] = room.size;
    const cell = 0.5;
    const key = (x: number, z: number) => `${Math.round(x / cell)},${Math.round(z / cell)}`;
    const seen = new Set<string>();
    const queue: [number, number][] = [[room.spawns.player.x, room.spawns.player.z]];
    seen.add(key(queue[0][0], queue[0][1]));
    while (queue.length) {
      const [x, z] = queue.pop()!;
      for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (Math.abs(nx) > w / 2 || Math.abs(nz) > d / 2 || seen.has(key(nx, nz)) || world.blocked({ x: nx, y: 0, z: nz }, PLAYER_R)) continue;
        seen.add(key(nx, nz));
        queue.push([nx, nz]);
      }
    }
    for (const p of [...room.spawns.doors, ...room.spawns.enemies]) assert.ok(seen.has(key(p.x, p.z)), `${id}: ${JSON.stringify(p)} cannot be reached`);
  }
});

test('every enemy a plan puts in a room stands on open ground, over 60 seeds', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const plan of planRun(ROOM_TO_ROOM, seed, data)) {
      const world = buildWorld(data.rooms[plan.roomId]);
      for (const e of plan.enemies) assert.equal(world.blocked(e.at, 0.4), false, `seed ${seed} room ${plan.index} (${plan.roomId}): ${e.enemyId} at ${JSON.stringify(e.at)}`);
    }
  }
});

test('over 60 seeds every template is used by some run', () => {
  const used = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) for (const p of planRun(ROOM_TO_ROOM, seed, data)) used.add(p.roomId);
  for (const id of [...FOREST, ...DUNGEON]) assert.ok(used.has(id), id);
});

test('every enemy in a biome\'s pool exists, and elite rooms carry exactly one modifier', () => {
  for (const b of Object.values(data.biomes)) for (const e of b.enemyPool) assert.ok(data.enemies[e], e);
  for (let seed = 1; seed <= 40; seed++) {
    for (const p of planRun(ROOM_TO_ROOM, seed, data)) {
      const elites = p.enemies.filter((e) => e.elite);
      if (p.type === 'elite') {
        assert.equal(elites.length, 1, `seed ${seed} room ${p.index}`);
        assert.ok(data.elites[elites[0].elite!], 'a real modifier');
      } else {
        assert.equal(elites.length, 0);
      }
    }
  }
});

const ELITES = ['fire_aura', 'burning_trail', 'haste', 'extra_guard'];

test('the four elite modifiers exist with plain names', () => {
  assert.deepEqual(Object.keys(data.elites).sort(), [...ELITES].sort());
  for (const m of Object.values(data.elites)) assert.ok(m.name.length > 3);
});

test('haste makes the enemy faster', () => {
  const dist = (elite: boolean) => {
    const sim = makeSim();
    sim.player.pos = at(0, 40);
    const e = spawnEnemy(sim, 'enemy.stump', at(0, 0));
    if (elite) applyElite(sim, e, 'haste');
    run(sim, 120, idle());
    return e.pos.z;
  };
  const plain = dist(false);
  const fast = dist(true);
  assert.ok(Math.abs(fast / plain - data.elites.haste.params.speedMul) < 0.05, `${fast} against ${plain}`);
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.stump', at(0, 0));
  applyElite(sim, e, 'haste');
  assert.equal(e.def.speed, data.enemies['enemy.stump'].speed * data.elites.haste.params.speedMul);
  assert.equal(sim.data.enemies['enemy.stump'].speed, data.enemies['enemy.stump'].speed, 'the shared enemy data is not changed');
});

test('extra guard raises a guard that cuts more damage, and gives one to an enemy that had none', () => {
  const sim = makeSim();
  const plain = spawnEnemy(sim, 'enemy.stump', at(5, 5));
  assert.ok(!plain.guard);
  applyElite(sim, plain, 'extra_guard');
  const raised = plain as EnemyState;
  assert.ok(raised.guard && raised.def.guard);
  raised.guard!.on = true;
  const dealt = dealDamage(sim, plain, 10, 'fire');
  assert.ok(Math.abs(dealt - 10 * (1 - data.elites.extra_guard.params.reduction)) < 1e-9, `${dealt}`);
  const tank = spawnEnemy(sim, 'enemy.treefellow', at(-5, 5));
  const before = tank.def.guard!.reduction;
  applyElite(sim, tank, 'extra_guard');
  assert.ok(tank.def.guard!.reduction > before);
  assert.ok(tank.def.guard!.onFor > data.enemies['enemy.treefellow'].guard!.onFor);
});

test('a fire aura burns a player standing close and leaves one standing far away alone', () => {
  const hpLost = (distance: number) => {
    const sim = makeSim();
    sim.player.pos = at(distance, 0);
    const e = spawnEnemy(sim, 'enemy.dummy', at(0, 0));
    applyElite(sim, e, 'fire_aura');
    run(sim, 180, idle());
    return 100 - sim.player.hp;
  };
  assert.ok(hpLost(1.5) > 0, 'close');
  assert.equal(hpLost(8), 0, 'far');
});

test('a burning trail leaves fire behind that hurts and ignites a player who stands in it, then burns out', () => {
  const sim = makeSim();
  sim.player.pos = at(0, 40);
  const e = spawnEnemy(sim, 'enemy.stump', at(0, 0));
  applyElite(sim, e, 'burning_trail');
  run(sim, 240, idle());
  const trail = sim.zones.filter((z) => z.kind === 'burning_trail');
  assert.ok(trail.length >= 2, `${trail.length} patches`);
  assert.ok(trail.every((z) => z.ownerId === e.id));
  const patch = trail[trail.length - 1];
  sim.player.pos = { x: patch.pos.x, y: 0, z: patch.pos.z };
  const hp = sim.player.hp;
  e.def = { ...e.def, ai: 'none' };
  run(sim, 90, idle());
  assert.ok(sim.player.hp < hp, 'standing in the fire hurts');
  assert.ok(sim.player.statuses.burning, 'and sets the player alight');
  sim.enemies = [];
  run(sim, 60 * (data.elites.burning_trail.params.seconds + 2), idle());
  assert.equal(sim.zones.filter((z) => z.kind === 'burning_trail').length, 0, 'it burns out');
});

test('an elite is marked in the snapshot, and stepElites does nothing when there are none', () => {
  const sim = makeSim();
  const e = spawnEnemy(sim, 'enemy.stump', at(5, 5));
  assert.equal(sim.snapshot().enemies[0].elite, null);
  applyElite(sim, e, 'haste');
  assert.equal(sim.snapshot().enemies[0].elite, 'haste');
  const empty = makeSim();
  const h = empty.hash();
  stepElites(empty);
  assert.equal(empty.hash(), h);
  assert.throws(() => applyElite(sim, e, 'nonsense'), /nonsense/);
});

test('a room sim can be made for every template', () => {
  for (const id of [...FOREST, ...DUNGEON]) {
    const sim = createRoomSim(defaultData(), 1, id);
    assert.deepEqual(sim.player.pos, { ...data.rooms[id].spawns.player, y: 0 });
  }
});
