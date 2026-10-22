// A boss's own glow: which aura it has and how it pulses. Pure, so it is tested. The numbers are exported for the dev panel.
import { auraError, type AuraDef, type EnemyDef } from '@conflux/shared';

/** The aura of a boss whose data names none. */
export const DEFAULT_AURA: AuraDef = { color: '#8a3a1a', intensity: 4, radius: 7 };

export const AURA_PULSE = {
  /** Pulses per second at full health and at rest. */
  baseHz: 0.35,
  /** Extra pulses per second at no health. */
  lowHealthHz: 0.9,
  /** Extra pulses per second at the end of an attack's wind-up. */
  windupHz: 0.7,
  /** How much of the glow the pulse swings (0 flat, 1 from dark to full). */
  depth: 0.35,
  /** Extra brightness at the hit moment of an attack. */
  attackBoost: 0.3,
  /** Share of the aura's light that reaches the materials as a rim glow, and the ring's opacity at full. */
  glowShare: 0.1,
  ringOpacity: 0.34,
};

/** The aura a def has: its own, or the default for any boss, or none for a mob. A broken one falls back to the default. */
export function auraOf(def: Pick<EnemyDef, 'id' | 'aura'>): AuraDef | null {
  if (def.aura) return auraError(def.aura) ? DEFAULT_AURA : def.aura;
  return def.id.startsWith('boss.') ? DEFAULT_AURA : null;
}

/** Pulses per second: quicker as health drops (hp 0 to 1) and through an attack's wind-up (0 to 1). */
export function pulseHz(hpFrac: number, windup: number): number {
  const h = Math.max(0, Math.min(1, Number.isFinite(hpFrac) ? hpFrac : 1));
  const w = Math.max(0, Math.min(1, Number.isFinite(windup) ? windup : 0));
  return AURA_PULSE.baseHz + AURA_PULSE.lowHealthHz * (1 - h) + AURA_PULSE.windupHz * w;
}

/** The glow at a point in the pulse (`phase` in turns): between 1 - depth and 1, plus a boost when `energy` (0 to 1) is high. */
export function pulseLevel(phase: number, energy = 0): number {
  const wave = 0.5 + 0.5 * Math.sin((Number.isFinite(phase) ? phase : 0) * Math.PI * 2);
  const e = Math.max(0, Math.min(1, Number.isFinite(energy) ? energy : 0));
  return 1 - AURA_PULSE.depth + AURA_PULSE.depth * wave + AURA_PULSE.attackBoost * e;
}
