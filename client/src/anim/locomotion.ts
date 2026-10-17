// Which legs clip to play: direction relative to where the character faces, and how fast it moves.
import type { Vec3 } from '@conflux/shared';
import castMap from './castMap.json' with { type: 'json' };

export const LOCO_STATES = ['idle', 'walk_forward', 'walk_back', 'walk_left', 'walk_right', 'run_forward', 'run_back', 'run_left', 'run_right', 'sprint_forward', 'jump', 'dodge_forward', 'dodge_back', 'dodge_left', 'dodge_right'] as const;
export type LocoState = (typeof LOCO_STATES)[number];

const STILL = 0.3;
const RUN_AT = 3.5;
const SPRINT_AT = 7.5;
const JUMP_VY = 1.5;

/** Idle, walk, run, sprint, jump or dodge, with the direction taken from the velocity against the facing (yaw 0 faces +Z, +X is right). */
export function pickLocomotion(velocity: Vec3, facing: number, speed: number, dodging = false): LocoState {
  if (!dodging && Math.abs(velocity.y) > JUMP_VY) return 'jump';
  if (!dodging && speed < STILL) return 'idle';
  let a = Math.atan2(velocity.x, velocity.z) - facing;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  const dir = Math.abs(a) <= Math.PI / 4 ? 'forward' : Math.abs(a) >= (3 * Math.PI) / 4 ? 'back' : a > 0 ? 'right' : 'left';
  if (dodging) return `dodge_${dir}` as LocoState;
  if (dir === 'forward' && speed >= SPRINT_AT) return 'sprint_forward';
  return `${speed >= RUN_AT ? 'run' : 'walk'}_${dir}` as LocoState;
}

/** The baked clip behind a locomotion state. */
export function locoClipName(s: LocoState): string {
  return s.startsWith('dodge_') ? `bow_standing_${s === 'dodge_back' ? 'dodge_backward' : s}` : `loco_standing_${s}`;
}

/** The upper-body clip for a cast archetype (a skill's own clip name overrides this). */
export function castClipFor(archetype: string): string {
  const clip = (castMap as Record<string, string>)[archetype];
  if (!clip) throw new Error(`no cast clip for archetype "${archetype}"`);
  return clip;
}
