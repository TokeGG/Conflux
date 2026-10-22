// The shipped data files, parsed, and the GameData built from them.
import player from '../data/player.json' with { type: 'json' };
import camera from '../data/camera.json' with { type: 'json' };
import animation from '../data/animation.json' with { type: 'json' };
import elements from '../data/elements.json' with { type: 'json' };
import statuses from '../data/statuses.json' with { type: 'json' };
import reactions from '../data/reactions.json' with { type: 'json' };
import skills from '../data/skills.json' with { type: 'json' };
import augments from '../data/augments.json' with { type: 'json' };
import enemies from '../data/enemies.json' with { type: 'json' };
import attacks from '../data/attacks.json' with { type: 'json' };
import rooms from '../data/rooms.json' with { type: 'json' };
import biomes from '../data/biomes.json' with { type: 'json' };
import elites from '../data/elites.json' with { type: 'json' };
import unlocks from '../data/unlocks.json' with { type: 'json' };
import patches from '../data/patches.json' with { type: 'json' };
import themes from '../data/themes.json' with { type: 'json' };
import rewards from '../data/rewards.json' with { type: 'json' };
import { loadData } from './data.ts';
import type { GameData } from './types.ts';

export const DATA_FILES = { player, camera, animation, elements, statuses, reactions, skills, augments, enemies, attacks, rooms, biomes, elites, unlocks, themes, rewards };

/** The patch notes, newest first. */
export const PATCHES: { version: string; date: string; at: string; notes: string[] }[] = patches;

/** A fresh copy of the shipped data (safe to mutate). */
export const defaultData = (): GameData => loadData(DATA_FILES);
