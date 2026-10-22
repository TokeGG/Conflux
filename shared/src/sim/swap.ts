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
  if (!Number.isInteger(to) || to < 0 || to >= ELEMENTS.length || to === p.element || now < p.swapReadyAt || !p.equipped.includes(ELEMENTS[to])) return false;
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

/**
 * Shift: the one dash. It is the held element's dash skill when its utility is a dash (with that skill's cooldown), and for an element
 * whose utility is something else (a shield) the same dash without a skill, carried along at the dash speed with its own cooldown.
 * Either way it goes the way the movement keys point (straight ahead when none is held) and the player is invulnerable at the start.
 */
function startDash(sim: Sim, p: PlayerState, input: Input): void {
  const now = sim.time;
  if (p.dash && now < p.dash.until) return;
  if (!statusModifiers(p, now, sim.data.statuses).canAct) return;
  const cfg = sim.data.player;
  const sin = Math.sin(input.aimYaw);
  const cos = Math.cos(input.aimYaw);
  const mx = Math.max(-1, Math.min(1, input.moveX));
  const mz = Math.max(-1, Math.min(1, input.moveZ));
  const moving = Math.hypot(mx, mz) > 0.01;
  // right = (cos, -sin), forward = (sin, cos)
  const heading = moving ? Math.atan2(mx * cos + mz * sin, -mx * sin + mz * cos) : p.facing;
  const dir = { x: Math.sin(heading), y: 0, z: Math.cos(heading) };
  const id = activeSkillFor(p, 'utility');
  const skill = id ? sim.skill(id) : undefined;
  if (skill?.shape.type === 'dash') {
    const reach = skill.shape.distance ?? 5;
    castSkill(sim, p, id, { x: p.pos.x + dir.x * reach, y: p.pos.y + 1.4, z: p.pos.z + dir.z * reach });
    return;
  }
  if (now < p.dodgeReadyAt) return;
  const travel = cfg.dodge.speed * cfg.dodge.duration;
  const hit = sim.world.sweepSphere({ x: p.pos.x, y: p.pos.y + 0.9, z: p.pos.z }, { x: p.pos.x + dir.x * travel, y: p.pos.y + 0.9, z: p.pos.z + dir.z * travel }, cfg.radius);
  const go = hit === null ? travel : Math.max(0, hit);
  const dur = Math.max(0.1, go / cfg.dashSpeed);
  p.castState = null;
  p.dash = { until: now + dur, vx: (dir.x * go) / dur, vz: (dir.z * go) / dur };
  p.dodgeUntil = now + dur;
  p.dodgeReadyAt = now + cfg.dodge.cooldown;
  p.invulnUntil = Math.max(p.invulnUntil, now + cfg.dodge.invulnerable);
  p.facing = heading;
  sim.emit('dodge', { yaw: heading, x: p.pos.x, y: p.pos.y, z: p.pos.z });
}

/** Applies this tick's swap request and button presses. A dodge in progress blocks casting. */
export function handleSwapAndCast(sim: Sim, p: PlayerState, input: Input): void {
  if (input.swapTo >= 0 && input.swapTo < p.equipped.length) trySwap(sim, p, ELEMENTS.indexOf(p.equipped[input.swapTo]));
  if (input.buttons & BTN.DODGE) startDash(sim, p, input);
  if (sim.time < p.dodgeUntil || !statusModifiers(p, sim.time, sim.data.statuses).canAct) return;
  const slot: Slot | null = input.buttons & BTN.LMB ? 'basic' : input.buttons & BTN.RMB ? 'secondary' : input.buttons & BTN.UTIL ? 'utility' : null;
  if (!slot) return;
  const id = activeSkillFor(p, slot);
  if (!id) return;
  const boxes = sim.enemies.flatMap((e) => enemyHurtboxes(e));
  const aim = resolveAim(sim.world, boxes, input.camOrigin, input.aimYaw, input.aimPitch, sim.data.player.maxAimRange);
  castSkill(sim, p, id, aim.point);
}
