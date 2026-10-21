import type { GameData } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

export const skillsPage = (state: DevState, base: () => GameData, changed: () => void) =>
  new FormPage({
    id: 'skills',
    title: 'Skills',
    state,
    base,
    changed,
    picker: { label: 'Skill', options: () => Object.keys(state.layers.current().skills).sort() },
    roots: (choice) => [`skills.${choice}`],
  });
