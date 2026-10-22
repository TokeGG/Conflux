// The endless run: every room is generated from the seed, a room's gates lead to different rooms, and nothing ends the run but
// the player's death. Each room is a pure function of (seed, room number, gate), so the plan can be rebuilt at any time.
import { generateRoom } from '../gen/generate.ts';
import { makeStreams } from '../rng.ts';
import type { GameData, RoomDef, ThemeDef } from '../types.ts';
import { encounterFor } from './encounters.ts';
import { startingLoadout } from './loadout.ts';
import { rewardKinds } from './roomToRoom.ts';
import { QUIET_ROOMS, isQuiet, type QuietKind, type DoorChoice, type RoomPlan, type RoomType, type RunMode, type RunState } from './run.ts';
import { depthAt, hasStairs, isBossRoom, isEliteRoom, isLandingRoom } from './floors.ts';

const budgetFor = (index: number) => 12 + 5 * index;
const depthOf = depthAt;
/** The chance that a gate other than the first leads to a quiet room (on rooms that are not special). */
const QUIET_CHANCE = 0.35;

/**
 * What kind of room lies behind gate `gate` of the room before room `index`. The first room, bosses (every fifth), elites (every
 * third from the third) and the room with the stairs are fights; the landing before the stairs has a shop, a shrine and a rest
 * room behind its gates; elsewhere the first gate is always a fight and the others may lead to a quiet room.
 */
export function roomKindAt(seed: number, index: number, gate: number): RoomType {
  if (index === 0) return 'combat';
  if (isBossRoom(index)) return 'boss';
  if (isLandingRoom(index)) return QUIET_ROOMS[Math.min(gate, QUIET_ROOMS.length - 1)];
  if (isEliteRoom(index)) return 'elite';
  if (hasStairs(index) || gate === 0) return 'combat';
  const rng = makeStreams(seed).map.fork(`kind/${index}/${gate}`);
  if (rng.next() >= QUIET_CHANCE) return 'combat';
  return rng.weighted(QUIET_ROOMS, (k) => ({ shop: 3, shrine: 3, rest: 2 })[k]);
}

/** The plan of room `index` entered by gate `gate` of the room before (0 for the first room). */
export function planRoomAt(data: GameData, seed: number, depth: number, index: number, gate = 0, avoid: readonly string[] = []): RoomPlan {
  const plan = planKind(data, seed, depth, index, gate, avoid);
  return hasStairs(index) ? { ...plan, stairs: true } : plan;
}

/** Where a quiet room's keeper and wares stand: the free spots the generator found, the one nearest the middle for the keeper. */
function planQuiet(room: RoomDef, theme: string, index: number, kind: QuietKind): RoomPlan {
  const byMiddle = [...room.spawns.enemies].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const first = byMiddle[0];
  const point = (s: { x: number; z: number }) => ({ x: s.x, y: 0, z: s.z });
  const around = byMiddle.slice(1).sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z));
  const plan: RoomPlan = { index, roomId: room.id, biome: theme, type: kind, budget: 0, enemies: [], def: room };
  if (kind === 'rest') return { ...plan, stalls: [point(first)] };
  return { ...plan, keeper: kind === 'shop' ? point(first) : undefined, stalls: around.slice(0, kind === 'shop' ? 4 : 3).map(point) };
}

function planKind(data: GameData, seed: number, depth: number, index: number, gate: number, avoid: readonly string[]): RoomPlan {
  const kind = roomKindAt(seed, index, gate);
  const arena = kind === 'boss' ? Object.values(data.themes).filter((t) => t.boss).sort((a, b) => a.id.localeCompare(b.id))[0] : undefined;
  const { room, theme } = generateRoom(data, seed, depth, index * 4 + gate, arena?.id, avoid);
  if (arena) return planBoss(data, seed, depth, index, gate, room, arena);
  if (isQuiet(kind)) return planQuiet(room, theme, index, kind);
  const def = data.themes[theme];
  const rng = makeStreams(seed).encounter.fork(`room/${index}/${gate}`);
  const budget = budgetFor(index);
  // no single enemy may cost more than half the budget (at least 4), so early rooms are crowds of small things and the big ones come later
  const pool = { id: theme, enemyPool: Object.keys(def.mobs).filter((m) => data.enemies[m] && data.enemies[m].cost <= Math.max(4, budget * 0.5)).sort() };
  const enemies = encounterFor(budget, pool, data.enemies, rng, room.spawns.enemies, def.mobs);
  const elite = kind === 'elite';
  if (elite) {
    // the costliest enemy carries a modifier
    const strongest = enemies.reduce((best, e, i) => (data.enemies[e.enemyId].cost > data.enemies[enemies[best].enemyId].cost ? i : best), 0);
    enemies[strongest].elite = makeStreams(seed).encounter.fork(`room/${index}/${gate}/elite`).pick(Object.keys(data.elites).sort());
  }
  return { index, roomId: room.id, biome: theme, type: elite ? 'elite' : 'combat', budget, enemies, def: room };
}

/** A boss room: one boss from the arena's list at the spot nearest the middle, with a crowd of the arena's own mobs round it. */
function planBoss(data: GameData, seed: number, depth: number, index: number, gate: number, room: RoomDef, arena: ThemeDef): RoomPlan {
  const rng = makeStreams(seed).encounter.fork(`room/${index}/${gate}/boss`);
  const spots = [...room.spawns.enemies].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const boss = rng.pick([...(arena.boss ?? [])].sort());
  const budget = budgetFor(index);
  const adds = encounterFor(Math.round(budget * 0.4), { id: arena.id, enemyPool: Object.keys(arena.mobs).filter((m) => data.enemies[m] && data.enemies[m].cost <= Math.max(4, budget * 0.3)).sort() }, data.enemies, rng, spots.slice(1), arena.mobs);
  const enemies = [{ enemyId: boss, at: { x: spots[0].x, y: 0, z: spots[0].z } }, ...adds];
  return { index, roomId: room.id, biome: arena.id, type: 'boss', budget, enemies, def: room };
}

export const ENDLESS: RunMode = {
  id: 'endless',

  start(seed, data, tuned = false, pool, opts): RunState {
    const loadout = startingLoadout(data, makeStreams(seed).map.fork('loadout'), pool?.skills);
    return {
      seed,
      mode: 'endless',
      roomIndex: 0,
      roomsTotal: Number.MAX_SAFE_INTEGER,
      current: planRoomAt(data, seed, depthOf(0), 0),
      history: [],
      skills: opts?.daily ? { ...loadout, equipped: [...opts.daily.elements] } : loadout,
      daily: !!opts?.daily,
      offeredSkills: [],
      hp: data.player.health,
      souls: 0,
      soulsEarned: 0,
      quiet: null,
      reward: 'heal',
      augments: [],
      tuned,
      pool,
      status: 'running',
      data,
    };
  },

  nextChoices(state): DoorChoice[] {
    if (state.status !== 'running' || !state.current.def) return [];
    const next = state.roomIndex + 1;
    const gates = state.current.def.spawns.doors.length;
    const kinds = rewardKinds(state.seed, next, gates);
    // each gate leads to a different style, and none to the style of the room just left
    const avoid = [state.current.biome];
    return kinds.map((reward, gate) => {
      const room = planRoomAt(state.data, state.seed, depthOf(next), next, gate, avoid);
      avoid.push(room.biome);
      return { room, reward, biome: room.biome, descends: depthOf(next) > depthOf(state.roomIndex) };
    });
  },

  onRoomCleared(state): RunState {
    return { ...state, history: [...state.history, state.current.roomId] };
  },
};
