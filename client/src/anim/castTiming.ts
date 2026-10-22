// Cast timing: which clip a skill plays, how fast, and (for the dev preview) where in a looping cast the character is. Pure.
import type { SkillDef } from '@conflux/shared';
import { castClipFor } from './locomotion.ts';

const MIN_SPEED = 0.25;
const MAX_SPEED = 8;

/** The speed (1 = the clip's own) that puts the point `fireAt` (0 to 1 of the clip) on the skill's windup. Off (1) when fireAt is 0 or missing. */
export function castSpeed(fireAt: number | undefined, clipSeconds: number, windup: number): number {
  if (!fireAt || fireAt <= 0 || clipSeconds <= 0 || windup <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, (fireAt * clipSeconds) / windup));
}

/** The skill's own clip when the rig has it, otherwise the clip for its archetype (from the rig's mapping in the data). */
export function castClipChoice(cast: Pick<SkillDef['cast'], 'archetype' | 'clip'>, has: (clip: string) => boolean, archetypeClips?: Record<string, string>): string {
  return cast.clip && has(cast.clip) ? cast.clip : castClipFor(cast.archetype, archetypeClips);
}

export interface PreviewIn {
  /** Seconds from the cast starting to the skill firing (the sim's windup). */
  windup: number;
  /** Length of the cast clip, in its own seconds. */
  clipSeconds: number;
  /** castSpeed() for this skill. */
  speed: number;
  /** Seconds to stand still between one cast and the next. */
  rest: number;
}

export interface PreviewState {
  /** Where in the cast clip to be (clip seconds). */
  clipTime: number;
  /** The upper body is in the cast clip. */
  casting: boolean;
  /** The skill has left the hand (time is at or past the windup). */
  fired: boolean;
  /** Seconds of one whole loop. */
  period: number;
}

/** Where a looping preview of a skill is at time t: wind up, fire at the windup, finish the clip, rest, and go round again. */
export function previewAt(t: number, o: PreviewIn): PreviewState {
  const castSeconds = o.clipSeconds / Math.max(1e-6, o.speed);
  const period = Math.max(o.windup, castSeconds) + Math.max(0, o.rest);
  const u = period > 0 ? ((t % period) + period) % period : 0;
  return { clipTime: Math.min(o.clipSeconds, u * o.speed), casting: u < castSeconds, fired: u >= o.windup, period };
}
