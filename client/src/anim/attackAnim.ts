// How a mob shows its attack: a wind-up that follows the simulation's own progress, a strike on the hit moment and a recovery.
// Pure, so it is tested. Every attack in attacks.json has a style here; every number lives in an exported object the dev panel can edit.
//
// A pose is two weighted frames: `back` (the held, drawn-back look of the wind-up) and `fwd` (the follow-through at the hit). The wind-up fills `back`
// from 0 to 1 with the sim's progress, the strike swaps it for `fwd` in a few frames, and the recovery brings `fwd` home to the rest pose.

export type AttackTemplate = 'melee_swipe' | 'slam' | 'projectile' | 'charge' | 'summon';
export type AttackStage = 'windup' | 'strike' | 'recover';

/** One look of the body. Positions are metres along the mob's own axes (z forward), angles are radians, `sy` and `sxz` are changes from a scale of 1. */
export interface Frame {
  y: number;
  z: number;
  /** Lean forward (positive) or back (negative). */
  tilt: number;
  /** Twist about the vertical axis. */
  yaw: number;
  /** Roll to the side. */
  roll: number;
  sy: number;
  sxz: number;
  /** Arm rotations: x raises it overhead (negative) or swings it down and forward (positive), z spreads it out. */
  armRx: number;
  armRz: number;
  armLx: number;
  armLz: number;
  /** A held weapon's swing about its grip (the reaper's scythe). */
  weapon: number;
  /** How far the parts of a book open. */
  open: number;
  /** Extra turn of loose parts (a book's pages) and of the whole body, in radians. */
  spin: number;
}

export const REST_FRAME: Readonly<Frame> = { y: 0, z: 0, tilt: 0, yaw: 0, roll: 0, sy: 0, sxz: 0, armRx: 0, armRz: 0, armLx: 0, armLz: 0, weapon: 0, open: 0, spin: 0 };
const KEYS = Object.keys(REST_FRAME) as (keyof Frame)[];
const frame = (f: Partial<Frame>): Frame => ({ ...REST_FRAME, ...f });

export interface AttackStyle {
  template: AttackTemplate;
  /** Swing direction: 1 swings from the right shoulder across, -1 the other way. */
  side?: number;
  /** Overrides on the template's drawn-back frame and its follow-through. */
  back?: Partial<Frame>;
  fwd?: Partial<Frame>;
  /** Scales every offset of this attack (1 is the template's). */
  amp?: number;
  /** A shake in the last of the wind-up, in metres. */
  tremble?: number;
}

/** The frames each template starts from. */
export const TEMPLATE_FRAMES: Record<AttackTemplate, { back: Frame; fwd: Frame; tremble: number }> = {
  melee_swipe: {
    back: frame({ z: -0.15, tilt: -0.25, yaw: -0.6, sy: 0.04, armRx: -2.4, weapon: -1.4 }),
    fwd: frame({ z: 0.4, tilt: 0.3, yaw: 0.6, sy: -0.04, sxz: 0.03, armRx: 0.5, weapon: 1.2 }),
    tremble: 0.01,
  },
  slam: {
    back: frame({ y: 0.35, z: -0.2, tilt: -0.4, sy: 0.12, sxz: -0.06, armRx: -2.9, armLx: -2.9, weapon: -2 }),
    fwd: frame({ y: -0.1, z: 0.35, tilt: 0.45, sy: -0.2, sxz: 0.12, armRx: 0.6, armLx: 0.6, weapon: 1.5 }),
    tremble: 0.02,
  },
  projectile: {
    back: frame({ z: -0.25, tilt: -0.3, sy: -0.08, sxz: 0.04, armRx: -1.6, armLx: -0.6, weapon: -1 }),
    fwd: frame({ z: 0.12, tilt: 0.18, sy: 0.07, sxz: -0.04, armRx: -1.5, armLx: -1.1, weapon: 0.6 }),
    tremble: 0.025,
  },
  charge: {
    back: frame({ y: -0.08, z: -0.45, tilt: 0.45, sy: -0.18, sxz: 0.08, armRx: 0.7, armLx: 0.7, weapon: -0.8 }),
    fwd: frame({ z: 0.5, tilt: 0.75, sy: 0.1, sxz: -0.08, armRx: 1.1, armLx: 1.1, weapon: 0.8 }),
    tremble: 0.035,
  },
  summon: {
    back: frame({ y: 0.4, tilt: -0.15, sy: 0.1, sxz: -0.05, armRx: -2.6, armLx: -2.6, armRz: 0.5, armLz: -0.5, spin: 1.2, weapon: -1.2 }),
    fwd: frame({ y: 0.1, sy: -0.1, sxz: 0.18, armRx: -1.4, armLx: -1.4, armRz: 0.9, armLz: -0.9, spin: 2.4, weapon: 0.4 }),
    tremble: 0.02,
  },
};

