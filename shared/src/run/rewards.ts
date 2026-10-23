// What a cleared room offers: three choices drawn from the reward stream, with rarity rising by depth and a skill guaranteed early.
import { defaultData } from '../files.ts';
import type { Rng } from '../rng.ts';
import { ELEMENTS, RARITIES, type Element, type GameData, type Rarity, type RewardsCfg, type SkillDef } from '../types.ts';
import { canSocket, socketFor } from './augments.ts';
import type { RewardKind, RunState } from './run.ts';

export interface RewardOffer {
  kind: RewardKind;
  /** The skill or augment on offer. */
  id?: string;
  element?: Element;
  rarity?: Rarity;
}

/** How much more a rare or epic heal restores than a common one. */
const HEAL_RARITY: Record<Rarity, number> = { common: 1, rare: 1.5, epic: 2 };
const KIND_WEIGHT: Record<RewardKind, number> = { skill: 4, augment: 4, heal: 2, element: 0 };
const OFFERS = 3;
const ELEMENT_EVERY = 3;

/** Rarity odds for the room at `roomIndex` (counted from 0): the early weights up to the configured room, the late ones after. */
export function rarityWeights(roomIndex: number, cfg: RewardsCfg = defaultData().rewards): Record<Rarity, number> {
  return { ...(roomIndex <= cfg.rarity.early.until ? cfg.rarity.early.weights : cfg.rarity.late.weights) };
}

const keyOf = (o: RewardOffer) => `${o.kind}|${o.id ?? ''}|${o.rarity ?? ''}`;

export function drawRarity(state: RunState, data: GameData, rng: Rng): Rarity {
  const w = rarityWeights(state.roomIndex, data.rewards);
  return rng.weighted(RARITIES, (r) => w[r]);
}

/**
 * Skills not owned, not offered before and not already in this set, for an element held (a skill for one on the bench is no use yet).
 * Only when the elements held have nothing left to offer do the benched elements' skills come up, so a run is never left without a skill reward.
 */
export function skillPool(state: RunState, data: GameData, taken: Set<string>): string[] {
  const owned = new Set(state.skills.pool);
  const offered = new Set(state.offeredSkills);
  const open = Object.keys(data.skills)
    .filter((id) => !owned.has(id) && !offered.has(id) && !taken.has(id) && (!state.pool || state.pool.skills.has(id)))
    .sort();
  const held = open.filter((id) => state.skills.equipped.includes(data.skills[id].element));
  return held.length > 0 ? held : open;
}

/** The skills in use right now: the one on each slot of each element held. */
function equippedSkills(state: RunState, data: GameData): SkillDef[] {
  return state.skills.equipped.flatMap((el) => Object.values(state.skills.slots[el]).filter((id) => id && data.skills[id]).map((id) => data.skills[id]));
}

/** Whether an augment would do anything for what the player holds: its skill is equipped, its element is held, its tag is on an equipped skill, its reaction has both elements held. */
export function augmentUsable(state: RunState, data: GameData, id: string): boolean {
  const t = data.augments[id]?.target;
  if (!t) return false;
  const held = state.skills.equipped;
  if (t.skill) return equippedSkills(state, data).some((s) => s.id === t.skill) && canSocket(t.skill, state.augments);
  if (t.element) return held.includes(t.element as Element);
  if (t.tag) return equippedSkills(state, data).some((s) => s.tags.includes(t.tag!));
  if (t.reaction) {
    const row = data.reactions.find((r) => r.id === t.reaction || r.effect === t.reaction);
    return !!row && row.pair.every((el) => held.includes(el));
  }
  return false;
}

/** Augments worth offering: not already owned, not already in this set, and useful for what is held (see `augmentUsable`). */
export function augmentPool(state: RunState, data: GameData, taken: ReadonlySet<string> = new Set()): string[] {
  const owned = new Set(state.augments.map((a) => a.id));
  return Object.keys(data.augments)
    .filter((id) => !taken.has(id) && !owned.has(id) && (!state.pool || state.pool.augments.has(id)) && augmentUsable(state, data, id))
    .sort();
}

/** Elements off the bench that have a basic skill to play (none in the daily run, where the three are locked). */
export function benchElements(state: RunState): Element[] {
  if (state.daily) return [];
  return ELEMENTS.filter((el) => !state.skills.equipped.includes(el) && state.skills.slots[el].basic);
}

