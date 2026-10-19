// The client's side of the simulation worker. Implements the same SimBridge as the in-thread LocalBridge.
import type { DevCommand, FrameCallback, FromWorker, GameData, Input, SimBridge, ToWorker } from '@conflux/shared';

export class WorkerBridge implements SimBridge {
  private worker: Worker;
  private listeners: FrameCallback[] = [];
  private disposed = false;
  /** Resolves when the worker has built the sim. */
  readonly ready: Promise<void>;

  constructor(seed: number, data: GameData) {
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.t === 'ready') resolve();
        else if (m.t === 'frame') for (const cb of this.listeners) cb(m.snapshot, m.events);
      };
    });
    this.post({ t: 'init', seed, data });
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
