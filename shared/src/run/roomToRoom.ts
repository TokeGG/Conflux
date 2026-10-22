// The first run mode: eight rooms through the forest and then the dungeon, then a boss. Every door is a pure function of the
// seed and the room number, so a plan can be rebuilt at any time and the same seed always gives the same run.
import type { GameData } from '../types.ts';
import { startingLoadout } from './loadout.ts';
import { makeStreams, type Rng } from '../rng.ts';
import { encounterFor } from './encounters.ts';
import type { DoorChoice, RewardKind, RoomPlan, RunMode, RunState } from './run.ts';

/** The biomes in order and how many ordinary rooms each holds. */
const STAGES = [
  { biome: 'forest', rooms: 4 },
  { biome: 'dungeon', rooms: 4 },
];
const ORDINARY = STAGES.reduce((n, s) => n + s.rooms, 0);
const TOTAL = ORDINARY + 1;
const budgetFor = (index: number) => 8 + 3 * index;
/** Every third room from the third is an elite room (its modifiers come with the biome rooms). */
const isElite = (index: number) => index % 3 === 2;

const biomeAt = (index: number): string => {
  let n = index;
  for (const s of STAGES) {
    if (n < s.rooms) return s.biome;
    n -= s.rooms;
  }
  return STAGES[STAGES.length - 1].biome;
};

const mapStream = (seed: number, label: string): Rng => makeStreams(seed).map.fork(label);
const encounterStream = (seed: number, label: string): Rng => makeStreams(seed).encounter.fork(label);

/** The plan of one room: which room, and what is in it. `door` tells apart the doors offered after the same room. */
function planRoom(seed: number, index: number, door: number, data: GameData): RoomPlan {
  const label = `room/${index}/${door}`;
  const biome = data.biomes[biomeAt(index)];
  const map = mapStream(seed, label);
  const roomId = map.pick(biome.rooms);
  const spots = data.rooms[roomId].spawns.enemies;
  const budget = budgetFor(index);
  if (index === ORDINARY) {
    const boss = map.pick(biome.bosses ?? biome.enemyPool);
    return { index, roomId, biome: biome.id, type: 'boss', budget, enemies: [{ enemyId: boss, at: { ...spots[0], y: 0 } }] };
  }
  const enemies = encounterFor(budget, biome, data.enemies, encounterStream(seed, label), spots, undefined, 12);
  const elite = isElite(index);
  if (elite) {
    // the costliest enemy of the room carries a modifier
    const strongest = enemies.reduce((best, e, i) => (data.enemies[e.enemyId].cost > data.enemies[enemies[best].enemyId].cost ? i : best), 0);
    enemies[strongest].elite = encounterStream(seed, `${label}/elite`).pick(Object.keys(data.elites).sort());
  }
  return { index, roomId, biome: biome.id, type: elite ? 'elite' : 'combat', budget, enemies };
}

/** The reward kinds on the doors into room `index`, without repeats where there are enough kinds. */
export function rewardKinds(seed: number, index: number, count: number): RewardKind[] {
  const rng = mapStream(seed, `rewards/${index}`);
  const weights: Record<RewardKind, number> = { skill: 4, augment: 4, heal: 2, element: 0 };
  const left: RewardKind[] = ['skill', 'augment', 'heal'];
  const out: RewardKind[] = [];
  for (let i = 0; i < count; i++) {
    const k = rng.weighted(left, (x) => weights[x]);
    out.push(k);
    left.splice(left.indexOf(k), 1);
  }
  return out;
}

const doorCount = (seed: number, index: number) => 2 + mapStream(seed, `doors/${index}`).int(2);

/** True when an earlier set of doors, up to the room before `index`, already showed a skill. */
function skillOfferedBefore(seed: number, index: number): boolean {
  for (let i = 1; i < index; i++) if (rewardKinds(seed, i, doorCount(seed, i)).includes('skill')) return true;
  return false;
}

export const ROOM_TO_ROOM: RunMode = {
  id: 'room_to_room',

  start(seed, data, tuned = false, pool): RunState {
    const skills = startingLoadout(data, mapStream(seed, 'loadout'), pool?.skills);
    return {
      seed,
      mode: 'room_to_room',
      roomIndex: 0,
      roomsTotal: TOTAL,
      current: planRoom(seed, 0, 0, data),
      history: [],
      skills,
      offeredSkills: [],
      hp: data.player.health,
      souls: 0,
      soulsEarned: 0,
      quiet: null,
      reward: 'heal',
      augments: [],
      tuned,
      pool,
      daily: false,
      status: 'running',
      data,
    };
  },

  nextChoices(state): DoorChoice[] {
    if (state.status !== 'running') return [];
    const next = state.roomIndex + 1;
    if (next >= state.roomsTotal) return [];
    const data = state.data;
    if (next === ORDINARY) {
      const room = planRoom(state.seed, next, 0, data);
      return [{ room, reward: 'heal', biome: room.biome }];
    }
    const count = doorCount(state.seed, next);
    const kinds = rewardKinds(state.seed, next, count);
    // a skill offer by room 3 at the latest: if none has shown yet, the last chance carries one
    const guarantee = data.rewards.guaranteeSkillByRoom;
    if (next === guarantee && !kinds.includes('skill') && !skillOfferedBefore(state.seed, next)) kinds[0] = 'skill';
    return kinds.map((reward, door) => {
      const room = planRoom(state.seed, next, door, data);
      return { room, reward, biome: room.biome };
    });
  },

  onRoomCleared(state): RunState {
    const done: RunState = { ...state, history: [...state.history, state.current.roomId] };
    if (state.current.type === 'boss') done.status = 'victory';
    return done;
  },
};

/** Walks through a door into the next room. */
export function chooseDoor(state: RunState, door: DoorChoice): RunState {
  return { ...state, roomIndex: state.roomIndex + 1, current: door.room, reward: door.reward };
}

/** The whole run when the first door is always taken (useful for tests, previews and the balance bot). */
export function planRun(mode: RunMode, seed: number, data: GameData): RoomPlan[] {
  let state = mode.start(seed, data);
  const plan = [state.current];
  for (;;) {
    const door = mode.nextChoices(state)[0];
    if (!door) return plan;
    state = chooseDoor(mode.onRoomCleared(state), door);
    plan.push(state.current);
  }
}
