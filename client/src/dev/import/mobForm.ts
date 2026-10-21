// Starting points for a custom mob: the enemy entry made from what the model contains, and the form helpers that edit it.
import { defaultWeakResist, slugId, type Element, type EnemyDef } from '@conflux/shared';
import type { ModelReport } from './inspect.ts';

/** Maps a model's own clip names to the roles the game uses, by looking for the usual words in their names. */
export function matchClips(names: string[]): Record<string, string | string[]> {
  const find = (re: RegExp) => names.filter((n) => re.test(n));
  const out: Record<string, string | string[]> = {};
  const idle = find(/idle/i)[0];
  const walk = find(/walk/i)[0] ?? find(/run/i)[0];
  const attack = find(/attack|strike|slash|punch|swing|smash/i);
  const guard = find(/guard|block|defen[cs]e/i);
  const hit = find(/hit|react|hurt/i).filter((n) => !attack.includes(n))[0];
  const death = find(/death|die/i)[0];
  if (idle) out.idle = idle;
  if (walk) out.walk = walk;
  if (attack.length) out.attack = attack;
  if (guard.length) out.guard = guard;
  if (hit) out.hit = hit;
  if (death) out.death = death;
  return out;
}

/** A first enemy entry for an uploaded model: a capsule fitted to its size, its own clips if it has some, a hop if it has none. */
export function defaultEnemyFrom(report: ModelReport, name: string): EnemyDef {
  const slug = slugId(name) || 'mob';
  const r = Math.max(0.1, Math.min((Math.max(report.size.x, report.size.z) / 2) * 0.85, report.size.y * 0.4));
  const clips = report.clips.map((c) => c.name);
  const matched = matchClips(clips);
  return {
    id: `enemy.custom.${slug}`,
    name: name.trim() || 'Custom mob',
    element: 'none',
    weak: [],
    resist: [],
    immune: [],
    model: `model.custom.${slug}`,
    scale: 1,
    rig: clips.length ? { type: 'own', clips: matched } : { type: 'procedural', preset: 'hop' },
    hp: 100,
    speed: 3,
    cost: 2,
    hurtboxes: [{ a: [0, r, 0], b: [0, Math.max(r, report.size.y - r), 0], r }],
    ai: 'rusher',
    attacks: ['atk.swipe_basic'],
  };
}

/** Sets the element and fills weak and resist from the cycle (they can still be edited afterwards). */
export function applyElement(def: EnemyDef, element: Element | 'none'): EnemyDef {
  const wr = element === 'none' ? { weak: [], resist: [] } : defaultWeakResist(element);
  return { ...def, element, ...wr };
}
