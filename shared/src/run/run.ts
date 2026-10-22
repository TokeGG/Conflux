// The shapes of a run: the plan for a room, the choices at a door, and the state that carries from room to room.
import type { Daily } from './daily.ts';
import type { GameData, Rarity, RoomDef } from '../types.ts';
import type { Vec3 } from '../math.ts';
import type { QuietRoom } from './shop.ts';

export type RewardKind = 'skill' | 'augment' | 'heal' | 'element';
export type RoomType = 'combat' | 'elite' | 'boss' | 'shop' | 'shrine' | 'rest';

/** The rooms with no enemies, where the gates are open at once. */
export const QUIET_ROOMS = ['shop', 'shrine', 'rest'] as const;
export type QuietKind = (typeof QUIET_ROOMS)[number];
export const isQuiet = (t: RoomType): t is QuietKind => (QUIET_ROOMS as readonly string[]).includes(t);

export type { SkillLoadout } from './loadout.ts';
import type { SkillLoadout } from './loadout.ts';

export interface OwnedAugment {
  id: string;
  rarity: Rarity;
  /** The skill whose socket it fills, or '*' for a passive aimed at a tag or an element. */
  skill: string;
}

export interface RoomPlan {
  /** Position in the run, from 0. */
  index: number;
  roomId: string;
  biome: string;
  type: RoomType;
  budget: number;
  /** `elite` names the modifier this enemy carries (one per elite room). */
  enemies: { enemyId: string; at: Vec3; elite?: string }[];
  /** A generated room carries its own definition (it is not in the data files). */
  def?: RoomDef;
  /** A shop's keeper stands here. */
  keeper?: Vec3;
  /** Where the wares of a quiet room lie, in the order of the wares: walk up and interact to take one. */
  stalls?: Vec3[];
  /** The last room of a floor: its gates lead down the stairs to the next depth. */
  stairs?: boolean;
}

export interface DoorChoice {
  room: RoomPlan;
  /** What clearing that room offers, shown on the door before it is picked. */
  reward: RewardKind;
  biome: string;
  /** True when walking through this gate takes the stairs down to the next depth. */
  descends?: boolean;
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
  /** Skills that have been offered as a reward, taken or not: they are never offered again. */
  offeredSkills: string[];
  /** Health carried between rooms. */
  hp: number;
  /** Souls in hand (spent in shops) and the total picked up in the run. They start at 0 with every run. */
  souls: number;
  soulsEarned: number;
  /** What the quiet room the player stands in offers (null in a fight room). */
  quiet: QuietRoom | null;
  /** The kind of reward on the door the current room was entered by. */
  reward: RewardKind;
  /** True when the run used the dev panel's tuning, so it never counts toward unlocks. */
  tuned: boolean;
  /** The content the player has unlocked; everything when absent. */
  pool?: { skills: Set<string>; augments: Set<string> };
  /** True in the daily run: the three elements are locked, so no reward offers another. */
  daily: boolean;
  status: 'running' | 'victory' | 'defeat';
  /** The game data the run plans its rooms from (shared, not copied; the run is never sent whole to another thread). */
  data: GameData;
}

export interface RunMode {
  id: string;
  start(seed: number, data: GameData, tuned?: boolean, pool?: RunState['pool'], opts?: { daily?: Daily }): RunState;
  nextChoices(state: RunState): DoorChoice[];
  onRoomCleared(state: RunState): RunState;
}
