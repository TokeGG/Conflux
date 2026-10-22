// The simulation: a fixed 60 Hz tick over plain data. It takes inputs and returns events; it never touches graphics.
import type { Vec3 } from '../math.ts';
import { NavGrid } from './nav.ts';
import { World } from '../world.ts';
import { makeStreams, type Streams } from '../rng.ts';
import { ELEMENTS, SLOTS, type Element, type GameData, type Input, type ReactionDef, type SimEvent, type Slot, type SkillDef } from '../types.ts';
import { EVENT_TYPES, type SimEventType } from '../events.ts';
import { stateHash } from './hash.ts';
import { stepPlayer } from './player.ts';
import { handleSwapAndCast } from './swap.ts';
import { popShield } from './skills.ts';
import { tickStatuses } from './statuses.ts';
import { applyAugments, applyReactionAugments } from '../run/augments.ts';
import type { OwnedAugment } from '../run/run.ts';
import { stepAI } from './ai.ts';
import { stepElites } from './elites.ts';
import { stepAttacks } from './attacks.ts';
import { stepProjectiles, stepZones } from './projectiles.ts';
import { MARK_IDS, type EnemyState, type PlayerState, Projectile, Snapshot, StatusSnap, Zone } from './state.ts';
import type { StatusMap } from '../types.ts';

export const TICK = 1 / 60;
/** How close to a gate's inside point the player must come to walk through it. */
const DOOR_REACH = 1.3;

/** The first skill (in the data file's order) of each element and slot; the loadout system replaces this per run. */
function defaultLoadout(data: GameData): Record<Element, Record<Slot, string>> {
  const out = {} as Record<Element, Record<Slot, string>>;
  for (const el of ELEMENTS) {
    out[el] = {} as Record<Slot, string>;
    for (const slot of SLOTS) out[el][slot] = Object.keys(data.skills).find((id) => data.skills[id].element === el && data.skills[id].slot === slot) ?? '';
  }
  return out;
}

