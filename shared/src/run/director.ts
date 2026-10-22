// Runs the flow of one run on top of the simulation: fight a room, pick a reward, pick a door, enter the next room, until the
// player dies or the boss falls. It is plain data in and out, so the client's screens and the balance bot drive the same code.
import { makeStreams } from '../rng.ts';
import type { GameData, SimEvent } from '../types.ts';
import { createRoomSim } from '../sim/roomSim.ts';
import { spawnEnemy } from '../sim/state.ts';
import { applyElite } from '../sim/elites.ts';
import type { Sim } from '../sim/sim.ts';
import { applyLoadout, swapIn, equipElement } from './loadout.ts';
import { claimReward, offerRewards, recordOffers, type RewardOffer } from './rewards.ts';
import { ROOM_TO_ROOM, chooseDoor } from './roomToRoom.ts';
import type { DoorChoice, RoomPlan, RunMode, RunState } from './run.ts';
import { recordEvent, recordRunEnd, unlockedPool, type UnlockLedger } from './unlocks.ts';

export type RunPhase = 'fighting' | 'reward' | 'doors' | 'dead' | 'won';

/** A simulation for the run's current room: the plan's enemies in place, and the run's hp, loadout and augments on the player. */
/** What a room needs from the run to be built. */
export type RoomEntry = Pick<RunState, 'seed' | 'current' | 'skills' | 'augments' | 'hp' | 'tuned'>;

export function createRunRoomSim(run: RoomEntry, data: GameData): Sim {
  const plan = run.current;
  const sim = createRoomSim(data, run.seed * 1009 + plan.index, plan.def ?? plan.roomId);
  sim.tuned = run.tuned;
  applyLoadout(sim, run.skills);
  sim.setAugments(run.augments);
  sim.player.hp = run.hp;
  for (const spot of plan.enemies) {
    const e = spawnEnemy(sim, spot.enemyId, { x: spot.at.x, y: sim.world.groundAt(spot.at.x, spot.at.z), z: spot.at.z }, plan.index);
    if (spot.elite) applyElite(sim, e, spot.elite);
  }
  return sim;
}

export class RunDirector {
  run: RunState;
  ledger: UnlockLedger;
  phase: RunPhase = 'fighting';
  offers: RewardOffer[] = [];
  doors: DoorChoice[] = [];
  /** Achievements earned during this run, newest last. */
  earned: string[] = [];
  /** Called with the new room's plan when the player walks through a gate (the client then loads it). */
  onEnter: ((plan: RoomPlan) => void) | null = null;
  private mode: RunMode;

  constructor(data: GameData, seed: number, ledger: UnlockLedger, tuned = false, mode: RunMode = ROOM_TO_ROOM) {
    this.ledger = ledger;
    this.mode = mode;
    this.run = mode.start(seed, data, tuned, unlockedPool(ledger, data));
  }

  private record(next: UnlockLedger): void {
    for (const id of next.unlocked) if (!this.ledger.unlocked.includes(id)) this.earned.push(id);
    this.ledger = next;
  }

  /** Feeds the events of a step. A cleared room moves on to the reward screen, or to victory after the boss. */
  onEvents(events: SimEvent[]): void {
    if (this.phase === 'doors') {
      // walking into a gate is choosing that door
      const gate = events.find((e) => e.type === 'door_entered');
      if (gate && this.doors[Number(gate.door)]) this.onEnter?.(this.enter(Number(gate.door)));
      return;
    }
    if (this.phase !== 'fighting') return;
    for (const e of events) {
      this.record(recordEvent(this.ledger, e, this.run));
      if (e.type !== 'room_cleared') continue;
      this.run = this.mode.onRoomCleared(this.run);
      if (this.run.status === 'victory') {
        this.phase = 'won';
        this.record(recordRunEnd(this.ledger, this.run));
      } else {
        this.offers = offerRewards(this.run, this.run.data, makeStreams(this.run.seed).reward.fork(`room/${this.run.roomIndex}`));
        this.run = recordOffers(this.run, this.offers);
        this.phase = 'reward';
      }
      return;
    }
  }

  /** A dev command changed the sim: from now on the run counts toward nothing. */
  markTuned(): void {
    if (!this.run.tuned) this.run = { ...this.run, tuned: true };
  }

  /** Reports the player's health; at 0 the run is lost. Health carries into the next room. */
  onPlayerHp(hp: number): void {
    if (this.phase !== 'fighting') return;
    if (hp <= 0) {
      this.run = { ...this.run, hp: 0, status: 'defeat' };
      this.phase = 'dead';
      this.record(recordRunEnd(this.ledger, this.run));
    } else {
      this.run = { ...this.run, hp };
    }
  }

  /** Takes reward `i` of the offers and shows the doors. An element offer also needs `slot`, the key (0 to 2) it takes over. */
  pick(i: number, slot?: number): void {
    if (this.phase !== 'reward' || !this.offers[i]) return;
    const offer = this.offers[i];
    if (offer.kind === 'element') {
      if (slot === undefined || !offer.element || this.run.skills.equipped.includes(offer.element)) return;
      this.run = { ...this.run, skills: equipElement(this.run.skills, slot, offer.element) };
    }
    this.run = claimReward(this.run, offer);
    // a skill found is put to use at once; the one it replaces stays owned
    if (offer.kind === 'skill' && offer.id && this.run.skills.pool.includes(offer.id)) {
      const s = this.run.data.skills[offer.id];
      this.run = { ...this.run, skills: swapIn(this.run.skills, s.element, s.slot, offer.id, this.run.data) };
    }
    this.doors = this.mode.nextChoices(this.run);
    this.phase = 'doors';
  }

  /** Walks through door `i` and returns the new room's plan. */
  enter(i: number): RoomPlan {
    if (this.phase !== 'doors' || !this.doors[i]) throw new Error('there is no door to enter');
    this.run = chooseDoor(this.run, this.doors[i]);
    this.offers = [];
    this.doors = [];
    this.phase = 'fighting';
    return this.run.current;
  }
}
