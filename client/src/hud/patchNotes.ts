// The patch notes list the main menu shows. Owner and dev tools are never listed there, so notes about them are left out.
export interface PatchEntry {
  version: string;
  date: string;
  /** When it went out, in UTC; players see it in their own time zone. */
  at: string;
  notes: string[];
}

const HIDDEN = /\b(dev panel|dev tools?|owner|developer)\b/i;

export function visiblePatches(list: PatchEntry[]): PatchEntry[] {
  return list.map((p) => ({ ...p, notes: p.notes.filter((n) => !HIDDEN.test(n)) })).filter((p) => p.notes.length > 0);
}

/** "21 Oct 2026, 22:00" in the player's own time zone and language. */
export function patchTime(at: string, locale?: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
