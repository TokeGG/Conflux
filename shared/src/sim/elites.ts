// Elite modifiers: an extra twist on one enemy of a room. Each one changes a number on the enemy or adds a behaviour that runs here.
import { dealDamage } from './damage.ts';
import type { EnemyState, Zone } from './state.ts';
import type { Sim } from './sim.ts';

const TICK = 0.5;

/** Gives an enemy an elite modifier. The enemy gets its own copy of its definition, so the shared data is never changed. */
export function applyElite(sim: Sim, e: EnemyState, id: string): void {
  const mod = sim.data.elites[id];
  if (!mod) throw new Error(`unknown elite modifier ${id}`);
  e.elite = id;
  if (id === 'haste') {
    e.def = { ...e.def, speed: e.def.speed * mod.params.speedMul };
  } else if (id === 'extra_guard') {
    const base = e.def.guard ?? { reduction: 0, onFor: 0, offFor: mod.params.offFor, staggerOnWeak: mod.params.staggerOnWeak };
    e.def = {
      ...e.def,
      guard: { reduction: Math.max(base.reduction, mod.params.reduction), onFor: Math.max(base.onFor, mod.params.onFor), offFor: Math.min(base.offFor, mod.params.offFor), staggerOnWeak: base.staggerOnWeak || mod.params.staggerOnWeak },
    };
    e.guard ??= { on: false, until: 0, staggeredUntil: 0 };
  }
}

/** The behaviours that run every tick: the fire aura burns the player nearby, the burning trail drops fire patches as it moves. */
export function stepElites(sim: Sim): void {
  const now = sim.time;
  for (const e of sim.enemies) {
    if (!e.elite || e.hp <= 0) continue;
    const mod = sim.data.elites[e.elite];
    if (!mod) continue;
    if (e.elite === 'fire_aura') {
      if (now < (e.cooldowns['elite.tick'] ?? 0)) continue;
      e.cooldowns['elite.tick'] = now + TICK;
      const p = sim.player;
      if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) <= mod.params.radius) dealDamage(sim, p, mod.params.dps * TICK * e.damageMul, 'none', { applies: 'burning' });
    } else if (e.elite === 'burning_trail') {
      if (now < (e.cooldowns['elite.tick'] ?? 0)) continue;
      e.cooldowns['elite.tick'] = now + mod.params.interval;
      const z: Zone = {
        id: sim.allocId(),
        kind: 'burning_trail',
        pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
        radius: mod.params.radius,
        until: now + mod.params.seconds,
        ownerId: e.id,
        skillId: 'elite.burning_trail',
        yaw: 0,
        width: 0,
        height: 0,
        damage: mod.params.damage,
        tick: TICK,
        nextTick: now,
        effects: { burn: true },
      };
      sim.zones.push(z);
    }
  }
}
