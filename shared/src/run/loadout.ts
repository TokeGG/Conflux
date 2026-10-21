// What the player has equipped and what they own: one skill per slot of each element, plus every skill found so far.
import type { Rng } from '../rng.ts';
import { ELEMENTS, SLOTS, type Element, type GameData, type Slot } from '../types.ts';
import type { Sim } from '../sim/sim.ts';

export interface SkillLoadout {
  /** The equipped skill for each slot of each element ('' when an element has none for that slot). */
  slots: Record<Element, Record<Slot, string>>;
  /** Every skill the player owns, equipped or not. */
  pool: string[];
}

/** One random skill per slot per element, from that element's skills. They all start in the pool. */
export function startingLoadout(data: GameData, rng: Rng): SkillLoadout {
  const slots = {} as SkillLoadout['slots'];
  for (const el of ELEMENTS) {
    slots[el] = {} as Record<Slot, string>;
    for (const slot of SLOTS) {
      const options = Object.keys(data.skills).filter((id) => data.skills[id].element === el && data.skills[id].slot === slot).sort();
      slots[el][slot] = options.length ? rng.pick(options) : '';
    }
  }
  return { slots, pool: ELEMENTS.flatMap((el) => SLOTS.map((slot) => slots[el][slot])).filter(Boolean) };
}

/** Equips an owned skill on a slot. Throws, with a plain message, when the skill does not belong there. */
export function swapIn(l: SkillLoadout, element: Element, slot: Slot, skillId: string, data: GameData): SkillLoadout {
  const skill = data.skills[skillId];
  if (!skill) throw new Error(`${skillId} is not a skill`);
  if (skill.element !== element) throw new Error(`${skillId} is a ${skill.element} skill and cannot go on a ${element} slot (wrong element)`);
  if (skill.slot !== slot) throw new Error(`${skillId} is a ${skill.slot} skill and cannot go on the ${slot} slot (wrong slot)`);
  if (!l.pool.includes(skillId)) throw new Error(`${skillId} is not owned yet, so it cannot be equipped`);
  return { slots: { ...l.slots, [element]: { ...l.slots[element], [slot]: skillId } }, pool: [...l.pool] };
}

/** Puts the loadout on the player in the simulation (a copy, so the player's slots and the run's stay separate). */
export function applyLoadout(sim: Sim, l: SkillLoadout): void {
  sim.player.loadout = structuredClone(l.slots);
}
