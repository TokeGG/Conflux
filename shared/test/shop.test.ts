import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultData } from '../src/files.ts';
import { ENDLESS, planRoomAt } from '../src/run/endless.ts';
import { dailyFor } from '../src/run/daily.ts';
import { priceOf, stockQuiet, tryBuy, nearestStall } from '../src/run/shop.ts';
import type { RunState } from '../src/run/run.ts';

const data = defaultData();

/** A run standing in the quiet room `kind` of the landing (shop, shrine or rest) on the first floor, with `souls` in hand. */
function inRoom(seed: number, kind: 'shop' | 'shrine' | 'rest', souls = 1000, daily = false): RunState {
  const s = daily ? ENDLESS.start(dailyFor(20261024, data).seed, data, false, undefined, { daily: dailyFor(20261024, data) }) : ENDLESS.start(seed, data);
  const gate = { shop: 0, shrine: 1, rest: 2 }[kind];
  const current = planRoomAt(data, s.seed, 1, 6, gate);
  assert.equal(current.type, kind);
  const run: RunState = { ...s, roomIndex: 6, current, souls, soulsEarned: souls };
  return { ...run, quiet: stockQuiet(run, kind) };
}

test('a price rises with the floor and with rarity', () => {
  const eco = data.rewards.economy;
  assert.equal(priceOf({ kind: 'augment', rarity: 'common' }, 1, eco), eco.price.augment);
  assert.ok(priceOf({ kind: 'augment', rarity: 'rare' }, 1, eco) > priceOf({ kind: 'augment', rarity: 'common' }, 1, eco));
  assert.ok(priceOf({ kind: 'augment', rarity: 'epic' }, 1, eco) > priceOf({ kind: 'augment', rarity: 'rare' }, 1, eco));
  assert.ok(priceOf({ kind: 'skill' }, 3, eco) > priceOf({ kind: 'skill' }, 2, eco));
  assert.equal(priceOf({ kind: 'skill' }, 2, eco), Math.round(eco.price.skill * (1 + eco.depthScale)));
  assert.equal(priceOf({ kind: 'element' }, 1, eco), eco.price.element);
});

test('a shop has three or four different wares, and always one new element that is not held', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const run = inRoom(seed, 'shop');
    const wares = run.quiet!.wares;
    assert.ok(wares.length >= 3 && wares.length <= 4, `seed ${seed}: ${wares.length} wares`);
    const elements = wares.filter((w) => w.kind === 'element');
    assert.equal(elements.length, 1, `seed ${seed}: one element ware`);
    assert.ok(!run.skills.equipped.includes(elements[0].offer!.element!), 'never an element that is already held');
    assert.ok(wares.some((w) => w.kind === 'heal'), 'a heal');
    assert.ok(wares.some((w) => w.kind === 'augment'), 'an augment');
    const keys = wares.map((w) => `${w.kind}|${w.offer?.id ?? ''}|${w.offer?.element ?? ''}|${w.offer?.rarity ?? ''}`);
    assert.equal(new Set(keys).size, keys.length, 'no two wares alike');
    for (const w of wares) assert.ok(w.price > 0 && !w.sold);
    assert.ok(run.current.stalls!.length >= wares.length, 'a stall for every ware');
  }
});

test('the daily run\'s shop sells no element, since its three are locked', () => {
  const run = inRoom(1, 'shop', 1000, true);
  assert.ok(run.daily);
  assert.ok(!run.quiet!.wares.some((w) => w.kind === 'element'));
  assert.ok(run.quiet!.wares.length >= 3);
});

test('the same seed and state give the same shop, and another seed gives another', () => {
  assert.deepEqual(inRoom(5, 'shop').quiet, inRoom(5, 'shop').quiet);
  const seen = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(inRoom(i + 1, 'shop').quiet!.wares.map((w) => w.offer))));
  assert.ok(seen.size > 6, 'different seeds stock different wares');
});

test('a purchase takes the souls, marks the ware sold and gives the goods; a second try is refused', () => {
  const run = inRoom(2, 'shop', 1000);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'augment');
  const ware = run.quiet!.wares[i];
  const res = tryBuy(run, i);
  assert.ok(res.ok, res.reason);
  assert.equal(res.run.souls, 1000 - ware.price);
  assert.ok(res.run.quiet!.wares[i].sold);
  assert.equal(res.run.augments.length, run.augments.length + 1);
  assert.equal(res.run.augments.at(-1)!.id, ware.offer!.id);
  const again = tryBuy(res.run, i);
  assert.ok(!again.ok);
  assert.equal(again.run.souls, res.run.souls, 'not charged twice');
});

