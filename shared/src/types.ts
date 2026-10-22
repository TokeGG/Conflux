// Core vocabulary shared by the simulation, the data files and the client. No DOM, no Three.js, no art paths.
import type { Vec3 } from './math.ts';
import type { Collider } from './world.ts';

export const ELEMENTS = ['fire', 'water', 'earth', 'wind'] as const;
export type Element = (typeof ELEMENTS)[number];

export const STATUS_IDS = ['burning', 'soaked', 'rocked', 'gusted'] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const SLOTS = ['basic', 'secondary', 'utility'] as const;
export type Slot = (typeof SLOTS)[number];

export const SHAPE_TYPES = ['projectile', 'cone', 'stream', 'zone', 'wall', 'self', 'dash'] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

export const CAST_ARCHETYPES = ['throw', 'sweep', 'push', 'slam', 'channel', 'self'] as const;
export type CastArchetype = (typeof CAST_ARCHETYPES)[number];

export const AI_ARCHETYPES = ['rusher', 'shooter', 'tank', 'swarm', 'flyer', 'charger', 'summoner', 'ambusher', 'none'] as const;
export type AiArchetype = (typeof AI_ARCHETYPES)[number];

export const RIG_TYPES = ['own', 'mixamo', 'procedural'] as const;
export type RigType = (typeof RIG_TYPES)[number];

export const ATTACK_TEMPLATES = ['melee_swipe', 'slam', 'projectile', 'charge', 'summon'] as const;
export type AttackTemplate = (typeof ATTACK_TEMPLATES)[number];

export const RARITIES = ['common', 'rare', 'epic'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Button bits in Input.buttons. */
export const BTN = { LMB: 1, RMB: 2, UTIL: 4, DODGE: 8, INTERACT: 16, JUMP: 32 } as const;

/** What a player sends the simulation each tick. swapTo is an index into ELEMENTS, or -1 for none. */
export interface Input {
  moveX: number;
  moveZ: number;
  aimYaw: number;
  aimPitch: number;
  camOrigin: Vec3;
  buttons: number;
  swapTo: number;
}

/** An input that does nothing: standing still, aiming straight ahead. */
export const idleInput = (): Input => ({ moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, camOrigin: { x: 0, y: 1.6, z: 0 }, buttons: 0, swapTo: -1 });

export interface SimEvent {
  t: number;
  type: string;
  [k: string]: unknown;
}

export type StatusMap = Partial<Record<StatusId, { until: number }>>;

export interface GuardState {
  on: boolean;
  until: number;
  staggeredUntil: number;
}

export interface LightingPreset {
  ambient: string;
  light: string;
  intensity: number;
  fogColor: string;
  fogNear: number;
  fogFar: number;
}

// ---- data file shapes ------------------------------------------------------------------------------------------------

export interface PlayerCfg {
  health: number;
  moveSpeed: number;
  radius: number;
  maxAimRange: number;
  dodge: { duration: number; invulnerable: number; cooldown: number; speed: number };
  /** A jump leaves the ground at `speed` m/s upward and is pulled back at `gravity` m/s squared. */
  jump: { speed: number; gravity: number };
  /** How fast a dash skill carries the player, in m/s (it covers its distance over the time that takes, not in one tick). */
  dashSpeed: number;
  swap: { cooldown: number; bonusWindow: number; bonusDamage: number };
  cast: { windupMove: number; channelMove: number };
}

export interface ElementsCfg {
  order: Element[];
  cycle: Record<Element, { weak: Element[]; resist: Element[] }>;
  multipliers: { weak: number; resist: number };
  /** The status each element's hits apply (wind applies none by default). */
  status: Record<Element, StatusId | null>;
}

export interface StatusDef {
  duration: number;
  tickDamage?: number;
  tickInterval?: number;
  spreadRadius?: number;
  speedMul?: number;
  damageTakenMul?: number;
  canAct?: boolean;
}

export interface ReactionDef {
  id: string;
  existing: StatusId;
  hitBy: Element;
  effect: string;
  params: Record<string, number>;
}

/** Flat bag of the numbers each shape type uses; a skill sets the ones its shape needs. */
export interface ShapeDef {
  type: ShapeType;
  speed?: number;
  radius?: number;
  gravity?: number;
  lifetime?: number;
  angle?: number;
  range?: number;
  width?: number;
  length?: number;
  height?: number;
  tick?: number;
  duration?: number;
  count?: number;
  distance?: number;
  absorb?: number;
  damageTakenMul?: number;
  speedMul?: number;
  /** A dash leaves a trail of ground effect this wide, lasting this long. */
  trailRadius?: number;
  trailSeconds?: number;
  /** Set by augments: a projectile explodes in this radius, and passes through this many enemies. */
  explode?: number;
  pierce?: number;
}

export interface SkillDef {
  id: string;
  element: Element;
  slot: Slot;
  shape: ShapeDef;
  damage: number;
  cooldown: number;
  applies: StatusId | null;
  /** Chance (0 to 1) a hit applies the status; a swap-in bonus makes it certain. Missing means always. */
  statusChance?: number;
  cast: { archetype: CastArchetype; windup: number; clip: string; move: number };
  fx: Record<string, string>;
  tags: string[];
}

export interface AttackDef {
  id: string;
  template: AttackTemplate;
  damage: number;
  windup: number;
  cooldown: number;
  range: number;
  radius?: number;
  angle?: number;
  speed?: number;
  applies?: StatusId | null;
  fx?: string;
  /** A summon attack: what appears and how many. */
  summon?: { enemy: string; count: number; /** The most of this kind alive at once; the summoner stops when it is reached. */ cap?: number };
}

export interface HurtCapsuleDef {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  element: Element | 'none';
  weak: Element[];
  resist: Element[];
  immune?: StatusId[];
  model: string;
  tint?: string;
  scale: number;
  rig: { type: RigType; clips?: Record<string, string | string[]>; preset?: string };
  hp: number;
  speed: number;
  cost: number;
  hurtboxes: HurtCapsuleDef[];
  ai: AiArchetype;
  attacks: string[];
  guard?: { reduction: number; onFor: number; offFor: number; staggerOnWeak: number };
  phases?: number[];
}

export interface AugmentOp {
  op: 'add' | 'mul' | 'set' | 'hook';
  path?: string;
  value?: number | string | boolean;
  hook?: string;
}

export interface AugmentDef {
  id: string;
  name: string;
  kind: 'stat' | 'behavior' | 'reaction';
  rarity: Record<Rarity, Record<string, number>>;
  target: { skill?: string; tag?: string; element?: Element; reaction?: string };
  ops: AugmentOp[];
}

export interface RoomPiece {
  kit: string;
  id: string;
  pos: Vec3;
  rotY: number;
  scale: number;
}

export interface RoomFloor {
  kit: string;
  tile: string;
  path?: string;
  /** Edge length in metres of one floor tile. */
  tileSize: number;
}

/** A point of light in a room: a brazier, a candle, a glowing mushroom, a lit gate. */
export interface LightDef {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  dist: number;
}

/** How a generated room is skinned: which textures its floor and walls take and the cool tint over them. */
export interface RoomLook {
  floorTex: string;
  wallTex: string;
  tint: string;
}

export interface RoomDef {
  id: string;
  biome: string;
  size: [number, number];
  floor: RoomFloor;
  pieces: RoomPiece[];
  colliders: Collider[];
  spawns: { player: Vec3; enemies: Vec3[]; doors: Vec3[] };
  lighting: LightingPreset;
  /** Generated rooms only: the floor tiles (a floor of cells, not the whole rectangle), the lights and the skin. */
  cells?: [number, number][];
  lights?: LightDef[];
  look?: RoomLook;
  theme?: string;
}

/** An elite modifier: a name and the numbers its behaviour reads. The modifier's id says which behaviour it is. */
export interface EliteDef {
  id: string;
  name: string;
  params: Record<string, number>;
}

/** An achievement: reaching `atLeast` on a ledger counter unlocks the listed content, which stays hidden until then. */
export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  counter: string;
  atLeast: number;
  unlocks: { skills?: string[]; augments?: string[] };
}

