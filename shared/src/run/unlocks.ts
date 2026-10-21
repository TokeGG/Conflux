// What the player has earned across runs: counters fed by sim events, the achievements they reach, and the content those unlock.
import type { GameData, SimEvent } from '../types.ts';
import type { RunState } from './run.ts';

export interface UnlockLedger {
  counters: Record<string, number>;
  unlocked: string[];
}

export interface UnlockedPool {
  skills: Set<string>;
  augments: Set<string>;
}

export interface LedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LEDGER_KEY = 'conflux.ledger';

export const emptyLedger = (): UnlockLedger => ({ counters: {}, unlocked: [] });

function award(l: UnlockLedger, data: GameData): UnlockLedger {
  const unlocked = Object.keys(data.unlocks).filter((id) => l.unlocked.includes(id) || (l.counters[data.unlocks[id].counter] ?? 0) >= data.unlocks[id].atLeast);
  return unlocked.length === l.unlocked.length ? l : { ...l, unlocked };
}

const bump = (l: UnlockLedger, key: string): UnlockLedger => ({ ...l, counters: { ...l.counters, [key]: (l.counters[key] ?? 0) + 1 } });

/** Counts one sim event. A run played with tuned numbers changes nothing. */
export function recordEvent(l: UnlockLedger, e: SimEvent, run: RunState): UnlockLedger {
  if (run.tuned) return l;
  let key: string | null = null;
  if (e.type === 'reaction' && typeof e.effect === 'string') key = `reaction.${e.effect}`;
  else if (e.type === 'enemy_died' && typeof e.defId === 'string') key = `kill.${e.defId}`;
  else if (e.type === 'room_cleared') key = 'rooms.cleared';
  return key ? award(bump(l, key), run.data) : l;
}

/** Counts a finished run (a win or a defeat). */
export function recordRunEnd(l: UnlockLedger, run: RunState): UnlockLedger {
  if (run.tuned || run.status === 'running') return l;
  let out = bump(l, 'runs');
  if (run.status === 'victory') out = bump(out, 'victory');
  return award(out, run.data);
}

/** The skills and augments the player may find: everything except content whose achievement is not earned yet. */
export function unlockedPool(l: UnlockLedger, data: GameData): UnlockedPool {
  const skills = new Set(Object.keys(data.skills));
  const augments = new Set(Object.keys(data.augments));
  for (const [id, a] of Object.entries(data.unlocks)) {
    if (l.unlocked.includes(id)) continue;
    for (const s of a.unlocks.skills ?? []) skills.delete(s);
    for (const x of a.unlocks.augments ?? []) augments.delete(x);
  }
  return { skills, augments };
}

/** Achievements earned going from `before` to `after`. */
export const newlyUnlocked = (before: UnlockLedger, after: UnlockLedger): string[] => after.unlocked.filter((id) => !before.unlocked.includes(id));

const valid = (v: any): v is UnlockLedger =>
  v && typeof v === 'object' && v.counters && typeof v.counters === 'object' && !Array.isArray(v.counters) && Object.values(v.counters).every((n) => typeof n === 'number') && Array.isArray(v.unlocked) && v.unlocked.every((s: unknown) => typeof s === 'string');

/** Reads the ledger; anything missing, unreadable or malformed gives an empty one. */
export function loadLedger(storage: LedgerStorage | null): UnlockLedger {
  try {
    const raw = storage?.getItem(LEDGER_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw);
    return valid(parsed) ? { counters: { ...parsed.counters }, unlocked: [...parsed.unlocked] } : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

/** Saves the ledger; when storage is missing or refuses, the ledger simply stays in memory. */
export function saveLedger(storage: LedgerStorage | null, l: UnlockLedger): void {
  try {
    storage?.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* in-memory only */
  }
}
