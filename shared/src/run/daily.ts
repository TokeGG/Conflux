// The daily run: everyone on the same UTC day gets the same seed (so the same rooms) and the same three elements, locked for the whole run.
import { makeStreams } from '../rng.ts';
import { ELEMENTS, type Element, type GameData } from '../types.ts';

export interface Daily {
  /** The UTC day as a number, e.g. 20261023. */
  day: number;
  /** The run seed (the day itself, so it is easy to read and share). */
  seed: number;
  /** The three elements held for the whole run. */
  elements: Element[];
}

/** The UTC date as a number: 2026-10-23 is 20261023. */
export const dayKey = (d: Date): number => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

/** The day's run: three different elements that have a basic skill, drawn from the day's own stream. */
export function dailyFor(day: number, data: GameData): Daily {
  const rng = makeStreams(day).map.fork('daily');
  const bench = ELEMENTS.filter((el) => Object.values(data.skills).some((s) => s.element === el && s.slot === 'basic'));
  const elements: Element[] = [];
  while (elements.length < 3 && bench.length > 0) elements.push(...bench.splice(rng.int(bench.length), 1));
  return { day, seed: day, elements };
}
