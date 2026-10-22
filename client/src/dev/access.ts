// Local development only: `?dev` in the address (remembered in this browser; `?dev=0` forgets it) opens the dev panel when running under Vite.
// A production build ignores it: the panel there comes from an account with dev access (client/src/account/logic.ts).
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

const KEY = 'confluxDev';

/** Saves or clears the dev flag; blocked storage is ignored (the flag then lasts for this visit only). */
export function setDevFlag(storage: FlagStorage | null, on: boolean): void {
  try {
    if (on) storage?.setItem?.(KEY, '1');
    else storage?.removeItem?.(KEY);
  } catch {
    /* blocked storage */
  }
}

export function devEnabled(url: URL, storage: FlagStorage | null): boolean {
  if (url.searchParams.has('dev')) {
    const on = url.searchParams.get('dev') !== '0';
    setDevFlag(storage, on);
    return on;
  }
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
