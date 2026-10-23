// How a debuffed mob looks on its own body: a colour its materials are pulled toward and a glow that pulses, per status.
// Pure maths (no Three.js), so the numbers can be tested and tuned; EnemyView lays the result on its materials every frame.

export type RGB = [number, number, number];

export interface StatusIn {
  id: string;
  remaining: number;
  stacks?: number;
}

export interface StatusLook {
  /** The colour the model's own colours are pulled toward. */
  colorTo: RGB;
  /** How far toward it, 0 (the base look) to 1 (all of it). */
  colorAmount: number;
  /** Extra glow added on the materials' resting glow, 0..1 per channel. */
  emissive: RGB;
}

export const NO_LOOK: StatusLook = { colorTo: [0, 0, 0], colorAmount: 0, emissive: [0, 0, 0] };

interface Layer {
  color: RGB;
  amount: number;
  glow: RGB;
  /** 0..1: how much of the mob's other glow this layer smothers (stone has none). */
  smother?: number;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const wave = (t: number, hz: number, phase = 0): number => 0.5 + 0.5 * Math.sin((t * hz + phase) * Math.PI * 2);
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
/** A hard flicker: jumps between levels a few dozen times a second, never repeating in a pattern the eye can follow. */
const flicker = (t: number, hz: number): number => {
  const n = Math.floor(t * hz);
  const h = Math.sin(n * 12.9898) * 43758.5453;
  return h - Math.floor(h);
};

/** Colours and strengths in one place, so the dev panel or a test can read them. */
export const STATUS_LOOK = {
  burning: { to: hex('#2a1610'), amount: 0.5, glow: hex('#ff4a0a'), hz: 2.6 },
  soaked: { to: hex('#1c3c4c'), amount: 0.45, glow: hex('#1aa6b8'), hz: 0.7 },
  rocked: { to: hex('#8a7f72'), amount: 0.85, glow: hex('#000000'), hz: 0 },
  gusted: { to: hex('#9be8f0'), amount: 0.25, glow: hex('#8ff0f0'), hz: 2.2 },
  shocked: { to: hex('#fff3a0'), amount: 0.3, glow: hex('#fff7b0'), hz: 22 },
  exposed: { to: hex('#e8cf86'), amount: 0.25, glow: hex('#ffd24a'), hz: 1.2 },
  cursed: { to: hex('#3a1a5c'), amount: 0.4, glow: hex('#9a2cff'), hz: 0.9 },
  rent: { to: hex('#4a0c0c'), amount: 0.4, glow: hex('#a80808'), hz: 1.6 },
  poisoned: { to: hex('#2e4a16'), amount: 0.4, glow: hex('#52e01a'), hz: 1.1 },
  dilated: { to: hex('#4c5666'), amount: 0.4, glow: hex('#6f8cc0'), hz: 0.4 },
  // marks
  stasis: { to: hex('#a8c4e0'), amount: 0.55, glow: hex('#8fb4ff'), hz: 0.5 },
  petrified: { to: hex('#6c665e'), amount: 0.9, glow: hex('#000000'), hz: 0 },
  hellfire: { to: hex('#2a0c0c'), amount: 0.45, glow: hex('#ff2200'), hz: 3 },
  overheat: { to: hex('#4a2410'), amount: 0.35, glow: hex('#ff7a1a'), hz: 4 },
  corroded: { to: hex('#6a4a2a'), amount: 0.4, glow: hex('#000000'), hz: 0 },
  plague: { to: hex('#4c5a1e'), amount: 0.4, glow: hex('#a8d02a'), hz: 1 },
} as const;

/** The seconds over which a status fades in the look as it runs out, so it does not snap off. */
const FADE_OUT = 0.35;

function layerOf(s: StatusIn, t: number): Layer | null {
  const spec = (STATUS_LOOK as Record<string, { to: RGB; amount: number; glow: RGB; hz: number }>)[s.id];
  if (!spec || !(s.remaining > 0)) return null;
  const fade = Math.min(1, s.remaining / FADE_OUT);
  const stacks = Math.min(5, Math.max(1, s.stacks ?? 1));
  let pulse: number;
  switch (s.id) {
    case 'burning':
    case 'hellfire':
    case 'overheat': // a ragged flame: two beats and a flicker
      pulse = 0.45 + 0.3 * wave(t, spec.hz) + 0.25 * wave(t, spec.hz * 2.7, 0.3) * (0.6 + 0.4 * flicker(t, 14));
      break;
    case 'shocked':
      pulse = flicker(t, spec.hz) > 0.45 ? 1 : 0.12;
      break;
    case 'rocked':
    case 'petrified':
    case 'corroded':
      pulse = 0;
      break;
    default:
      pulse = 0.35 + 0.65 * wave(t, spec.hz);
  }
  const stackBoost = s.id === 'poisoned' ? 0.75 + 0.25 * (stacks / 5) : 1;
  const glowK = pulse * fade * stackBoost * 0.95;
  const stone = s.id === 'rocked' || s.id === 'petrified';
  return { color: spec.to, amount: spec.amount * fade * stackBoost, glow: scale(spec.glow, glowK), smother: stone ? 0.95 : 0 };
}

/**
 * The look of everything on a mob at time `t` seconds: each status gives a colour, an amount and a pulsing glow, and several at
 * once blend (colours by their weight, amounts as 1 - product of the gaps, glows added and capped). Nothing on it gives NO_LOOK,
 * so the mob returns to its base look. Always finite.
 */
export function statusLook(statuses: readonly StatusIn[], t: number): StatusLook {
  const time = Number.isFinite(t) ? t : 0;
  const layers: Layer[] = [];
  for (const s of statuses) {
    const l = layerOf(s, time);
    if (l) layers.push(l);
  }
  if (!layers.length) return { colorTo: [0, 0, 0], colorAmount: 0, emissive: [0, 0, 0] };
  const w = layers.reduce((a, l) => a + l.amount, 0);
  const colorTo: RGB = [0, 0, 0];
  let gap = 1;
  const glow: RGB = [0, 0, 0];
  let smother = 0;
  for (const l of layers) {
    for (let i = 0; i < 3; i++) {
      colorTo[i] += w > 0 ? (l.color[i] * l.amount) / w : 0;
      glow[i] += l.glow[i];
    }
    gap *= 1 - Math.min(0.95, l.amount);
    smother = Math.max(smother, (l.smother ?? 0) * Math.min(1, l.amount / 0.6));
  }
  return {
    colorTo,
    colorAmount: 1 - gap,
    emissive: glow.map((g) => Math.min(1, g * (1 - smother))) as RGB,
  };
}
