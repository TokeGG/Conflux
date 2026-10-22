// Life for the mobs that have no skeleton (and a little extra for the ones that do): breathing, a lean and a bob that follow their
// speed, a draw-back and thrust when they attack, a kick when they are hit, and a pop when they appear. Pure, so it is tested.
// Every number is in MOTION so the dev panel can change it.
export const MOTION = {
  breathAmp: 0.025,
  breathHz: 0.45,
  /** Lean forward in radians per m/s, up to maxLean. */
  leanPerSpeed: 0.12,
  maxLean: 0.35,
  bobAmp: 0.09,
  attackBack: 0.25,
  attackBackSeconds: 0.18,
  attackThrust: 0.5,
  attackThrustSeconds: 0.22,
  attackReturnSeconds: 0.3,
  hurtKick: 0.2,
  hurtSeconds: 0.18,
  popSeconds: 0.45,
  /** How quickly a view follows the simulation's position and turn (per second). */
  followRate: 28,
  turnRate: 14,
};

export interface MobMotionIn {
  /** Seconds the view has been alive (for the cycles). */
  t: number;
  /** Metres per second it is moving at. */
  speed: number;
  /** Seconds since the current attack began, or -1. */
  attackT: number;
  /** Seconds since it was hit, or -1. */
  hurtT: number;
  /** Seconds since it appeared. */
  spawnT: number;
  /** Offsets this mob's cycles from the others'. */
  phase: number;
}

export interface MobMotionOut {
  pos: { x: number; y: number; z: number };
  /** Lean forward, in radians. */
  tilt: number;
  scale: { x: number; y: number; z: number };
}

const easeOutBack = (u: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
};

/** The offset of the body along its facing during an attack: back, then forward, then home. */
function attackZ(t: number): number {
  const m = MOTION;
  if (t < 0) return 0;
  if (t < m.attackBackSeconds) return -m.attackBack * Math.sin((Math.PI / 2) * (t / m.attackBackSeconds));
  const t2 = t - m.attackBackSeconds;
  if (t2 < m.attackThrustSeconds) return -m.attackBack + (m.attackBack + m.attackThrust) * (t2 / m.attackThrustSeconds);
  const t3 = t2 - m.attackThrustSeconds;
  return t3 < m.attackReturnSeconds ? m.attackThrust * (1 - t3 / m.attackReturnSeconds) : 0;
}

export function mobMotion(i: MobMotionIn): MobMotionOut {
  const m = MOTION;
  const breath = Math.sin(2 * Math.PI * m.breathHz * i.t + i.phase);
  let sy = 1 + m.breathAmp * breath;
  let sxz = 1 - m.breathAmp * 0.5 * breath;
  const moving = Math.min(1, i.speed / 2);
  const bobHz = 0.8 + 0.5 * i.speed;
  const y = Math.abs(Math.sin(2 * Math.PI * bobHz * i.t + i.phase)) * m.bobAmp * moving;
  let z = attackZ(i.attackT);
  if (i.hurtT >= 0 && i.hurtT < m.hurtSeconds) {
    const k = 1 - i.hurtT / m.hurtSeconds;
    z -= m.hurtKick * k;
    sy *= 1 - 0.1 * k;
    sxz *= 1 + 0.05 * k;
  }
  if (i.spawnT >= 0 && i.spawnT < m.popSeconds) {
    const s = Math.max(0.001, easeOutBack(i.spawnT / m.popSeconds));
    sy *= s;
    sxz *= s;
  }
  return { pos: { x: 0, y, z }, tilt: Math.min(m.maxLean, m.leanPerSpeed * i.speed), scale: { x: sxz, y: sy, z: sxz } };
}

/** Moves `current` toward `target`, covering the share of the gap that `rate` per second gives in `dt`: never overshoots, frame-rate independent. */
export const dampTo = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));

/** The same for an angle, going the short way round. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-rate * dt));
}