/** The style of every attack in attacks.json. A test checks that none is missing. */
export const ATTACK_STYLES: Record<string, AttackStyle> = {
  'atk.slam_basic': { template: 'slam' },
  'atk.swipe_basic': { template: 'melee_swipe' },
  'atk.bolt_basic': { template: 'projectile' },
  'atk.charge_basic': { template: 'charge' },
  'atk.summon_basic': { template: 'summon' },
  // the stump: a snapping bite, low and quick
  'atk.stump_bite': { template: 'melee_swipe', amp: 0.8, back: { z: -0.2, tilt: -0.5, yaw: 0, sy: 0.14, armRx: 0 }, fwd: { z: 0.45, tilt: 0.7, yaw: 0, sy: -0.2, sxz: 0.1, armRx: 0 } },
  // the treefellow: rears up tall and brings its roots down
  'atk.root_slam': { template: 'slam', back: { y: 0.3, tilt: -0.5, sy: 0.2, sxz: -0.1 }, fwd: { y: -0.15, tilt: 0.55, sy: -0.25, sxz: 0.16 }, tremble: 0.035 },
  // the golem: both fists overhead, then down
  'atk.golem_slam': { template: 'slam', amp: 1.1, back: { y: 0.25, tilt: -0.35, armRz: 0.4, armLz: -0.4 }, fwd: { y: -0.12, tilt: 0.5 }, tremble: 0.03 },
  'atk.golem_swipe': { template: 'melee_swipe', back: { yaw: -0.9, tilt: -0.15, armRx: -1.8, armRz: 1.3 }, fwd: { yaw: 0.9, tilt: 0.2, armRx: 0.2, armRz: 0.2 } },
  // the wisps: a flicker of light gathered, then thrown
  'atk.ember_bolt': { template: 'projectile', amp: 0.8, back: { y: 0.12, tilt: -0.35, sy: 0.12, sxz: -0.08, spin: 0.8 }, fwd: { y: 0.04, z: 0.2, tilt: 0.25, spin: 1.6 } },
  'atk.wisp_dive': { template: 'charge', back: { y: 0.3, z: -0.35, tilt: -0.5, sy: 0.15, sxz: -0.1, spin: 1.5 }, fwd: { y: -0.2, z: 0.6, tilt: 0.95, sy: 0.18, sxz: -0.14, spin: 5 } },
  'atk.gust_nip': { template: 'melee_swipe', amp: 0.7, back: { tilt: -0.3, yaw: -0.4, roll: -0.3, spin: 0.6 }, fwd: { tilt: 0.45, yaw: 0.5, roll: 0.3, spin: 2.5 } },
  // the maw
  'atk.maw_claw': { template: 'melee_swipe', amp: 1.1, side: 1 },
  'atk.maw_slam': { template: 'slam', amp: 1.15 },
  'atk.maw_charge': { template: 'charge', amp: 1.1 },
  'atk.maw_summon': { template: 'summon', amp: 1.1 },
  // the reaper: an overhead scythe chop (the blade tips back behind the head, then comes down in front: at rest it stands upright, positive weapon swings the tip forward and down), a low sweep for the wave and a stomp that raises spikes.
  // The body never turns more than a sliver (yaw stays small, spin is zero): the scythe does the moving, the boss does not spin.
  'atk.reaper_scythe': { template: 'melee_swipe', amp: 1, back: { y: 0.25, z: -0.2, tilt: -0.35, yaw: -0.12, sy: 0.08, weapon: -1.2, armRx: 0 }, fwd: { y: -0.1, z: 0.45, tilt: 0.4, yaw: 0.12, sy: -0.06, weapon: 1.5, armRx: 0 }, tremble: 0.02 },
  'atk.reaper_wave': { template: 'projectile', amp: 1, back: { y: -0.05, z: -0.2, tilt: 0.1, yaw: -0.25, weapon: -0.9, armRx: 0, armLx: 0 }, fwd: { z: 0.3, tilt: 0.25, yaw: 0.25, weapon: 0.9, armRx: 0, armLx: 0 }, tremble: 0.03 },
  'atk.reaper_spikes': { template: 'slam', amp: 1, back: { y: 0.6, z: -0.1, tilt: -0.25, sy: 0.15, weapon: -0.7, armRx: 0, armLx: 0 }, fwd: { y: -0.2, z: 0.2, tilt: 0.3, sy: -0.22, sxz: 0.14, weapon: 1.1, armRx: 0, armLx: 0 }, tremble: 0.035 },
  // the undead
  'atk.skeleton_slash': { template: 'melee_swipe', side: -1 },
  'atk.bone_bolt': { template: 'projectile', back: { armRx: -2.2, armLx: -2.2, tilt: -0.2 }, fwd: { armRx: -1.4, armLx: -1.4 } },
  'atk.bone_stomp': { template: 'slam', amp: 1.1, back: { y: 0.3, tilt: -0.3 }, fwd: { y: -0.15, tilt: 0.4 } },
  'atk.zombie_claw': { template: 'melee_swipe', amp: 0.9, back: { tilt: 0.1, yaw: -0.3, armRx: -1.4, armLx: -1.4 }, fwd: { z: 0.5, tilt: 0.45, yaw: 0.3, armRx: -0.4, armLx: -0.4 } },
  'atk.vampire_lunge': { template: 'charge', back: { tilt: 0.2, yaw: -0.4, sy: -0.1, armRx: -2.2, armLx: 0.6 }, fwd: { z: 0.7, tilt: 0.8, yaw: 0.2, armRx: -0.8, armLx: -0.8 } },
  'atk.ghost_wail': { template: 'charge', amp: 0.9, back: { y: 0.3, z: -0.2, tilt: -0.55, sy: 0.2, sxz: -0.1, armRx: -2.4, armLx: -2.4, armRz: 0.8, armLz: -0.8 }, fwd: { y: 0.1, z: 0.5, tilt: 0.6, sy: 0.25, sxz: -0.12, armRx: -1.2, armLx: -1.2 } },
  // the elementals and the wraith
  'atk.elemental_swipe': { template: 'melee_swipe', amp: 1.1, side: 1 },
  'atk.tide_bolt': { template: 'projectile', back: { armRx: -2, armLx: -2, tilt: -0.35 }, fwd: { armRx: -1.3, armLx: -1.3 } },
  'atk.wraith_rush': { template: 'charge', back: { tilt: -0.1, y: 0.1, armRx: -1.0, armLx: -1.0, sy: 0.05 }, fwd: { z: 0.7, tilt: 0.9, armRx: 1.2, armLx: 1.2, sy: 0.15, sxz: -0.12 } },
  // the books: a flurry of pages that spin out, a heavy cover-slam and a call for more books
  'atk.page_flurry': { template: 'projectile', amp: 0.9, back: { y: 0.15, tilt: -0.5, open: 0.9, spin: 1.5, sy: 0.08 }, fwd: { y: 0.05, tilt: 0.3, open: 1.2, spin: 5.5, sy: -0.06 } },
  'atk.tome_slam': { template: 'slam', back: { y: 0.4, tilt: -0.5, open: 1, spin: 0.8 }, fwd: { y: -0.12, tilt: 0.5, open: -0.5, spin: 0 }, tremble: 0.03 },
  'atk.tome_summon': { template: 'summon', back: { open: 1, spin: 2 }, fwd: { open: 1.2, spin: 5 } },
};