/** Exactly three different offers. The door's kind leads; a skill is forced in when none has been offered by the guaranteed room. */
export function offerRewards(state: RunState, data: GameData, rng: Rng): RewardOffer[] {
  const out: RewardOffer[] = [];
  const keys = new Set<string>();
  const skillIds = new Set<string>();
  const forceSkill = state.roomIndex + 1 >= data.rewards.guaranteeSkillByRoom && state.offeredSkills.length === 0;

  const make = (kind: RewardKind): RewardOffer | null => {
    if (kind === 'skill') {
      const pool = skillPool(state, data, skillIds);
      if (pool.length === 0) return null;
      // spread the skills over elements where there is a choice
      const usedElements = new Set(out.filter((o) => o.kind === 'skill').map((o) => o.element));
      const fresh = pool.filter((id) => !usedElements.has(data.skills[id].element));
      const id = rng.pick(fresh.length ? fresh : pool);
      return { kind, id, element: data.skills[id].element };
    }
    if (kind === 'element') {
      // an element off the bench that has skills to play; one at most per set
      const bench = benchElements(state).filter((el) => !out.some((o) => o.kind === 'element' && o.element === el));
      return bench.length ? { kind, element: rng.pick(bench) } : null;
    }
    if (kind === 'augment') {
      // only augments that can be used: a skill augment needs the skill owned and a free socket
      const ids = augmentPool(state, data);
      if (ids.length === 0) return null;
      return { kind, id: rng.pick(ids), rarity: drawRarity(state, data, rng) };
    }
    return { kind, rarity: drawRarity(state, data, rng) };
  };

  const add = (kind: RewardKind): boolean => {
    for (let tries = 0; tries < 30; tries++) {
      const o = make(kind);
      if (!o) return false;
      if (keys.has(keyOf(o))) continue;
      keys.add(keyOf(o));
      if (o.kind === 'skill') skillIds.add(o.id!);
      out.push(o);
      return true;
    }
    return false;
  };

  const first: RewardKind = forceSkill ? 'skill' : state.reward;
  if (!add(first)) add(first === 'augment' ? 'heal' : 'augment');
  // every third room one of the offers is an element off the bench (until shops sell them)
  if ((state.roomIndex + 1) % ELEMENT_EVERY === 0 && !state.daily) add('element');
  let guard = 0;
  while (out.length < OFFERS && guard++ < 200) {
    const hasSkills = skillPool(state, data, skillIds).length > 0;
    const kinds = (['skill', 'augment', 'heal'] as RewardKind[]).filter((k) => k !== 'skill' || hasSkills);
    add(rng.weighted(kinds, (k) => KIND_WEIGHT[k]));
  }
  // a last resort that cannot fail: heals of each rarity are always different from each other
  for (const r of RARITIES) {
    if (out.length >= OFFERS) break;
    const o: RewardOffer = { kind: 'heal', rarity: r };
    if (!keys.has(keyOf(o))) out.push(o);
  }
  return out.slice(0, OFFERS);
}

/** Notes that these offers were shown, so their skills are not offered again. */
export function recordOffers(state: RunState, offers: RewardOffer[]): RunState {
  const shown = offers.filter((o) => o.kind === 'skill' && o.id).map((o) => o.id!);
  return { ...state, offeredSkills: [...new Set([...state.offeredSkills, ...shown])] };
}

/** The state after the player takes an offer. */
export function claimReward(state: RunState, offer: RewardOffer): RunState {
  const max = state.data.player.health;
  switch (offer.kind) {
    case 'skill':
      if (!offer.id) return state;
      return state.skills.pool.includes(offer.id) ? state : { ...state, skills: { ...state.skills, pool: [...state.skills.pool, offer.id] } };
    case 'augment':
      if (!offer.id || !state.data.augments[offer.id]) return state;
      const socket = socketFor(state.data.augments[offer.id]);
      if (socket !== '*' && !canSocket(socket, state.augments)) return state; // the skill's sockets are full
      return { ...state, augments: [...state.augments, { id: offer.id, rarity: offer.rarity ?? 'common', skill: socket }] };
    case 'element':
      return state; // the director equips it into the slot the player picks
    case 'heal':
      return { ...state, hp: Math.min(max, state.hp + state.data.rewards.healFraction * max * HEAL_RARITY[offer.rarity ?? 'common']) };
  }
}

