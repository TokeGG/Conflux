// Swapping elements, the bonus the next skill gets after a swap, and turning the buttons into casts.
import { ELEMENTS, BTN, type Input, type Slot } from '../types.ts';
import type { PlayerCfg } from '../types.ts';
import { resolveAim } from '../aim.ts';
import { statusModifiers } from './statuses.ts';
import { castSkill } from './skills.ts';
import { enemyHurtboxes, type PlayerState } from './state.ts';
import type { Sim } from './sim.ts';

/** Switches the held element. False when it is the same one, not a valid one, or the swap is still cooling down. */
export function trySwap(sim: Sim, p: PlayerState, to: number): boolean {
  const now = sim.time;
  if (!Number.isInteger(to) || to < 0 || to >= ELEMENTS.length || to === p.element || now < p.swapReadyAt) return false;
  const from = p.element;
  p.element = to;
  p.swapReadyAt = now + sim.data.player.swap.cooldown;
  p.swapBonusUntil = now + sim.data.player.swap.bonusWindow;
  if (p.castState) {
    // a cast that has not left the caster yet is cancelled and its cooldown given back
    if (!p.castState.fired) delete p.cooldowns[p.castState.skillId];
    p.castState = null;
  }
  sim.emit('swap', { from: ELEMENTS[from], to: ELEMENTS[to], x: p.pos.x, y: p.pos.y, z: p.pos.z });
  return true;
}

/** Claims the swap-in bonus if it is still open; it can only be claimed once per swap. */
export function consumeSwapBonus(p: PlayerState, now: number, cfg: PlayerCfg['swap']): { damageMul: number; guaranteeStatus: boolean } {
  if (now < p.swapBonusUntil) {
    p.swapBonusUntil = 0;
    return { damageMul: cfg.bonusDamage, guaranteeStatus: true };
  }
  return { damageMul: 1, guaranteeStatus: false };
}

/** The skill on the held element's slot, or an empty string when the slot has none. */
export function activeSkillFor(p: PlayerState, slot: Slot): string {
  return p.loadout[ELEMENTS[p.element]][slot];
}

/** Applies this tick's swap request and button presses. A dodge in progress blocks casting. */
export function handleSwapAndCast(sim: Sim, p: PlayerState, input: Input): void {
  if (input.swapTo >= 0) trySwap(sim, p, input.swapTo);
  if (sim.time < p.dodgeUntil || !statusModifiers(p, sim.time, sim.data.statuses).canAct) return;
  const slot: Slot | null = input.buttons & BTN.LMB ? 'basic' : input.buttons & BTN.RMB ? 'secondary' : input.buttons & BTN.UTIL ? 'utility' : null;
  if (!slot) return;
  const id = activeSkillFor(p, slot);
  if (!id) return;
  const boxes = sim.enemies.flatMap((e) => enemyHurtboxes(e));
  const aim = resolveAim(sim.world, boxes, input.camOrigin, input.aimYaw, input.aimPitch, sim.data.player.maxAimRange);
  castSkill(sim, p, id, aim.point);
}
