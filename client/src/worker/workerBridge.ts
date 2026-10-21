// The client's side of the simulation worker. Implements the same SimBridge as the in-thread LocalBridge.
import type { RoomEntry, DevCommand, FrameCallback, FromWorker, GameData, Input, SimBridge, ToWorker } from '@conflux/shared';

export class WorkerBridge implements SimBridge {
  private worker: Worker;
  private listeners: FrameCallback[] = [];
  private disposed = false;
  /** Frames that arrive while a room change is in flight belong to the old room and are dropped. */
  private entering: (() => void) | null = null;
  /** Resolves when the worker has built the sim. */
  readonly ready: Promise<void>;

  constructor(seed: number, data: GameData, room?: string) {
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.t === 'ready') resolve();
        else if (m.t === 'entered') {
          this.entering?.();
          this.entering = null;
        } else if (m.t === 'frame' && !this.entering) for (const cb of this.listeners) cb(m.snapshot, m.events);
      };
    });
    this.post({ t: 'init', seed, data, room });
  }

  private post(m: ToWorker): void {
    if (!this.disposed) this.worker.postMessage(m);
  }

  send(input: Input): void {
    this.post({ t: 'input', input });
  }

  command(cmd: DevCommand): void {
    this.post({ t: 'command', cmd });
  }

  /** Replaces the simulation with the run's next room; resolves once the worker has swapped. */
  enter(entry: RoomEntry): Promise<void> {
    return new Promise((resolve) => {
      this.entering = resolve;
      this.post({ t: 'enter', entry });
    });
  }

  onFrame(cb: FrameCallback): void {
    this.listeners.push(cb);
  }

  advance(dtSeconds: number): void {
    this.post({ t: 'advance', dt: dtSeconds });
  }

  dispose(): void {
    this.post({ t: 'dispose' });
    this.disposed = true;
    this.listeners = [];
    this.worker.terminate();
  }
}
