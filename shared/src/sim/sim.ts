// The simulation: a fixed 60 Hz tick over plain data. It takes inputs and returns events; it never touches graphics.
import { World } from '../world.ts';
import { makeStreams, type Streams } from '../rng.ts';
import { ELEMENTS, SLOTS, type Element, type GameData, type Input, type SimEvent, type Slot } from '../types.ts';
import { EVENT_TYPES, type SimEventType } from '../events.ts';
import { stateHash } from './hash.ts';
import { stepPlayer } from './player.ts';
import { handleSwapAndCast } from './swap.ts';
import { stepProjectiles, stepZones } from './projectiles.ts';
import type { EnemyState, PlayerState, Projectile, Snapshot, StatusSnap, Zone } from './state.ts';
import type { StatusMap } from '../types.ts';

export const TICK = 1 / 60;

/** The first skill (by id) of each element and slot; the loadout system replaces this per run. */
function defaultLoadout(data: GameData): Record<Element, Record<Slot, string>> {
  const out = {} as Record<Element, Record<Slot, string>>;
  for (const el of ELEMENTS) {
    out[el] = {} as Record<Slot, string>;
    for (const slot of SLOTS) out[el][slot] = Object.keys(data.skills).sort().find((id) => data.skills[id].element === el && data.skills[id].slot === slot) ?? '';
  }
  return out;
}

export class Sim {
  readonly data: GameData;
  readonly seed: number;
  readonly world: World;
  readonly streams: Streams;
  tick = 0;
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
      dodgeUntil: 0,
      invulnUntil: 0,
      dodgeReadyAt: 0,
      element: 0,
      swapReadyAt: 0,
      castState: null,
      cooldowns: {},
      buff: null,
      swapBonusUntil: 0,
      loadout: defaultLoadout(data),
    };
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
    if (this.time < p.invulnUntil || p.hp <= 0) return false;
    const b = p.buff && this.time < p.buff.until ? p.buff : null;
    let dmg = amount * (b ? b.damageTakenMul : 1);
    if (b && b.absorb > 0) {
      const soaked = Math.min(b.absorb, dmg);
      b.absorb -= soaked;
      dmg -= soaked;
    }
    p.hp = Math.max(0, p.hp - dmg);
    this.emit('hit', { target: 'player', amount: dmg });
    return true;
  }

  /** Advances one tick and returns the events emitted since the previous step. */
  step(inputs: Input[]): SimEvent[] {
    if (inputs[0]) {
      handleSwapAndCast(this, this.player, inputs[0]);
      stepPlayer(this, this.player, inputs[0], TICK);
    }
    stepProjectiles(this, TICK);
    stepZones(this);
    const out = this.events;
    this.events = [];
    this.tick++;
    return out;
  }

  snapshot(): Snapshot {
    const now = this.time;
    const list = (m: StatusMap): StatusSnap[] => (Object.keys(m) as (keyof StatusMap)[]).map((id) => ({ id, remaining: Math.max(0, m[id]!.until - now) }));
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
          statuses: list(p.statuses),
          dodging: now < p.dodgeUntil,
          casting: p.castState ? p.castState.skillId : null,
        },
      ],
      enemies: this.enemies.map((e) => ({
        id: e.id,
        defId: e.def.id,
        pos: { ...e.pos },
        facing: e.facing,
        hp: e.hp,
        maxHp: e.def.hp,
        statuses: list(e.statuses),
        aiState: e.aiState,
        guardOn: !!e.guard?.on,
      })),
      projectiles: this.projectiles.map((q) => ({ id: q.id, pos: { ...q.pos }, skillId: q.skillId })),
      zones: this.zones.map((z) => ({ id: z.id, kind: z.kind, pos: { ...z.pos }, radius: z.radius, remaining: Math.max(0, z.until - now) })),
    };
  }

  hash(): string {
    const s = this.streams;
    return stateHash({ tick: this.tick, rng: [s.map.state(), s.encounter.state(), s.reward.state(), s.combat.state()], player: this.player, enemies: this.enemies, projectiles: this.projectiles, zones: this.zones });
  }
}