/** How long the strike and the recovery last after the hit moment. */
export const ATTACK_TIMING = { strikeSeconds: 0.12, recoverSeconds: 0.45, /** Share of a rigged mob's attack clip at which its blow lands. */ clipHitFraction: 0.5 };

/** Per-attack clip share where the blow lands, for clips that differ from the default. */
export const CLIP_HIT_FRACTION: Record<string, number> = {
  // the golem's overhead slam rears up for the first half and its fists land at 0.58 of the clip
  Attack2: 0.58,
};

/** The clip a rigged mob plays for an attack: its own entry in `rig.attackClips`, else one of `rig.clips.attack` picked by a hash of the id, else none. */
export function attackClip(rig: { clips?: Record<string, string | string[]>; attackClips?: Record<string, string> }, attackId: string): string | null {
  const own = rig.attackClips?.[attackId];
  if (own) return own;
  const list = rig.clips?.attack;
  if (!list) return null;
  if (!Array.isArray(list)) return list;
  if (!list.length) return null;
  return list[[...attackId].reduce((a, ch) => a + ch.charCodeAt(0), 0) % list.length];
}

/** How strongly the whole-body pose is laid on a mob whose own clip already moves its limbs (0 to 1). */
export const CLIPPED_BODY_WEIGHT = 0.45;

