// How the game talks to the simulation. SimRunner is the time accumulator with a hard cap on catch-up; LocalBridge runs it on the
// same thread (tests, the dev bot), and the client's WorkerBridge runs the very same SimRunner inside a Web Worker.
import { TICK, Sim } from './sim/sim.ts';
import { idleInput, type GameData, type Input, type SimEvent } from './types.ts';
import type { Snapshot } from './sim/state.ts';

/** A tab that was in the background returns with a huge time step: never run more than this many ticks for one advance. */
export const MAX_TICKS_PER_ADVANCE = 5;

export type DevCommand = { op: string; [k: string]: unknown };

export type FrameCallback = (snapshot: Snapshot, events: SimEvent[]) => void;

export interface SimBridge {
  send(input: Input): void;
  command(cmd: DevCommand): void;
  onFrame(cb: FrameCallback): void;
  advance(dtSeconds: number): void;
  dispose(): void;
}

export type ToWorker = { t: 'init'; seed: number; data: GameData } | { t: 'input'; input: Input } | { t: 'command'; cmd: DevCommand } | { t: 'advance'; dt: number } | { t: 'dispose' };
export type FromWorker = { t: 'ready' } | { t: 'frame'; snapshot: Snapshot; events: SimEvent[] };

export interface Frame {
  snapshot: Snapshot;
  events: SimEvent[];
}

const EPS = 1e-9;

export class SimRunner {
  private acc = 0;
  private input: Input = idleInput();
  private commands: DevCommand[] = [];
  private handler: ((cmd: DevCommand) => void) | null = null;

  constructor(readonly sim: Sim) {}

  send(input: Input): void {
    this.input = input;
  }

  command(cmd: DevCommand): void {
    if (this.handler) this.commands.push(cmd);
  }

  setCommandHandler(handler: (cmd: DevCommand) => void): void {
    this.handler = handler;
  }

  /** Runs the whole ticks that fit in dt (at most MAX_TICKS_PER_ADVANCE) and returns one frame, or null when no tick ran. */
  advance(dt: number): Frame | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.acc += dt;
    const events: SimEvent[] = [];
    let ran = 0;
    while (this.acc + EPS >= TICK && ran < MAX_TICKS_PER_ADVANCE) {
      this.flushCommands();
      events.push(...this.sim.step([this.input]));
      this.acc -= TICK;
      ran++;
    }
    if (this.acc + EPS >= TICK) this.acc = 0; // drop the backlog instead of saving it for later
    if (this.acc < 0) this.acc = 0;
    return ran > 0 ? { snapshot: this.sim.snapshot(), events } : null;
  }

  private flushCommands(): void {
    const queued = this.commands;
    this.commands = [];
    for (const c of queued) this.handler?.(c);
  }
}

export class LocalBridge implements SimBridge {
  readonly runner: SimRunner;
  private listeners: FrameCallback[] = [];
  private disposed = false;

  constructor(sim: Sim) {
    this.runner = new SimRunner(sim);
  }

  get sim(): Sim {
    return this.runner.sim;
  }

  send(input: Input): void {
    if (!this.disposed) this.runner.send(input);
  }

  command(cmd: DevCommand): void {
    if (!this.disposed) this.runner.command(cmd);
  }

  setCommandHandler(handler: (cmd: DevCommand) => void): void {
    this.runner.setCommandHandler(handler);
  }

  onFrame(cb: FrameCallback): void {
    this.listeners.push(cb);
  }

  advance(dtSeconds: number): void {
    if (this.disposed) return;
    const frame = this.runner.advance(dtSeconds);
    if (frame) for (const cb of this.listeners) cb(frame.snapshot, frame.events);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}
