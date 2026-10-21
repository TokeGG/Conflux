// The shapes of a run: the plan for a room, the choices at a door, and the state that carries from room to room.
import type { Element, GameData, Rarity, Slot } from '../types.ts';
import type { Vec3 } from '../math.ts';

export type RewardKind = 'skill' | 'augment' | 'heal';
export type RoomType = 'combat' | 'elite' | 'boss';

/** Which skill sits on each slot of each element. */
export type SkillLoadout = Record<Element, Record<Slot, string>>;

export interface OwnedAugment {
  id: string;
  rarity: Rarity;
}

export interface RoomPlan {
  /** Position in the run, from 0. */
  index: number;
  roomId: string;
  biome: string;
  type: RoomType;
  budget: number;
  enemies: { enemyId: string; at: Vec3 }[];
}

export interface DoorChoice {
  room: RoomPlan;
  /** What clearing that room offers, shown on the door before it is picked. */
  reward: RewardKind;
  biome: string;
}

export interface RunState {
  seed: number;
  mode: string;
  roomIndex: number;
  roomsTotal: number;
  current: RoomPlan;
  /** The rooms cleared so far, in order. */
  history: string[];
  skills: SkillLoadout;
  augments: OwnedAugment[];
  /** True when the run used the dev panel's tuning, so it never counts toward unlocks. */
  tuned: boolean;
  status: 'running' | 'victory' | 'defeat';
  /** The game data the run plans its rooms from (shared, not copied; the run is never sent whole to another thread). */
  data: GameData;
}

export interface RunMode {
  id: string;
  start(seed: number, data: GameData, tuned?: boolean): RunState;
  nextChoices(state: RunState): DoorChoice[];
  onRoomCleared(state: RunState): RunState;
}
