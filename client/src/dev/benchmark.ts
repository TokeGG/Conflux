// A fixed-length benchmark: the camera circles the room on a set path while frame times are recorded. The stress content
// (enemies, effects) is added by later milestones through the same panel.
import type { Vec3 } from '@conflux/shared';
import { PerfStats } from './perfStats.ts';

export function orbitPose(t: number, seconds: number, centre: Vec3, radius: number, height: number): { pos: Vec3; look: Vec3 } {
  const a = (t / seconds) * Math.PI * 2;
  return { pos: { x: centre.x + Math.sin(a) * radius, y: height, z: centre.z + Math.cos(a) * radius }, look: { ...centre } };
}

export class Benchmark {
  readonly stats = new PerfStats(7200);
  running = false;
  elapsed = 0;

  constructor(readonly seconds = 10) {}

  start(): void {
    this.stats.clear();
    this.elapsed = 0;
    this.running = true;
  }

  /** Records one frame; returns true on the call that completes the run. */
  update(frameMs: number): boolean {
    if (!this.running) return false;
    this.stats.push(frameMs);
    this.elapsed += frameMs / 1000;
    if (this.elapsed + 1e-9 >= this.seconds) {
      this.running = false;
      return true;
    }
    return false;
  }

  progress(): number {
    return Math.min(1, this.elapsed / this.seconds);
  }
}
