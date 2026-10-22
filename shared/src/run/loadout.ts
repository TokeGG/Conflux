// What the player has equipped and what they own: one skill per slot of each element, plus every skill found so far.
import type { Rng } from '../rng.ts';
import { ELEMENTS, SLOTS, type Element, type GameData, type Slot } from '../types.ts';
import type { Sim } from '../sim/sim.ts';

/** How many elements are held at once (keys 1 to 3); the rest wait on the bench. */
export const EQUIPPED = 3;

export interface SkillLoadout {
  /** The elements held, one per key. */
  equipped: Element[];
  /** The equipped skill for each slot of each element ('' when an element has none for that slot). */
  slots: Record<Element, Record<Slot, string>>;
  /** Every skill the player owns, equipped or not. */
  pool: string[];
}

/** One random skill per slot per element, from that element's skills. They all start in the pool. */
export function startingLoadout(data: GameData, rng: Rng, allowed?: Set<string>): SkillLoadout {
  const slots = {} as SkillLoadout['slots'];
  for (const el of ELEMENTS) {
    slots[el] = {} as Record<Slot, string>;
    for (const slot of SLOTS) {
      const options = Object.keys(data.skills).filter((id) => data.skills[id].element === el && data.skills[id].slot === slot && (!allowed || allowed.has(id))).sort();
      slots[el][slot] = options.length ? rng.pick(options) : '';
    }
  }
  // three different elements that have a basic skill, drawn in turn
  const bench = ELEMENTS.filter((el) => slots[el].basic);
  const equipped: Element[] = [];
  while (equipped.length < EQUIPPED && bench.length > 0) equipped.push(...bench.splice(rng.int(bench.length), 1));
  return { equipped, slots, pool: ELEMENTS.flatMap((el) => SLOTS.map((slot) => slots[el][slot])).filter(Boolean) };
}

/** Equips an owned skill on a slot. Throws, with a plain message, when the skill does not belong there. */
export function swapIn(l: SkillLoadout, element: Element, slot: Slot, skillId: string, data: GameData): SkillLoadout {
  const skill = data.skills[skillId];
  if (!skill) throw new Error(`${skillId} is not a skill`);
  if (skill.element !== element) throw new Error(`${skillId} is a ${skill.element} skill and cannot go on a ${element} slot (wrong element)`);
  if (skill.slot !== slot) throw new Error(`${skillId} is a ${skill.slot} skill and cannot go on the ${slot} slot (wrong slot)`);
  if (!l.pool.includes(skillId)) throw new Error(`${skillId} is not owned yet, so it cannot be equipped`);
  return { equipped: [...l.equipped], slots: { ...l.slots, [element]: { ...l.slots[element], [slot]: skillId } }, pool: [...l.pool] };
}

/** Holds `element` on key `slot` (0 to 2) in place of what was there, which goes to the bench. Its skills and augments stay with it. */
export function equipElement(l: SkillLoadout, slot: number, element: Element): SkillLoadout {
  if (!Number.isInteger(slot) || slot < 0 || slot >= EQUIPPED) throw new Error(`there is no element slot ${slot}`);
  if (l.equipped.includes(element)) throw new Error(`${element} is already held`);
  const equipped = [...l.equipped];
  equipped[slot] = element;
  return { equipped, slots: l.slots, pool: [...l.pool] };
}

/** Puts the loadout on the player in the simulation (a copy, so the player's slots and the run's stay separate). */
export function applyLoadout(sim: Sim, l: SkillLoadout): void {
  sim.player.loadout = structuredClone(l.slots);
  sim.player.equipped = [...l.equipped];
  sim.player.element = ELEMENTS.indexOf(l.equipped[0]);
}
