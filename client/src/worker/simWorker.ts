// The simulation's home in the browser: a Web Worker that owns a SimRunner and posts frames back.
import { createRoomSim, installDevCommands, Sim, SimRunner, type FromWorker, type ToWorker } from '@conflux/shared';

const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null; close(): void };
let runner: SimRunner | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      {
        const room = m.room;
        const make = (data: typeof m.data, seed: number) => (room ? createRoomSim(data, seed, room) : new Sim(data, seed));
        runner = new SimRunner(make(m.data, m.seed));
        installDevCommands(runner, (seed) => make(runner!.sim.data, seed));
      }
      scope.postMessage({ t: 'ready' });
      break;
    case 'input':
      runner?.send(m.input);
      break;
    case 'command':
      runner?.command(m.cmd);
      break;
    case 'advance': {
      const frame = runner?.advance(m.dt);
      if (frame) scope.postMessage({ t: 'frame', snapshot: frame.snapshot, events: frame.events });
      break;
    }
    case 'dispose':
      runner = null;
      scope.close();
      break;
  }
};
