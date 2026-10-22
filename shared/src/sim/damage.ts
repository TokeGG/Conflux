// The one place damage is worked out: swap bonus, element, rocked, guard, then the reaction the hit triggers.
import type { Element, ElementsCfg, StatusId } from '../types.ts';
import { defaultData } from '../files.ts';
import { triggerReaction } from './reactions.ts';
import { damageEnemy } from './skills.ts';
import { guardReduction } from './guard.ts';
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
export function dealDamage(sim: Sim, target: Combatant, base: number, element: Element | 'none', opts: DamageOpts = {}): number {
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
  if (element !== 'none' && target.def.weak.includes(element)) dmg *= m.weak;
  else if (element !== 'none' && target.def.resist.includes(element)) dmg *= m.resist;
  dmg *= mods.damageTakenMul;
  const guard = guardReduction(target, element, false);
  dmg *= guard.mul;
  const before = target.hp;
  damageEnemy(sim, target, dmg, opts.skillId ?? `element.${element}`, opts.point ?? target.pos);
  const dealt = before - target.hp;
  if (guard.stagger && target.guard && target.def.guard) {
    target.guard.on = false;
    target.guard.staggeredUntil = now + target.def.guard.staggerOnWeak;
    target.guard.until = target.guard.staggeredUntil; // it goes back up as soon as the stagger ends
    sim.emit('guard_broken', { enemyId: target.id, x: target.pos.x, y: target.pos.y, z: target.pos.z });
  }
  const leech = target.marks.leech;
  if (leech && dealt > 0 && now < leech.until) sim.player.hp = Math.min(sim.data.player.health, sim.player.hp + dealt * (leech.heal ?? 0));
  if (target.hp > 0) {
    if (element !== 'none') triggerReaction(sim, target, element, dealt, now);
    if (opts.applies) applyStatus(sim, target, opts.applies, now);
  }
  return dealt;
}