export class Sim {
  readonly data: GameData;
  readonly seed: number;
  readonly world: World;
  readonly streams: Streams;
  tick = 0;
  /** The augments the player owns; skills are read through `skill()` so they apply. */
  augments: OwnedAugment[] = [];
  private skillCache = new Map<string, { base: SkillDef; augments: OwnedAugment[]; out: SkillDef }>();
  /** How many enemies have ever been spawned, and whether the room has been announced as cleared. */
  spawned = 0;
  roomCleared = false;
  private navGrid: NavGrid | null = null;
  /** How enemies find their way round the room's walls and props (built the first time it is needed). */
  get nav(): NavGrid {
    return (this.navGrid ??= new NavGrid(this.world));
  }
  /** The gates of the room (inside points). Walking into one after the room is cleared emits `door_entered`. */
  doors: Vec3[] = [];
  private inDoor = -1;
  /** Dev switches. None of them is part of the hash; a run that used one is marked tuned. */
  god = false;
  noCooldowns = false;
  tuned = false;
  /** The last input the player sent (the dev tools use it to find the crosshair). */
  lastInput: Input | null = null;
  player: PlayerState;
  enemies: EnemyState[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  private events: SimEvent[] = [];
  private nextId = 1;

  constructor(data: GameData, seed: number, world: World = new World([])) {
    this.data = data;
    this.seed = seed;
    this.world = world;
    this.streams = makeStreams(seed);
    this.player = {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      facing: 0,
      hp: data.player.health,
      statuses: {},
      marks: {},
      dodgeUntil: 0,
      invulnUntil: 0,
      dodgeReadyAt: 0,
      element: 0,
      equipped: ELEMENTS.slice(0, 3),
      swapReadyAt: 0,
      vy: 0,
      dash: null,
      castState: null,
      cooldowns: {},
      buff: null,
      swapBonusUntil: 0,
      loadout: defaultLoadout(data),
    };
  }

  /** Replaces the owned augments. */
  setAugments(list: OwnedAugment[]): void {
    this.augments = [...list];
  }

  /** The skill as the owned augments shape it (cached until the skill's data or the augments change). */
  skill(id: string): SkillDef | undefined {
    const base = this.data.skills[id];
    if (!base) return undefined;
    const hit = this.skillCache.get(id);
    if (hit && hit.base === base && hit.augments === this.augments) return hit.out;
    const out = this.augments.length ? applyAugments(base, this.augments, this.data.augments) : base;
    this.skillCache.set(id, { base, augments: this.augments, out });
    return out;
  }

  /** A reaction's numbers with the owned reaction augments applied. */
  reactionParams(row: ReactionDef): Record<string, number> {
    return this.augments.length ? applyReactionAugments(row, this.augments, this.data.augments) : row.params;
  }

  get time(): number {
    return this.tick * TICK;
  }

  allocId(): number {
    return this.nextId++;
  }

  /** Queues an event (stamped with the current time); it is returned by the next step. */
  emit(type: SimEventType, fields: Record<string, unknown> = {}): SimEvent {
    if (!(EVENT_TYPES as readonly string[]).includes(type)) throw new Error(`unknown event type ${type}`);
    const e: SimEvent = { ...fields, t: this.time, type };
    this.events.push(e);
    return e;
  }

  /** Applies damage to the player unless a dodge makes them invulnerable. True when it landed. */
  hurtPlayer(amount: number): boolean {
    const p = this.player;
    if (this.god || this.time < p.invulnUntil || p.hp <= 0) return false;
    const b = p.buff && this.time < p.buff.until ? p.buff : null;
    let dmg = amount * (b ? b.damageTakenMul : 1);
    if (b && b.absorb > 0) {
      const soaked = Math.min(b.absorb, dmg);
      b.absorb -= soaked;
      dmg -= soaked;
      if (b.absorb <= 0) popShield(this, b.skillId);
    }
    p.hp = Math.max(0, p.hp - dmg);
    this.emit('hit', { target: 'player', amount: dmg });
    return true;
  }

  /** Advances one tick and returns the events emitted since the previous step. */
  step(inputs: Input[]): SimEvent[] {
    if (inputs[0]) {
      this.lastInput = inputs[0];
      handleSwapAndCast(this, this.player, inputs[0]);
      stepPlayer(this, this.player, inputs[0], TICK);
    }
    stepAI(this, TICK);
    this.stepDoors();
    stepElites(this);
    stepAttacks(this);
    stepProjectiles(this, TICK);
    stepZones(this);
    for (const c of [this.player, ...this.enemies]) tickStatuses(this, c, TICK);
    const out = this.events;
    this.events = [];
    this.tick++;
    return out;
  }

  /** A gate is entered when the player comes into it after the room is cleared; standing in one when the room clears does not count. */
  private stepDoors(): void {
    const near = this.doors.findIndex((d) => Math.hypot(d.x - this.player.pos.x, d.z - this.player.pos.z) < DOOR_REACH);
    if (this.roomCleared && near >= 0 && this.inDoor < 0) this.emit('door_entered', { door: near });
    this.inDoor = near;
  }

  snapshot(): Snapshot {
    const now = this.time;
    const list = (m: StatusMap): StatusSnap[] => (Object.keys(m) as (keyof StatusMap)[]).filter((id) => m[id]!.until > now).map((id) => ({ id, remaining: m[id]!.until - now }));
    const p = this.player;
    return {
      tick: this.tick,
      time: now,
      players: [
        {
          pos: { ...p.pos },
          facing: p.facing,
          hp: p.hp,
          maxHp: this.data.player.health,
          element: ELEMENTS[p.element],
          equipped: [...p.equipped],
          statuses: list(p.statuses),
          dodging: now < p.dodgeUntil,
          casting: p.castState ? p.castState.skillId : null,
          slots: SLOTS.map((slot) => {
            const skillId = p.loadout[ELEMENTS[p.element]][slot];
            return { slot, skillId, remaining: Math.max(0, (p.cooldowns[skillId] ?? 0) - now), total: this.skill(skillId)?.cooldown ?? 0 };
          }),
          swapRemaining: Math.max(0, p.swapReadyAt - now),
          bonusRemaining: Math.max(0, p.swapBonusUntil - now),
        },
      ],
      enemies: this.enemies.map((e) => ({
        id: e.id,
        defId: e.def.id,
        pos: { ...e.pos },
        facing: e.facing,
        hp: e.hp,
        maxHp: e.maxHp,
        statuses: list(e.statuses),
        aiState: e.aiState,
        guardOn: !!e.guard?.on,
        attack: e.attack?.attackId ?? null,
        attackPhase: e.attack?.phase ?? null,
        attackProgress: attackProgress(this, e),
        elite: e.elite,
        level: e.level,
        marks: MARK_IDS.filter((id) => (e.marks[id]?.until ?? 0) > now).map((id) => ({ id, remaining: e.marks[id]!.until - now })),
      })),
      projectiles: this.projectiles.map((q) => ({ id: q.id, pos: { ...q.pos }, skillId: q.skillId })),
      zones: this.zones.map((z) => ({ id: z.id, kind: z.kind, pos: { ...z.pos }, radius: z.radius, remaining: Math.max(0, z.until - now) })),
      tuned: this.tuned,
    };
  }

  hash(): string {
    const s = this.streams;
    return stateHash({ tick: this.tick, rng: [s.map.state(), s.encounter.state(), s.reward.state(), s.combat.state()], player: this.player, enemies: this.enemies, projectiles: this.projectiles, zones: this.zones, augments: this.augments });
  }
}

/** How far an enemy is through its attack: the share of the windup gone (1 at the hit moment), or of a charge's run; 0 with no attack. */
function attackProgress(sim: Sim, e: EnemyState): number {
  const act = e.attack;
  if (!act) return 0;
  const a = sim.data.attacks[act.attackId];
  if (!a) return 0;
  const u = act.phase === 'windup' ? 1 - (act.hitAt - sim.time) / Math.max(a.windup, 1e-6) : 1 - act.remaining / Math.max(a.range, 1e-6);
  return Math.max(0, Math.min(1, u));
}
