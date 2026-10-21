import type { GameData } from '@conflux/shared';
import { STATUS_IDS } from '@conflux/shared';
import { FormPage } from './formPage.ts';
import type { DevState } from '../devstate.ts';

export const statusesPage = (state: DevState, base: () => GameData, changed: () => void) =>
  new FormPage({ id: 'statuses', title: 'Statuses', state, base, changed, roots: () => STATUS_IDS.map((s) => `statuses.${s}`) });
