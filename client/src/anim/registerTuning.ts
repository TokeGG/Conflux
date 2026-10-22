// Puts the live tuning objects of client/src/anim into the registry the dev panel's "Motion tuning" page lists.
// Anyone who adds an exported tuning object (for example the attack animations' numbers) adds one line here.
import { MOTION } from './mobMotion.ts';
import { ATTACK_TIMING, CLIPPED_BODY_WEIGHT } from './attackAnim.ts';
import { AURA_PULSE } from './bossAura.ts';
import { tuning } from './tuning.ts';

export function registerAnimTuning(): void {
  tuning.register('mobMotion', MOTION, {
    title: 'Mob motion',
    specs: {
      breathAmp: { label: 'Breathing size', min: 0, max: 0.2, step: 0.005 },
      breathHz: { label: 'Breathing speed (Hz)', min: 0, max: 3, step: 0.05 },
      leanPerSpeed: { label: 'Lean per m/s', min: 0, max: 0.5, step: 0.01 },
      maxLean: { label: 'Most lean (rad)', min: 0, max: 1, step: 0.01 },
      bobAmp: { label: 'Walking bob (m)', min: 0, max: 0.5, step: 0.01 },
      attackBack: { label: 'Attack draw-back (m)', min: 0, max: 2, step: 0.01 },
      attackBackSeconds: { label: 'Draw-back time (s)', min: 0.02, max: 1, step: 0.01 },
      attackThrust: { label: 'Attack thrust (m)', min: 0, max: 3, step: 0.01 },
      attackThrustSeconds: { label: 'Thrust time (s)', min: 0.02, max: 1, step: 0.01 },
      attackReturnSeconds: { label: 'Return time (s)', min: 0.02, max: 2, step: 0.01 },
      hurtKick: { label: 'Hit kick (m)', min: 0, max: 1, step: 0.01 },
      hurtSeconds: { label: 'Hit kick time (s)', min: 0.02, max: 1, step: 0.01 },
      popSeconds: { label: 'Spawn pop time (s)', min: 0.05, max: 2, step: 0.01 },
      followRate: { label: 'Follow rate (per s)', min: 1, max: 100, step: 1 },
      turnRate: { label: 'Turn rate (per s)', min: 1, max: 100, step: 1 },
    },
  });
  tuning.register('attackTiming', ATTACK_TIMING, {
    title: 'Mob attack timing',
    specs: {
      strikeSeconds: { label: 'Strike time (s)', min: 0.03, max: 0.6, step: 0.01 },
      recoverSeconds: { label: 'Recovery time (s)', min: 0.05, max: 1.5, step: 0.01 },
      clipHitFraction: { label: 'Share of an attack clip where the blow lands', min: 0.1, max: 0.95, step: 0.01 },
    },
  });
  tuning.register('bossAura', AURA_PULSE as unknown as Record<string, unknown>, { title: 'Boss aura pulse', specs: {} });
}
