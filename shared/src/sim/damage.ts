// The one place damage is worked out: swap bonus, element, rocked, guard, then the reaction the hit triggers.
import type { Element, ElementsCfg, StatusId } from '../types.ts';
import { defaultData } from '../files.ts';
import { triggerReaction } from './reactions.ts';
import { damageEnemy } from './skills.ts';
import { applyStatus, statusModifiers, type Combatant } from './statuses.ts';
import type { EnemyState } from './state.ts';
import type { Sim } from './sim.ts';

export interface DamageOpts {
  /** Damage multiplier from the swap-in bonus. */
  swapBonus?: number;
  /** The status this hit leaves behind (the caller has already decided it lands). */
  applies?: StatusId | null;
  /** Names the source in the hit event; the hit point is where the effect plays. */
  skillId?: string;
  point?: { x: number; y: number; z: number };
}

/** What an element is weak to and resists by the cycle, for enemies that do not list their own. */
export function defaultWeakResist(el: Element, cycle: ElementsCfg['cycle'] = defaultData().elements.cycle): { weak: Element[]; resist: Element[] } {
  return { weak: [...cycle[el].weak], resist: [...cycle[el].resist] };
}

const isEnemy = (c: Combatant): c is EnemyState => 'def' in c;

/** Deals damage and returns how much landed (never negative). */
export function dealDamage(sim: Sim, target: Combatant, base: number, element: Element, opts: DamageOpts = {}): number {
  const now = sim.time;
  const mods = statusModifiers(target, now, sim.data.statuses);
  if (!isEnemy(target)) {
    const before = target.hp;
    sim.hurtPlayer(Math.max(0, base) * mods.damageTakenMul);
    if (opts.applies) applyStatus(sim, target, opts.applies, now);
    return before - target.hp;
  }
  if (target.hp <= 0) return 0;
  const m = sim.data.elements.multipliers;
  let dmg = Math.max(0, base) * (opts.swapBonus ?? 1);
  if (target.def.weak.includes(element)) dmg *= m.weak;
  else if (target.def.resist.includes(element)) dmg *= m.resist;
  dmg *= mods.damageTakenMul;
  const g = target.def.guard;
  if (g && target.guard?.on && now >= target.guard.staggeredUntil) dmg *= 1 - g.reduction;
  const before = target.hp;
  damageEnemy(sim, target, dmg, opts.skillId ?? `element.${element}`, opts.point ?? target.pos);
  const dealt = before - target.hp;
  if (target.hp > 0) {
    triggerReaction(sim, target, element, dealt, now);
    if (opts.applies) applyStatus(sim, target, opts.applies, now);
  }
  return dealt;
}
