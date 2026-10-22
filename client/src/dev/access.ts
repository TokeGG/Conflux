// Who gets the dev panel: the owner and devs. For now that means `?dev` in the address (remembered in this browser, so the panel is
// there next time without it; `?dev=0` forgets it) or the Developer tools box on the start page; later the server decides.
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
