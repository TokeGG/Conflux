// Entities the simulation holds, their snapshot views, and spawning.
import type { Vec3 } from '../math.ts';
import type { Element, EnemyDef, GuardState, Slot, StatusId, StatusMap } from '../types.ts';
import type { Sim } from './sim.ts';

export interface CastState {
  skillId: string;
  until: number;
  /** Movement speed multiplier while this cast lasts. */
  move: number;
  /** When the effect leaves the caster (after the windup). */
  fireAt?: number;
  fired?: boolean;
  /** Where the crosshair points; streams refresh it from the live aim every tick. */
  aim?: Vec3;
  /** A stream's next damage tick. */
  nextTick?: number;
  bonus?: Bonus;
}

export const MARK_IDS = ['blind', 'rooted', 'slowed', 'brittle', 'stunned', 'airborne'] as const;
export type MarkId = (typeof MARK_IDS)[number];

/** A timed effect from a reaction. It carries its own numbers, so reactions can be tuned in data. */
export interface Mark {
  until: number;
  speedMul?: number;
  damageTakenMul?: number;
  canAct?: boolean;
}
export type MarkMap = Partial<Record<MarkId, Mark>>;

/** What the swap-in bonus adds to one cast, carried by whatever the cast leaves behind. */
export interface Bonus {
  mul: number;
  guarantee: boolean;
}

/** A short-lived defensive effect from a self skill. */
export interface Buff {
  skillId: string;
  until: number;
  /** Damage soaked up before health is touched. */
  absorb: number;
  damageTakenMul: number;
  speedMul: number;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  facing: number;
  hp: number;
  statuses: StatusMap;
  marks: MarkMap;
  dodgeUntil: number;
  invulnUntil: number;
  dodgeReadyAt: number;
  /** Index into ELEMENTS. */
  element: number;
  swapReadyAt: number;
  castState: CastState | null;
  /** Time each skill is ready again. */
  cooldowns: Record<string, number>;
  buff: Buff | null;
  /** The swap-in bonus can be claimed until this time. */
  swapBonusUntil: number;
  /** Skill id per element and slot; empty string when the slot has none. */
  loadout: Record<Element, Record<Slot, string>>;
}

export interface EnemyState {
  id: number;
  def: EnemyDef;
  pos: Vec3;
  facing: number;
  hp: number;
  statuses: StatusMap;
  marks: MarkMap;
  aiState: string;
  guard: GuardState | null;
  cooldowns: Record<string, number>;
  attack: ActiveAttack | null;
  /** The elite modifier this enemy carries, if any. */
  elite: string | null;
  /** When the current AI state ends (recovering, surfacing, diving). */
  aiUntil: number;
}

/** An attack in progress: telegraphed, then landing at hitAt. */
export interface ActiveAttack {
  attackId: string;
  hitAt: number;
  /** The facing the attack was aimed with when it started. */
  yaw: number;
  phase: 'windup' | 'active';
  /** A charge: metres still to run, and whether it has already hurt the player. */
  remaining: number;
  hit: boolean;
}

export interface Projectile {
  id: number;
  pos: Vec3;
  vel: Vec3;
  r: number;
  gravity: number;
  skillId: string;
  ownerId: number;
  diesAt: number;
  bonus?: Bonus;
  /** From augments: explode in this radius on impact, pass through this many more enemies, and which have been hit. */
  explode?: number;
  pierce?: number;
  hit?: number[];
}

export interface Zone {
  id: number;
  kind: string;
  pos: Vec3;
  radius: number;
  until: number;
  ownerId: number;
  skillId: string;
  /** Walls turn with yaw; width and height are the wall's face. */
  yaw: number;
  width: number;
  height: number;
  /** Damage each tick, the tick interval and when the next one lands (0 interval: no damage). */
  damage: number;
  tick: number;
  nextTick: number;
  bonus?: Bonus;
  effects?: ZoneEffects;
}

/** What a zone does to whoever stands in it, besides damage. */
export interface ZoneEffects {
  blindSeconds?: number;
  soak?: boolean;
  burn?: boolean;
  healPercentPerSecond?: number;
}

export interface HurtCapsule {
  enemyId: number;
  a: Vec3;
  b: Vec3;
  r: number;
}

// ---- snapshot views (plain copies; the client never sees live state) -------------------------------------------------

export interface StatusSnap {
  id: StatusId;
  remaining: number;
}

export interface SlotSnap {
  slot: Slot;
  skillId: string;
  /** Seconds until the skill can be cast again (0 when ready). */
  remaining: number;
  total: number;
}

export interface PlayerSnap {
  pos: Vec3;
  facing: number;
  hp: number;
  maxHp: number;
  element: string;
  statuses: StatusSnap[];
  dodging: boolean;
  casting: string | null;
  /** The held element's skills. */
  slots: SlotSnap[];
  swapRemaining: number;
  /** Seconds left to claim the swap-in bonus (0 once it is used or has run out). */
  bonusRemaining: number;
}

export interface MarkSnap {
  id: MarkId;
  remaining: number;
}

export interface EnemySnap {
  id: number;
  defId: string;
  pos: Vec3;
  facing: number;
  hp: number;
  maxHp: number;
  statuses: StatusSnap[];
  aiState: string;
  guardOn: boolean;
  marks: MarkSnap[];
  /** The attack being wound up or carried out, for animation. */
  attack: string | null;
  elite: string | null;
}

export interface ProjectileSnap {
  id: number;
  pos: Vec3;
  skillId: string;
}

export interface ZoneSnap {
  id: number;
  kind: string;
  pos: Vec3;
  radius: number;
  remaining: number;
}

export interface Snapshot {
  tick: number;
  time: number;
  players: PlayerSnap[];
  enemies: EnemySnap[];
  projectiles: ProjectileSnap[];
  zones: ZoneSnap[];
  /** True once a dev command has changed this simulation, so the run never counts toward unlocks. */
  tuned: boolean;
}

export function spawnEnemy(sim: Sim, id: string, pos: Vec3): EnemyState {
  const def = sim.data.enemies[id];
  if (!def) throw new Error(`unknown enemy ${id}`);
  const e: EnemyState = {
    id: sim.allocId(),
    def,
    pos: { ...pos },
    facing: 0,
    hp: def.hp,
    statuses: {},
    marks: {},
    aiState: 'idle',
    guard: def.guard ? { on: false, until: 0, staggeredUntil: 0 } : null,
    cooldowns: {},
    attack: null,
    elite: null,
    aiUntil: 0,
  };
  sim.spawned++;
  sim.enemies.push(e);
  return e;
}

/** An enemy's capsules in world space: offsets turn with the facing (yaw) and move with the position. */
export function hurtboxesFor(def: EnemyDef, pos: Vec3, facing: number, enemyId: number): HurtCapsule[] {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  // yaw 0 faces +Z and a positive yaw turns toward +X, so a local +X offset swings toward -Z
  const world = (p: [number, number, number]): Vec3 => ({ x: pos.x + p[0] * c + p[2] * s, y: pos.y + p[1], z: pos.z - p[0] * s + p[2] * c });
  return def.hurtboxes.map((h) => ({ enemyId, a: world(h.a), b: world(h.b), r: h.r }));
}

/** Nothing to hit while an ambusher is underground. */
export const enemyHurtboxes = (e: EnemyState): HurtCapsule[] => (e.aiState === 'buried' ? [] : hurtboxesFor(e.def, e.pos, e.facing, e.id));