test('a ware that costs more than the souls in hand is refused and nothing changes', () => {
  const run = inRoom(2, 'shop', 5);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'skill' || w.kind === 'augment');
  const res = tryBuy(run, i);
  assert.ok(!res.ok);
  assert.match(res.reason!, /souls/);
  assert.equal(res.run, run);
});

test('a skill bought is owned and put to use at once', () => {
  const run = inRoom(3, 'shop', 1000);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'skill');
  assert.ok(i >= 0, 'this seed sells a skill');
  const id = run.quiet!.wares[i].offer!.id!;
  const res = tryBuy(run, i);
  assert.ok(res.ok);
  assert.ok(res.run.skills.pool.includes(id));
  const sk = data.skills[id];
  assert.equal(res.run.skills.slots[sk.element][sk.slot], id);
});

test('an element ware needs the key it takes over; a bad key costs nothing', () => {
  const run = inRoom(4, 'shop', 1000);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'element');
  const el = run.quiet!.wares[i].offer!.element!;
  for (const slot of [undefined, -1, 3, 1.5]) {
    const bad = tryBuy(run, i, slot);
    assert.ok(!bad.ok, `slot ${slot}`);
    assert.equal(bad.run, run);
  }
  const res = tryBuy(run, i, 1);
  assert.ok(res.ok, res.reason);
  assert.equal(res.run.skills.equipped[1], el);
  assert.equal(res.run.skills.equipped.length, 3);
  assert.equal(res.run.souls, 1000 - run.quiet!.wares[i].price);
});

test('a heal is refused at full health and restores health otherwise', () => {
  const run = inRoom(6, 'shop', 1000);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'heal');
  assert.ok(!tryBuy(run, i).ok, 'full health');
  const hurt = { ...run, hp: 20 };
  const res = tryBuy(hurt, i);
  assert.ok(res.ok);
  assert.ok(res.run.hp > 20);
});

test('a ware can only be bought from beside its stall', () => {
  const run = inRoom(2, 'shop', 1000);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'augment');
  const stall = run.current.stalls![i];
  const far = { x: stall.x + data.rewards.economy.interactReach + 3, y: 0, z: stall.z };
  const refused = tryBuy(run, i, undefined, far);
  assert.ok(!refused.ok);
  assert.match(refused.reason!, /closer/);
  assert.ok(tryBuy(run, i, undefined, { x: stall.x + 0.5, y: 0, z: stall.z }).ok);
  assert.equal(nearestStall(run.current, far, data.rewards.economy.interactReach), -1);
  assert.equal(nearestStall(run.current, stall, data.rewards.economy.interactReach), i);
});

test('a shrine gives one free choice among its boons and the trade, then closes', () => {
  const run = { ...inRoom(7, 'shrine', 0), hp: 50 };
  const wares = run.quiet!.wares;
  assert.ok(wares.length === 3 && wares.filter((w) => w.kind === 'boon').length === 2 && wares.filter((w) => w.kind === 'trade').length === 1);
  for (const w of wares.filter((x) => x.kind === 'boon')) assert.equal(w.price, 0);
  const res = tryBuy(run, 0);
  assert.ok(res.ok, res.reason);
  assert.equal(res.run.souls, 0, 'free');
  assert.ok(res.run.quiet!.wares.every((w) => w.sold), 'one choice only');
  assert.ok(!tryBuy(res.run, 1).ok);
});

test('the shrine\'s trade turns health into souls and cannot kill', () => {
  const run = inRoom(7, 'shrine', 10);
  const i = run.quiet!.wares.findIndex((w) => w.kind === 'trade');
  const max = data.player.health;
  const res = tryBuy(run, i);
  assert.ok(res.ok);
  assert.ok(res.run.hp < max);
  assert.equal(res.run.souls, 10 + data.rewards.economy.shrineTradeSouls);
  assert.equal(res.run.soulsEarned, run.soulsEarned, 'souls traded for are not souls picked up');
  assert.ok(!tryBuy({ ...run, hp: 5 }, i).ok, 'too hurt to trade');
});

test('a rest room heals for free, once', () => {
  const run = { ...inRoom(8, 'rest', 0), hp: 10 };
  assert.equal(run.quiet!.wares.length, 1);
  const res = tryBuy(run, 0);
  assert.ok(res.ok);
  assert.equal(res.run.hp, 10 + data.rewards.economy.restHeal * data.player.health);
  assert.ok(!tryBuy(res.run, 0).ok);
});
