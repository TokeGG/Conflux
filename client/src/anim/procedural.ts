// Motion for models with no animation of their own: bobbing, stretching, swaying and lunging, as pure functions of time.
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Transform3 {
  pos: Vec3Like;
  rotY: number;
  scale: Vec3Like;
}

export interface PresetParams {
  /** How far it moves, in metres. */
  amplitude: number;
  /** Cycles per second. */
  speed: number;
  /** Seconds the pattern is shifted by (so a crowd or a row of parts is not in step). */
  phase: number;
}

export const defaultParams = (): PresetParams => ({ amplitude: 0.25, speed: 1.2, phase: 0 });

type Preset = (t: number, p: PresetParams) => Transform3;

const TAU = Math.PI * 2;
const make = (pos: Partial<Vec3Like>, rotY: number, scale: Partial<Vec3Like> = {}): Transform3 => ({
  pos: { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 },
  rotY,
  scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 },
});
/** Position in the cycle, in turns (1 = one full period). */
const turns = (t: number, p: PresetParams) => (t + p.phase) * p.speed;

export const PRESETS: Record<'hop' | 'stomp_sway' | 'hover' | 'ribbon_spin' | 'part_sway' | 'lunge', Preset> = {
  /** Springs off the ground and lands squashed. */
  hop(t, p) {
    const n = turns(t, p);
    const s = Math.abs(Math.sin(Math.PI * n));
    return make({ y: p.amplitude * s }, 0.1 * Math.sin(TAU * n), { x: 1 + 0.06 * (1 - s), y: 1 - 0.12 * (1 - s), z: 1 + 0.06 * (1 - s) });
  },
  /** A heavy step: dips with each stomp and sways side to side. */
  stomp_sway(t, p) {
    const n = turns(t, p);
    return make({ y: -p.amplitude * 0.15 * Math.abs(Math.sin(TAU * n)) }, 0.12 * Math.sin(TAU * n), { y: 1 + 0.03 * Math.sin(2 * TAU * n) });
  },
  /** Floats up and down and turns a little. */
  hover(t, p) {
    const n = turns(t, p);
    return make({ y: p.amplitude * Math.sin(TAU * n) }, 0.2 * Math.sin(TAU * n));
  },
  /** Spins once per period, breathing in and out. */
  ribbon_spin(t, p) {
    const n = turns(t, p);
    return make({ y: p.amplitude * 0.5 * Math.sin(TAU * n) }, TAU * n, { x: 1 + 0.05 * Math.sin(TAU * n), y: 1 + 0.05 * Math.sin(TAU * n), z: 1 + 0.05 * Math.sin(TAU * n) });
  },
  /** A gentle sway; applied to each part of a model with a different phase. */
  part_sway(t, p) {
    const n = turns(t, p);
    return make({ x: 0.04 * p.amplitude * Math.sin(TAU * n), y: 0.08 * p.amplitude * Math.sin(2 * TAU * n) }, 0.08 * Math.sin(TAU * n));
  },
  /** A forward thrust and back, once per period. */
  lunge(t, p) {
    const u = ((turns(t, p) % 1) + 1) % 1;
    return make({ z: p.amplitude * Math.sin(Math.PI * u) ** 2 }, 0);
  },
};
