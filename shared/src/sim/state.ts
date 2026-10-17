// Entities the simulation holds, their snapshot views, and spawning.
import type { Vec3 } from '../math.ts';
import type { EnemyDef, GuardState, StatusId, StatusMap } from '../types.ts';
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
}

export interface EnemyState {
  id: number;
  def: EnemyDef;
  pos: Vec3;
  facing: number;
  hp: number;
  statuses: StatusMap;
  aiState: string;
  guard: GuardState | null;
  cooldowns: Record<string, number>;
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

export interface PlayerSnap {
  pos: Vec3;
  facing: number;
  hp: number;
  maxHp: number;
  element: string;
  statuses: StatusSnap[];
  dodging: boolean;
  casting: string | null;
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
    aiState: 'idle',
    guard: def.guard ? { on: false, until: 0, staggeredUntil: 0 } : null,
    cooldowns: {},
  };
  sim.enemies.push(e);
  return e;
}

/** The enemy's capsules in world space: offsets turn with the facing (yaw) and move with the position. */
export function enemyHurtboxes(e: EnemyState): HurtCapsule[] {
  const c = Math.cos(e.facing);
  const s = Math.sin(e.facing);
  // yaw 0 faces +Z and a positive yaw turns toward +X, so a local +X offset swings toward -Z
  const world = (p: [number, number, number]): Vec3 => ({ x: e.pos.x + p[0] * c + p[2] * s, y: e.pos.y + p[1], z: e.pos.z - p[0] * s + p[2] * c });
  return e.def.hurtboxes.map((h) => ({ enemyId: e.id, a: world(h.a), b: world(h.b), r: h.r }));
}
