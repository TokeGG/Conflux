// Who gets the dev panel: the owner and devs. For now that means `?dev` in the address or a saved flag; later the server decides.
export function devEnabled(url: URL, storage: { getItem(key: string): string | null } | null): boolean {
  if (url.searchParams.has('dev')) return true;
  try {
    return storage?.getItem('confluxDev') === '1';
  } catch {
    return false;
  }
}
