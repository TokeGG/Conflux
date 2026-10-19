// Which effect a sim event plays, from fxmap.json. A skill's own hit effect lives in its data, so hits are looked up there.
import type { SimEvent, SkillDef } from '@conflux/shared';
import fxmap from './fxmap.json' with { type: 'json' };

export interface FxPlacement {
  id: string;
  /** 'pos': where the event says (x, y, z or pos); 'target': on the entity it names (the player, or the enemy with that id). */
  at: 'pos' | 'target';
}

type Entry = null | { id: string; at: 'pos' | 'target' } | { by: 'skill'; slot: string; at: 'pos' | 'target' } | { by: 'reaction' | 'to'; ids: Record<string, string>; at: 'pos' | 'target' };

export function fxForEvent(e: SimEvent, skills: Record<string, Pick<SkillDef, 'fx'>> = {}): FxPlacement | null {
  const entry = (fxmap.events as Record<string, Entry>)[e.type];
  if (!entry) return null;
  if ('id' in entry) return { id: entry.id, at: entry.at };
  if (entry.by === 'skill') {
    const id = skills[String(e.skillId)]?.fx?.[entry.slot];
    return id ? { id, at: entry.at } : null;
  }
  const id = entry.ids[String(entry.by === 'reaction' ? e.id : e.to)];
  return id ? { id, at: entry.at } : null;
}
