// The Element reactions guide, kept apart from the DOM so it can be tested: the 45 pairs as rows, the 10 x 10 matrix,
// filtering by element or search text, and which reactions the player's held elements already make.
import type { GameData } from '@conflux/shared';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "rain_cloud" -> "Rain Cloud": the one place a reaction's name is made (the reward tooltip uses it too). */
export const reactionName = (effect: string): string => effect.split('_').map(cap).join(' ');

export interface GuideRow {
  id: string;
  a: string;
  b: string;
  name: string;
  text: string;
  /** The other element of the pair, seen from `el`. */
  partner(el: string): string;
}

export function guideRows(data: GameData): GuideRow[] {
  const rank = (e: string) => (data.elements.order as string[]).indexOf(e);
  return data.reactions
    .map((r): GuideRow => {
      const [a, b] = [...r.pair].sort((x, y) => rank(x) - rank(y));
      return { id: r.id, a, b, name: reactionName(r.effect), text: r.text ?? '', partner: (el) => (el === a ? b : a) };
    })
    .sort((x, y) => rank(x.a) - rank(y.a) || rank(x.b) - rank(y.b));
}

/** The grid: `matrix[i][j]` is the reaction of element i with element j (same both ways); the diagonal is empty. */
export function guideMatrix(data: GameData): (GuideRow | null)[][] {
  const order = data.elements.order;
  const rows = guideRows(data);
  return order.map((x) => order.map((y) => (x === y ? null : rows.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x)) ?? null)));
}

export function filterGuide(rows: GuideRow[], f: { element?: string | null; query?: string }): GuideRow[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.element && r.a !== f.element && r.b !== f.element) return false;
    return !q || `${r.name} ${r.text} ${r.a} ${r.b}`.toLowerCase().includes(q);
  });
}

/** Ids of the reactions whose two elements you both hold. */
export function heldPairs(rows: GuideRow[], held: readonly string[]): Set<string> {
  return new Set(rows.filter((r) => held.includes(r.a) && held.includes(r.b)).map((r) => r.id));
}
