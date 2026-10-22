// Souls: what a dying enemy leaves behind and how the player picks them up. A soul is a pickup on the floor; walking within the
// pickup radius takes it, and when the room is cleared every one left flies to the player so none is lost.
import type { Vec3 } from '../math.ts';
import type { Sim } from './sim.ts';
import type { EnemyState } from './state.ts';

export interface Pickup {
  id: number;
  pos: Vec3;
  /** How many souls it is worth. */
  value: number;
}

/** What an enemy is worth: its own number (the encounter cost x 1.5 when it has none), more for an elite, nothing for something summoned. */
export function soulsFor(sim: Sim, e: EnemyState): number {
  if (e.summoned) return 0;
  const base = e.def.souls ?? Math.round(e.def.cost * 1.5);
  return Math.round(base * (e.elite ? sim.data.rewards.economy.eliteSoulsMul : 1));
}

/** Leaves the dead enemy's souls on the floor where it fell. */
export function dropSouls(sim: Sim, e: EnemyState): void {
  const value = soulsFor(sim, e);
  if (value <= 0) return;
  const pos = { x: e.pos.x, y: sim.world.groundAt(e.pos.x, e.pos.z), z: e.pos.z };
  sim.pickups.push({ id: sim.allocId(), pos, value });
  sim.emit('soul_dropped', { value, x: pos.x, y: pos.y, z: pos.z });
}

/** Takes every soul in reach (all of them once the room is cleared). */
export function stepPickups(sim: Sim): void {
  if (sim.pickups.length === 0 || sim.player.hp <= 0) return;
  const reach = sim.data.rewards.economy.pickupRadius;
  const p = sim.player.pos;
  const keep: Pickup[] = [];
  for (const k of sim.pickups) {
    if (sim.roomCleared || Math.hypot(k.pos.x - p.x, k.pos.z - p.z) <= reach) sim.emit('soul_collected', { value: k.value, x: k.pos.x, y: k.pos.y, z: k.pos.z });
    else keep.push(k);
  }
  sim.pickups = keep;
}
