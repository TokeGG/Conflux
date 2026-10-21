import type { GameData } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

export const reactionsPage = (state: DevState, base: () => GameData, changed: () => void) =>
  new FormPage({
    id: 'reactions',
    title: 'Reactions',
    state,
    base,
    changed,
    picker: { label: 'Reaction', options: () => state.layers.current().reactions.map((r) => r.id) },
    roots: (choice) => [`reactions.${choice}`],
  });
