// The rows of the Animations page and the Skill animation page: which data path each control edits, its label, and the value now and in the file. Pure.
import { CAST_ARCHETYPES, resolvePath, type DataPatch, type GameData } from '@conflux/shared';
import { LOCO_STATES } from '../anim/locomotion.ts';

export interface ClipRow {
  path: string;
  label: string;
  /** The value in use (a staged edit counts). */
  value: string;
  /** The value in the data files. */
  fileValue: string;
  /** The value in the run, without staged edits. */
  live: string;
  changed: boolean;
}

const text = (data: GameData, path: string): string => {
  const v = resolvePath(data, path)?.value;
  return typeof v === 'string' ? v : '';
};

const readable = (s: string): string => s.replace(/_/g, ' ');

function clipRow(path: string, label: string, live: GameData, base: GameData, staged: readonly DataPatch[]): ClipRow {
  const stagedValue = staged.find((p) => p.path === path)?.value;
  const now = typeof stagedValue === 'string' ? stagedValue : text(live, path);
  const fileValue = text(base, path);
  return { path, label, value: now, fileValue, live: text(live, path), changed: now !== fileValue };
}

/** One row per locomotion state of a player rig (idle, walk, run, jump, dodge...). */
export function stateRows(live: GameData, base: GameData, rig: string, staged: readonly DataPatch[] = []): ClipRow[] {
  return LOCO_STATES.filter((s) => live.animation.rigs[rig]?.states[s] !== undefined).map((s) => clipRow(`animation.rigs.${rig}.states.${s}`, readable(s), live, base, staged));
}

/** One row per cast archetype of a player rig. */
export function archetypeRows(live: GameData, base: GameData, rig: string, staged: readonly DataPatch[] = []): ClipRow[] {
  return CAST_ARCHETYPES.filter((a) => live.animation.rigs[rig]?.cast[a] !== undefined).map((a) => clipRow(`animation.rigs.${rig}.cast.${a}`, `cast: ${a}`, live, base, staged));
}

/** One row per clip a mob plays (idle, walk, attack, guard...); a state with several clips gets one row per clip. */
export function mobClipRows(live: GameData, base: GameData, enemyId: string, staged: readonly DataPatch[] = []): ClipRow[] {
  const clips = live.enemies[enemyId]?.rig.clips;
  if (!clips) return [];
  const rows: ClipRow[] = [];
  for (const [key, v] of Object.entries(clips)) {
    if (Array.isArray(v)) v.forEach((_, i) => rows.push(clipRow(`enemies.${enemyId}.rig.clips.${key}.${i}`, `${key} ${i + 1}`, live, base, staged)));
    else rows.push(clipRow(`enemies.${enemyId}.rig.clips.${key}`, key, live, base, staged));
  }
  return rows;
}

/** The choices for a clip drop-down: every clip the rig has, and the current value first if it is not one of them (so a typo or a missing clip shows). */
export function clipChoices(available: readonly string[], current: string): { value: string; label: string }[] {
  const out = available.map((c) => ({ value: c, label: c }));
  if (current && !available.includes(current)) out.unshift({ value: current, label: `${current} (not found)` });
  return out;
}

/** The enemies that name clips of their own (a rigged mob with a clips table). */
export function mobsWithClips(data: GameData): string[] {
  return Object.values(data.enemies)
    .filter((e) => e.rig.type !== 'procedural' && e.rig.clips && Object.keys(e.rig.clips).length > 0)
    .map((e) => e.id)
    .sort();
}

export interface CastRow {
  /** A patch path. */
  path: string;
  label: string;
  kind: 'number' | 'clip' | 'archetype';
  value: string | number;
  fileValue: string | number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
  changed: boolean;
}

const stagedOr = (staged: readonly DataPatch[], path: string, live: string | number): string | number => {
  const v = staged.find((p) => p.path === path)?.value;
  return typeof v === 'string' || typeof v === 'number' ? v : live;
};

/** The cast controls of one skill: clip, archetype, windup, fires-at, move speed while casting, upper-body blend. */
export function castRows(live: GameData, base: GameData, skillId: string, staged: readonly DataPatch[] = []): CastRow[] {
  const nowCast = live.skills[skillId]?.cast;
  const fileCast = base.skills[skillId]?.cast;
  if (!nowCast || !fileCast) return [];
  const mk = (key: 'clip' | 'archetype' | 'windup' | 'move' | 'blend' | 'fireAt', label: string, kind: CastRow['kind'], fallback: string | number, extra: Partial<CastRow> = {}): CastRow => {
    const path = `skills.${skillId}.cast.${key}`;
    const liveValue = (nowCast[key] as string | number | undefined) ?? fallback;
    const value = stagedOr(staged, path, liveValue);
    const fileValue = (fileCast[key] as string | number | undefined) ?? fallback;
    return { path, label, kind, value, fileValue, changed: value !== fileValue, ...extra };
  };
  return [
    mk('clip', 'Cast clip', 'clip', ''),
    mk('archetype', 'Cast archetype', 'archetype', 'throw', { hint: 'Picks the clip when the skill names none, and groups skills that cast alike.' }),
    mk('windup', 'Windup', 'number', 0, { min: 0, max: 5, step: 0.01, unit: 's', hint: 'Seconds from pressing the button to the skill leaving the hand.' }),
    mk('fireAt', 'Fires at', 'number', 0, { min: 0, max: 1, step: 0.01, unit: 'of the clip', hint: 'The point in the clip where the hand lets go. The clip is sped up or slowed so that point lands on the windup. 0 plays it at its own speed.' }),
    mk('move', 'Move speed while casting', 'number', 1, { min: 0, max: 1, step: 0.05, unit: '×' }),
    mk('blend', 'Upper-body blend', 'number', 1, { min: 0, max: 1, step: 0.05, unit: '0 to 1', hint: '1: the arms and chest take the cast clip fully; 0: the legs\' clip all over.' }),
  ];
}

/** The tuned patches (staged or in force) under one path prefix, one per path, as JSON text to paste back. */
export function patchesText(prefix: string, ...lists: (readonly DataPatch[])[]): string {
  const byPath = new Map<string, DataPatch>();
  for (const list of lists) for (const p of list) if (p.path === prefix || p.path.startsWith(`${prefix}.`)) byPath.set(p.path, p);
  return JSON.stringify([...byPath.values()], null, 2);
}