/** One kind of prop a theme scatters: how many, how big, and how much room it keeps clear. */
export interface PoolItem {
  kit: string;
  id: string;
  scale: number;
  count: [number, number];
  /** Metres of free space reserved round it. */
  clear: number;
  /** Quarter turns only, no turn, or any angle (the default). */
  turn?: 'quarter' | 'none';
  /** The light it carries: a brazier, a candle, or a mushroom glow. */
  light?: 'brazier' | 'candle' | 'glow';
}

/** A room style as data: the generator is the same for every theme. */
export interface ThemeDef {
  id: string;
  weight: number;
  minDepth: number;
  /** Cells (4 m) along each side, from the first number to the second. */
  cells: [number, number];
  cutChance: number;
  detailChance: number;
  floor: { kit: string; tile: string; detail: string; tex: string[] };
  wall: { kit: string; plain: string; detail: string; corner: string; gates: string[]; tex: string[] };
  tint: string;
  lighting: LightingPreset;
  lights: { brazier: string; candle: string };
  pools: Record<'set' | 'medium' | 'small' | 'wall', PoolItem[]>;
  /** Enemy id to how often the theme draws it. */
  mobs: Record<string, number>;
}

export interface BiomeDef {
  id: string;
  rooms: string[];
  enemyPool: string[];
  /** Bosses that can close a run that ends in this biome. */
  bosses?: string[];
  lighting: LightingPreset;
}

export interface RewardsCfg {
  offers: number;
  rarity: { early: { until: number; weights: Record<Rarity, number> }; late: { weights: Record<Rarity, number> } };
  healFraction: number;
  guaranteeSkillByRoom: number;
}

export interface GameData {
  player: PlayerCfg;
  elements: ElementsCfg;
  statuses: Record<StatusId, StatusDef>;
  reactionCooldown: number;
  reactions: ReactionDef[];
  skills: Record<string, SkillDef>;
  augments: Record<string, AugmentDef>;
  enemies: Record<string, EnemyDef>;
  attacks: Record<string, AttackDef>;
  rooms: Record<string, RoomDef>;
  biomes: Record<string, BiomeDef>;
  elites: Record<string, EliteDef>;
  unlocks: Record<string, AchievementDef>;
  themes: Record<string, ThemeDef>;
  rewards: RewardsCfg;
}
