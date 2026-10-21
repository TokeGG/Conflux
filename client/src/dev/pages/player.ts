import type { GameData } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

/** Player, game and element numbers: health, speed, dodge, swap, casting movement, the element multipliers and the reaction cooldown. */
export const playerPage = (state: DevState, base: () => GameData, changed: () => void) =>
  new FormPage({ id: 'player', title: 'Player and game', state, base, changed, roots: () => ['player', 'elements.multipliers', 'reactionCooldown'] });
