// Small builders shared by the simulation tests.
import { Sim } from '../src/sim/sim.ts';
import { defaultData } from '../src/files.ts';
import { BTN, type Input } from '../src/types.ts';
import type { GameData } from '../src/types.ts';
import type { World } from '../src/world.ts';

export { BTN };

export const input = (p: Partial<Input> = {}): Input => ({ moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, camOrigin: { x: 0, y: 1.6, z: -3 }, buttons: 0, swapTo: -1, ...p });
export const idle = (): Input => input();

export function makeSim(seed = 1, opts: { data?: GameData; world?: World } = {}): Sim {
  return new Sim(opts.data ?? defaultData(), seed, opts.world);
}

/** Runs n ticks of the same input and returns every event emitted. */
export function run(sim: Sim, n: number, i: Input = idle()) {
  const events = [];
  for (let k = 0; k < n; k++) events.push(...sim.step([i]));
  return events;
}
