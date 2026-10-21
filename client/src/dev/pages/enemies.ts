import type { GameData } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

/** Every enemy's numbers (health, speed, cost, guard, hurtboxes), including the custom mobs. */
export const enemiesPage = (state: DevState, base: () => GameData, changed: () => void) =>
  new FormPage({
    id: 'enemies',
    title: 'Enemies and bosses',
    state,
    base,
    changed,
    picker: { label: 'Enemy', options: () => Object.keys(state.layers.current().enemies).sort() },
    roots: (choice) => [`enemies.${choice}`],
  });
