// The best result of each daily run, kept in this browser: how many rooms were cleared before the run ended.
const key = (day: number) => `conflux.daily.${day}`;

export function loadDailyBest(storage: { getItem(k: string): string | null } | null, day: number): number {
  try {
    const n = Number(storage?.getItem(key(day)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Records a result if it beats the day's best, and returns the best. */
export function saveDailyBest(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null, day: number, rooms: number): number {
  const best = Math.max(loadDailyBest(storage, day), Math.floor(rooms));
  try {
    storage?.setItem(key(day), String(best));
  } catch {
    /* blocked storage: the best lasts for this visit only */
  }
  return best;
}

export const dailyBestLine = (best: number): string => (best > 0 ? `Your best today: ${best} ${best === 1 ? 'room' : 'rooms'}` : 'Not yet played today');