export interface AttackPose extends Frame {
  /** 0 at rest, up to 1 at the hit moment; handy for glow and tests. */
  energy: number;
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
const clamp01 = (u: number) => (Number.isFinite(u) ? Math.max(0, Math.min(1, u)) : 0);

/** The style of an attack, or its template's plain one for an id that has no entry. */
export function styleOf(attackId: string, template: AttackTemplate = 'melee_swipe'): AttackStyle {
  return ATTACK_STYLES[attackId] ?? { template };
}

/** The two frames of an attack with its style folded in: side mirrors the twist and roll, amp scales every offset. */
export function framesOf(attackId: string, template?: AttackTemplate): { back: Frame; fwd: Frame; tremble: number } {
  const st = styleOf(attackId, template);
  const base = TEMPLATE_FRAMES[st.template];
  const side = st.side ?? 1;
  const amp = st.amp ?? 1;
  const mix = (b: Frame, o?: Partial<Frame>): Frame => {
    const out = { ...b, ...o };
    for (const k of KEYS) out[k] *= amp;
    out.yaw *= side;
    out.roll *= side;
    return out;
  };
  return { back: mix(base.back, st.back), fwd: mix(base.fwd, st.fwd), tremble: st.tremble ?? base.tremble };
}

/**
 * The pose of one attack at one moment. `u` runs 0 to 1 inside the stage: through the wind-up (the sim's own progress), through the strike and
 * through the recovery. `from` says what a recovery starts from: the follow-through (the normal case) or the drawn-back wind-up (an attack cut short).
 * `t` only drives the shake.
 */
export function attackPose(attackId: string, stage: AttackStage, u: number, t = 0, from: 'hit' | 'wind' = 'hit'): AttackPose {
  const f = framesOf(attackId);
  const k = clamp01(u);
  let wind = 0;
  let hit = 0;
  if (stage === 'windup') wind = easeInOut(k);
  else if (stage === 'strike') {
    wind = 1 - easeOut(k);
    hit = easeOut(k);
  } else if (from === 'wind') wind = 1 - easeInOut(k);
  else hit = 1 - easeInOut(k);
  const out = { ...REST_FRAME } as Frame;
  for (const key of KEYS) out[key] = f.back[key] * wind + f.fwd[key] * hit;
  // a held breath: the drawn-back body shivers harder as the hit nears
  const shake = stage === 'windup' ? k * k * f.tremble * Math.sin(t * 61) : 0;
  out.y += shake;
  out.z += shake * 0.5;
  return { ...out, energy: Math.max(wind, hit) };
}

/** What one attack looks like right now, as the tracker reports it. */
export interface AttackNow {
  id: string;
  stage: AttackStage;
  u: number;
  from: 'hit' | 'wind';
}

/** Turns the snapshot's attack fields into stages: the sim's progress through the wind-up, then a timed strike and recovery once the attack is gone. */
export class AttackTracker {
  private id: string | null = null;
  private lastProgress = 0;
  private lastPhase: string | null = null;
  private done: { id: string; since: number; from: 'hit' | 'wind' } | null = null;
  private clock = 0;

  update(attack: string | null, phase: string | null | undefined, progress: number | undefined, dt: number): AttackNow | null {
    this.clock += dt;
    if (attack) {
      if (this.done?.id !== attack || this.id !== attack) this.done = null;
      this.id = attack;
      this.lastPhase = phase ?? 'windup';
      this.lastProgress = progress ?? 0;
      if (this.lastPhase === 'active') return { id: attack, stage: 'strike', u: 1, from: 'hit' };
      return { id: attack, stage: 'windup', u: this.lastProgress, from: 'hit' };
    }
    if (this.id) {
      // the attack ended: it landed (progress near 1, or a charge that ran) or it was cut short
      const landed = this.lastPhase === 'active' || this.lastProgress > 0.85;
      this.done = { id: this.id, since: this.clock, from: landed ? 'hit' : 'wind' };
      this.id = null;
    }
    const d = this.done;
    if (!d) return null;
    const age = this.clock - d.since;
    const strike = d.from === 'hit' ? ATTACK_TIMING.strikeSeconds : 0;
    if (age < strike) return { id: d.id, stage: 'strike', u: age / strike, from: 'hit' };
    const r = (age - strike) / ATTACK_TIMING.recoverSeconds;
    if (r >= 1) {
      this.done = null;
      return null;
    }
    return { id: d.id, stage: 'recover', u: r, from: d.from };
  }
}
