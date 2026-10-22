import type { GameData } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

/**
 * Camera and feel: the over-the-shoulder camera (distance, shoulder, height, field of view, look limits, smoothing), the mouse, and the
 * numbers that make the character feel the way it does (move speed, jump, dodge, dash, casting speed, animation blend times).
 * Everything applies on the next frame after "Try now". This page does not pause the game, so the change can be watched while moving.
 */
export const cameraPage = (state: DevState, base: () => GameData, changed: () => void) => {
  return new FormPage({
    id: 'feel',
    title: 'Camera and feel',
    state,
    base,
    changed,
    pausesSim: false,
    roots: () => ['camera', 'player.moveSpeed', 'player.jump', 'player.dodge', 'player.dashSpeed', 'player.cast', 'animation.rigs.wizardpack'],
  });
};
