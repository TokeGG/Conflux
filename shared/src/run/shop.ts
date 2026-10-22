// The quiet rooms' wares: what a shop sells, what a shrine offers and what a rest room gives, the prices (which rise with the floor
// and with rarity) and the rules of buying. Pure functions over the run, so the director, the bot and the tests share them.
import type { Vec3 } from '../math.ts';
import { makeStreams } from '../rng.ts';
import type { EconomyCfg, Rarity } from '../types.ts';
import { depthAt } from './floors.ts';
import { EQUIPPED, equipElement, swapIn } from './loadout.ts';
import { augmentPool, benchElements, claimReward, drawRarity, skillPool, type RewardOffer } from './rewards.ts';
import type { QuietKind, RoomPlan, RunState } from './run.ts';

export type WareKind = 'skill' | 'augment' | 'heal' | 'element' | 'boon' | 'trade' | 'rest';

export interface Ware {
  kind: WareKind;
  /** The skill, augment, element or heal on offer (not for a trade or a rest). */
  offer?: RewardOffer;
  /** Souls to pay (0 at a shrine or a rest). */
  price: number;
  sold: boolean;
  /** A trade: health given up and souls gained. */
  hpCost?: number;
  gain?: number;
  /** A rest: the share of the health it restores. */
  healFraction?: number;
}

export interface QuietRoom {
  kind: QuietKind;
  wares: Ware[];
  /** Taking one ware closes the others (the shrine's single free choice). */
  exclusive: boolean;
}

/** The price of an offer on the floor `depth`: the base price of its kind, times its rarity, times the floor's rise. */
export function priceOf(offer: Pick<RewardOffer, 'kind' | 'rarity'>, depth: number, eco: EconomyCfg): number {
  const base = eco.price[offer.kind];
  const rarity = offer.rarity ? eco.rarityMul[offer.rarity] : 1;
  return Math.round(base * rarity * (1 + eco.depthScale * (depth - 1)));
}

/** The index of the stall within `reach` of `pos` (the nearest one), or -1. */
export function nearestStall(plan: Pick<RoomPlan, 'stalls'>, pos: Vec3, reach: number): number {
  let best = -1;
  let bestD = reach;
  (plan.stalls ?? []).forEach((s, i) => {
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d <= bestD) (best = i), (bestD = d);
  });
  return best;
}

/**
 * Gives the player what an offer is, without any payment: an element takes over key `slot`, a skill is owned and put to use at
 * once (the one it replaces stays owned), an augment is socketed, a heal restores health. Null when it cannot be taken.
 */
export function takeOffer(run: RunState, offer: RewardOffer, slot?: number): RunState | null {
  let next = run;
  if (offer.kind === 'element') {
    if (!offer.element || slot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= EQUIPPED || run.skills.equipped.includes(offer.element)) return null;
    next = { ...next, skills: equipElement(next.skills, slot, offer.element) };
  }
  if (offer.kind === 'skill' && offer.id && run.skills.pool.includes(offer.id)) return null;
  const claimed = claimReward(next, offer);
  if (offer.kind === 'augment' && claimed.augments.length === run.augments.length) return null; // no free socket
  next = claimed;
  if (offer.kind === 'skill' && offer.id && next.skills.pool.includes(offer.id)) {
    const s = next.data.skills[offer.id];
    next = { ...next, skills: swapIn(next.skills, s.element, s.slot, offer.id, next.data) };
  }
  return next;
}

