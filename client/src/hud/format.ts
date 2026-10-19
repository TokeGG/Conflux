// Text and numbers for the HUD, kept apart from the drawing so they can be tested.

/** "" when ready, one decimal under 10 s, whole seconds from 10. A hair above zero shows 0.1 rather than 0.0. */
export function formatCooldown(remaining: number): string {
  if (!(remaining > 0)) return '';
  if (remaining >= 10) return String(Math.round(remaining));
  return Math.max(0.1, Math.round(remaining * 10) / 10).toFixed(1);
}

/** How much of a status is left, 0 to 1. */
export function statusRing(remaining: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}

/** "fire.flame_cone" becomes "Flame Cone". */
export function skillLabel(id: string): string {
  const name = id.split('.').slice(1).join(' ');
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