/** What the quiet room `kind` the run stands in offers. The same seed, room and state always give the same wares. */
export function stockQuiet(run: RunState, kind: QuietKind): QuietRoom {
  const data = run.data;
  const eco = data.rewards.economy;
  const depth = depthAt(run.roomIndex);
  const rng = makeStreams(run.seed).reward.fork(`quiet/${run.roomIndex}`);
  const ware = (offer: RewardOffer, price = priceOf(offer, depth, eco)): Ware => ({ kind: offer.kind, offer, price, sold: false });
  const skillOffer = (): RewardOffer | null => {
    const pool = skillPool(run, data, new Set());
    if (pool.length === 0) return null;
    const id = rng.pick(pool);
    return { kind: 'skill', id, element: data.skills[id].element };
  };
  const augmentOffer = (taken: Set<string>, minRarity?: Rarity): RewardOffer | null => {
    const ids = augmentPool(run, data, taken);
    if (ids.length === 0) return null;
    const id = rng.pick(ids);
    let rarity = drawRarity(run, data, rng);
    if (minRarity && rarity === 'common') rarity = minRarity;
    taken.add(id);
    return { kind: 'augment', id, rarity };
  };

  if (kind === 'rest') return { kind, exclusive: false, wares: [{ kind: 'rest', price: 0, sold: false, healFraction: eco.restHeal }] };

  if (kind === 'shrine') {
    const taken = new Set<string>();
    const pool: RewardOffer[] = [];
    const aug = augmentOffer(taken, 'rare');
    if (aug) pool.push(aug);
    const skill = skillOffer();
    if (skill) pool.push(skill);
    pool.push({ kind: 'heal', rarity: 'epic' }, { kind: 'heal', rarity: 'rare' });
    // two different boons, in an order the seed decides
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const boons: Ware[] = pool.slice(0, 2).map((o) => ({ kind: 'boon' as const, offer: o, price: 0, sold: false }));
    const trade: Ware = {
      kind: 'trade',
      price: 0,
      sold: false,
      hpCost: Math.round(eco.shrineTradeHp * data.player.health),
      gain: Math.round(eco.shrineTradeSouls * (1 + eco.depthScale * (depth - 1))),
    };
    return { kind, exclusive: true, wares: [...boons, trade] };
  }

  // a shop: a new element, a skill, an augment (or two) and a heal; three or four wares
  const wares: Ware[] = [];
  const bench = benchElements(run);
  if (bench.length) wares.push(ware({ kind: 'element', element: rng.pick(bench) }));
  const skill = skillOffer();
  if (skill) wares.push(ware(skill));
  const taken = new Set<string>();
  const first = augmentOffer(taken);
  if (first) wares.push(ware(first));
  // the heal makes up the last place; before it, enough augments for three wares, and now and then a fourth
  while (wares.length < 2) {
    const more = augmentOffer(taken);
    if (!more) break;
    wares.push(ware(more));
  }
  if (wares.length < 3 && rng.next() < 0.5) {
    const more = augmentOffer(taken);
    if (more) wares.push(ware(more));
  }
  wares.push(ware({ kind: 'heal', rarity: drawRarity(run, data, rng) }));
  return { kind, exclusive: false, wares: wares.slice(0, 4) };
}

export interface BuyResult {
  ok: boolean;
  reason?: string;
  /** The run after the purchase; the very same object when it was refused. */
  run: RunState;
}

/** Buys ware `i` of the room the run stands in. An element ware also needs `slot`; `near`, when given, must be within reach of the stall. */
export function tryBuy(run: RunState, i: number, slot?: number, near?: Vec3): BuyResult {
  const no = (reason: string): BuyResult => ({ ok: false, reason, run });
  const room = run.quiet;
  const w = room?.wares[i];
  if (!room || !w) return no('There is nothing to buy here.');
  if (w.sold) return no('Already taken.');
  const eco = run.data.rewards.economy;
  const stall = run.current.stalls?.[i];
  if (near && stall && Math.hypot(stall.x - near.x, stall.z - near.z) > eco.interactReach) return no('Come closer.');
  if (run.souls < w.price) return no(`Not enough souls (${w.price} needed).`);
  const max = run.data.player.health;
  let next: RunState | null = { ...run, souls: run.souls - w.price };
  if (w.kind === 'trade') {
    if (run.hp - (w.hpCost ?? 0) < 1) return no('Too hurt to trade.');
    next = { ...next, hp: run.hp - (w.hpCost ?? 0), souls: next.souls + (w.gain ?? 0) };
  } else if (w.kind === 'rest') {
    if (run.hp >= max) return no('Already at full health.');
    next = { ...next, hp: Math.min(max, run.hp + (w.healFraction ?? 0) * max) };
  } else if (w.offer) {
    if (w.offer.kind === 'heal' && run.hp >= max) return no('Already at full health.');
    if (w.offer.kind === 'element' && (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot >= EQUIPPED)) return no('Choose which key it takes over.');
    next = takeOffer(next, w.offer, slot);
    if (!next) return no(w.offer.kind === 'augment' ? 'No free socket for it.' : 'That cannot be taken now.');
  }
  const wares = room.wares.map((x, k) => (k === i || room.exclusive ? { ...x, sold: true } : x));
  return { ok: true, run: { ...next, quiet: { ...room, wares } } };
}
