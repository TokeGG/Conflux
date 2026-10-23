// A scripted player: picks a target, swaps to the element that hurts it most, aims, keeps its distance, and rolls out of
// attacks that are about to land. It reads the simulation directly, so it is a stand-in for a person in headless fights.
import { BTN, ELEMENTS, idleInput, type Element, type Input, type SkillDef } from './types.ts';
import { TICK, type Sim } from './sim/sim.ts';
import { RunDirector, createRunRoomSim } from './run/director.ts';
import { ENDLESS } from './run/endless.ts';
import { emptyLedger } from './run/unlocks.ts';
import { isQuiet, type DoorChoice, type RunState } from './run/run.ts';
import type { RewardOffer } from './run/rewards.ts';
import { tryBuy } from './run/shop.ts';
import { depthAt } from './run/floors.ts';
import type { GameData } from './types.ts';
import type { EnemyState } from './sim/state.ts';

const KEEP_DISTANCE = 8;
/** Dodge when an attack that would hit lands within this many seconds. */
const DODGE_LEAD = 0.45;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const isFlyer = (e: EnemyState) => e.def.ai === 'flyer';

/** The enemy to fight next: the nearest, with flyers first since they cannot be kited. */
function pickTarget(sim: Sim): EnemyState | null {
  let best: EnemyState | null = null;
  let bestScore = Infinity;
  for (const e of sim.enemies) {
    if (e.hp <= 0 || e.aiState === 'buried') continue;
    const score = dist(e.pos, sim.player.pos) - (isFlyer(e) ? 3 : 0);
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

/** How much a reaction is worth when choosing an element: more than a weakness, so the bot mixes elements. */
const REACTION_BONUS = 2.2;

/** True when a hit of `el` would set off a reaction on `t`: it carries the status of some other element. */
function reactsWith(sim: Sim, t: EnemyState, el: Element): boolean {
  return ELEMENTS.some((o) => o !== el && (t.statuses[sim.data.elements.reacts[o]]?.until ?? 0) > sim.time + 1e-9);
}

/** True when the element's basic skill would put its status on a target that does not carry it yet, to set up a reaction. */
function marksTarget(sim: Sim, t: EnemyState, el: Element): boolean {
  const status = sim.data.skills[sim.player.loadout[el].basic]?.applies;
  return !!status && (t.statuses[status]?.until ?? 0) <= sim.time + 1e-9;
}

/** The element index to hold against the current target: its weakness if there is a skill for it and an element that will react with what it carries, never one it resists. */
export function chooseElement(sim: Sim): number {
  const p = sim.player;
  const t = pickTarget(sim);
  if (!t) return p.element;
  let best = p.element;
  let bestScore = -Infinity;
  ELEMENTS.forEach((el, i) => {
    if (!p.loadout[el].basic || !p.equipped.includes(el)) return;
    const resisted = t.def.resist.includes(el);
    const score = (t.def.weak.includes(el) ? 3 : resisted ? 0 : 1.5) + (i === p.element ? 0.3 : 0) + (!resisted && reactsWith(sim, t, el) ? REACTION_BONUS : 0) + (!resisted && marksTarget(sim, t, el) ? 0.8 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** A way out of an attack that is about to land on the player, or null when none is. */
function danger(sim: Sim): { x: number; z: number } | null {
  const p = sim.player.pos;
  for (const e of sim.enemies) {
    const act = e.attack;
    if (!act || act.phase !== 'windup') continue;
    const a = sim.data.attacks[act.attackId];
    if (!a || act.hitAt - sim.time > DODGE_LEAD) continue;
    const fwd = { x: Math.sin(act.yaw), z: Math.cos(act.yaw) };
    if (a.template === 'slam') {
      const c = { x: e.pos.x + fwd.x * a.range, z: e.pos.z + fwd.z * a.range };
      if (dist(p, c) < (a.radius ?? 2) + 0.8) return { x: p.x - c.x, z: p.z - c.z };
    } else if (a.template === 'melee_swipe') {
      if (dist(p, e.pos) < a.range + 1) return { x: p.x - e.pos.x, z: p.z - e.pos.z };
    } else if (a.template === 'charge') {
      const ahead = (p.x - e.pos.x) * fwd.x + (p.z - e.pos.z) * fwd.z;
      const side = (p.x - e.pos.x) * fwd.z - (p.z - e.pos.z) * fwd.x;
      if (ahead > -1 && ahead < a.range + 1 && Math.abs(side) < (a.radius ?? 0.8) + 1) return { x: -fwd.z * Math.sign(side || 1), z: fwd.x * Math.sign(side || 1) };
    }
  }
  return null;
}

/** The waypoints from the player to a goal (a gate, a stall), a breadth-first search over a 1 m grid; made once per goal. */
const gatePaths = new WeakMap<Sim, { goal: string; path: { x: number; z: number }[]; at: number }>();

function findPath(sim: Sim, goal: { x: number; z: number }): { x: number; z: number }[] {
  const R = Math.max(0.3, sim.data.player.radius);
  const half = 22;
  const n = half * 2;
  const cell = (v: number) => Math.floor(v + half);
  const centre = (i: number) => i - half + 0.5;
  const free = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < n && iz < n && !sim.world.blocked({ x: centre(ix), y: 0, z: centre(iz) }, R);
  const start = [cell(sim.player.pos.x), cell(sim.player.pos.z)];
  const end = [cell(goal.x), cell(goal.z)];
  const from = new Map<number, number>();
  const key = (ix: number, iz: number) => ix * n + iz;
  const queue = [key(start[0], start[1])];
  from.set(queue[0], -1);
  for (let head = 0; head < queue.length && !from.has(key(end[0], end[1])); head++) {
    const ix = Math.floor(queue[head] / n);
    const iz = queue[head] % n;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = ix + dx;
      const c = iz + dz;
      // a diagonal step must not cut a corner
      if (!free(a, c) || from.has(key(a, c)) || (dx !== 0 && dz !== 0 && (!free(ix + dx, iz) || !free(ix, iz + dz)))) continue;
      from.set(key(a, c), queue[head]);
      queue.push(key(a, c));
    }
  }
  const path: { x: number; z: number }[] = [];
  for (let k = from.has(key(end[0], end[1])) ? key(end[0], end[1]) : -1; k >= 0; k = from.get(k)!) path.push({ x: centre(Math.floor(k / n)), z: centre(k % n) });
  return path.reverse();
}

/** Walk to a point by a route round the props. */
export function walkTo(sim: Sim, input: Input, goal: { x: number; z: number } | undefined): Input {
  const p = sim.player.pos;
  const key = goal ? `${goal.x},${goal.z}` : '';
  let plan = gatePaths.get(sim);
  if (!plan || plan.goal !== key) {
    plan = { goal: key, path: goal ? [...findPath(sim, goal), { x: goal.x, z: goal.z }] : [], at: 0 };
    gatePaths.set(sim, plan);
  }
  while (plan.at < plan.path.length - 1 && Math.hypot(plan.path[plan.at].x - p.x, plan.path[plan.at].z - p.z) < 0.7) plan.at++;
  const wp = plan.path[plan.at];
  if (!wp) return input;
  input.aimYaw = Math.atan2(wp.x - p.x, wp.z - p.z);
  input.moveZ = 1;
  return input;
}

/** The gate a bot has set its mind on in a room (an index into `sim.doors`); without one it takes the nearest. */
const gateWish = new WeakMap<Sim, number>();

/** Picks the gate to leave by: a shop when the bot has souls to spend, a rest room when it is hurt; otherwise none (the nearest). */
export function botPickGate(run: RunState, doors: DoorChoice[]): number | undefined {
  const cheapest = Math.min(...Object.values(run.data.rewards.economy.price));
  const i = doors.findIndex((d) => d.room.type === 'shop');
  if (i >= 0 && run.souls >= cheapest) return i;
  const r = doors.findIndex((d) => d.room.type === 'rest');
  if (r >= 0 && run.hp < run.data.player.health * 0.6) return r;
  return undefined;
}

/** A cleared room: walk to the nearest gate. */
function leaveRoom(sim: Sim, input: Input): Input {
  const p = sim.player.pos;
  // the gate it chose first stays the goal while it walks, so it does not dither between two
  const chosen = sim.doors.find((d) => `${d.x},${d.z}` === gatePaths.get(sim)?.goal);
  const gate = chosen ?? sim.doors[gateWish.get(sim) ?? -1] ?? [...sim.doors].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  return walkTo(sim, input, gate);
}

/** How close the target must be for the bot to use a secondary skill: inside a cone's or stream's range, otherwise a throw away. */
function reach(skill: SkillDef | undefined): number {
  if (!skill) return 0;
  if (skill.shape.type === 'cone' || skill.shape.type === 'stream') return Math.min(7.5, (skill.shape.range ?? 5) - 0.5);
  return 7.5;
}

export function botInput(sim: Sim): Input {
  const p = sim.player;
  const eye = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
  const input = { ...idleInput(), camOrigin: eye };
  const t = pickTarget(sim);
  if (!t) return sim.roomCleared ? leaveRoom(sim, input) : input;

  const want = chooseElement(sim);
  input.swapTo = want !== p.element ? p.equipped.indexOf(ELEMENTS[want]) : -1;

  // aim at the middle of the target
  const cy = t.pos.y + (isFlyer(t) ? 0.6 : 0.9);
  const dx = t.pos.x - eye.x;
  const dz = t.pos.z - eye.z;
  input.aimYaw = Math.atan2(dx, dz);
  input.aimPitch = Math.atan2(cy - eye.y, Math.hypot(dx, dz));

  // where to go: away from anything close, otherwise hold a distance from the target and circle it
  let wx = 0;
  let wz = 0;
  const d = dist(t.pos, p.pos);
  const to = { x: (t.pos.x - p.pos.x) / (d || 1), z: (t.pos.z - p.pos.z) / (d || 1) };
  if (d < KEEP_DISTANCE - 1) (wx -= to.x), (wz -= to.z);
  else if (d > KEEP_DISTANCE + 2) (wx += to.x), (wz += to.z);
  else {
    const side = Math.floor(sim.time / 3) % 2 ? 1 : -1;
    (wx += -to.z * side), (wz += to.x * side);
  }
  for (const e of sim.enemies) {
    const de = dist(e.pos, p.pos);
    if (de < 4 && e !== t) {
      wx += (p.pos.x - e.pos.x) / (de || 1);
      wz += (p.pos.z - e.pos.z) / (de || 1);
    }
  }
  // keep off the room's edge
  const room = Object.values(sim.data.rooms).find((r) => sim.world.colliders.length >= r.colliders.length);
  if (room) {
    const [w, h] = room.size;
    if (Math.abs(p.pos.x) > w / 2 - 2) wx -= Math.sign(p.pos.x) * 2;
    if (Math.abs(p.pos.z) > h / 2 - 2) wz -= Math.sign(p.pos.z) * 2;
  }

  const flee = danger(sim);
  if (flee) {
    wx = flee.x;
    wz = flee.z;
    input.buttons |= BTN.DODGE;
  }
  const len = Math.hypot(wx, wz);
  if (len > 1e-6) {
    // a step that would run into something turns to the side instead
    for (const turn of [0, 0.8, -0.8, 1.6, -1.6]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const dx2 = (wx * c - wz * s) / len;
      const dz2 = (wx * s + wz * c) / len;
      if (!sim.world.blocked({ x: p.pos.x + dx2 * 0.6, y: p.pos.y, z: p.pos.z + dz2 * 0.6 }, sim.data.player.radius)) {
        wx = dx2;
        wz = dz2;
        break;
      }
    }
    const fwd = { x: Math.sin(input.aimYaw), z: Math.cos(input.aimYaw) };
    const right = { x: Math.cos(input.aimYaw), z: -Math.sin(input.aimYaw) };
    input.moveZ = (wx * fwd.x + wz * fwd.z) * Math.min(1, len);
    input.moveX = (wx * right.x + wz * right.z) * Math.min(1, len);
  }

  // skills: the secondary when it is ready and the target is close, a shield when hurt, otherwise the basic
  const ready = (id: string) => !!id && sim.time >= (p.cooldowns[id] ?? 0);
  const el = ELEMENTS[p.element];
  const secondary = p.loadout[el].secondary;
  const utility = p.loadout[el].utility;
  if (!input.buttons) {
    const util = sim.data.skills[utility];
    if (p.hp < 60 && ready(utility) && util?.shape.type === 'self') input.buttons |= BTN.UTIL;
    else if (ready(utility) && util?.shape.type === 'dash' && d > KEEP_DISTANCE + 4) input.buttons |= BTN.UTIL; // a dash closes a gap
    else if (ready(secondary) && d < reach(sim.data.skills[secondary])) input.buttons |= BTN.RMB;
    else input.buttons |= BTN.LMB;
  } else {
    input.buttons |= 0; // rolling: no casting this tick
  }
  return input;
}

// ---- whole runs, for the balance report ----

export interface RunReport {
  seed: number;
  victory: boolean;
  /** Rooms cleared. */
  rooms: number;
  /** Simulated seconds the run lasted. */
  seconds: number;
  skillUse: Record<string, number>;
  augmentUse: Record<string, number>;
  reactions: Record<string, number>;
  /** Souls picked up, and wares bought with them. */
  souls: number;
  bought: number;
  /** The depth reached (1 on the first floor). */
  depth: number;
  /** Every quiet room the run stood in: its kind, the floor, the souls in hand on arrival and the wares bought there. */
  quiet: { kind: string; depth: number; souls: number; bought: number }[];
  /** Where the run ended, when the bot died: the room's number (0 based), its type and theme, and what dealt the last hit. */
  death?: { room: number; type: string; theme: string; killer: string };
}

/** A room the bot cannot clear in this long counts as a loss, so a stuck fight cannot hang a report. */
const ROOM_LIMIT = 180;
/** A bot that cannot finish its shopping in this many seconds leaves anyway. */
const SHOP_LIMIT = 45;

/** The reward to take: a heal when hurt, then a skill, then an augment, then a heal. */
export function botPickReward(run: RunState, offers: RewardOffer[]): number {
  const order = run.hp < run.data.player.health * 0.5 ? ['heal', 'skill', 'augment'] : ['skill', 'augment', 'heal'];
  for (const kind of order) {
    const i = offers.findIndex((o) => o.kind === kind);
    if (i >= 0) return i;
  }
  return 0;
}

/** The door to take: the same preference as the reward, so a run keeps finding skills. */
export function botPickDoor(run: RunState, doors: DoorChoice[]): number {
  const order = run.hp < run.data.player.health * 0.5 ? ['heal', 'skill', 'augment'] : ['skill', 'augment', 'heal'];
  for (const kind of order) {
    const i = doors.findIndex((d) => d.reward === kind);
    if (i >= 0) return i;
  }
  return 0;
}

/** Ranks what a bot wants from a quiet room: healing when hurt, then a skill, an augment, a boon, a rest. Never an element (it keeps its trio) or a trade. */
const WANT = ['skill', 'augment', 'boon', 'rest', 'heal'];

/** The ware to buy next in the room the run stands in: the best the bot can afford and use, or -1 when it is done shopping. */
export function botWareChoice(run: RunState): number {
  const room = run.quiet;
  if (!room) return -1;
  const hurt = run.hp < run.data.player.health * 0.6;
  let best = -1;
  let bestRank = Infinity;
  room.wares.forEach((w, i) => {
    if (w.sold || w.kind === 'element' || w.kind === 'trade' || !tryBuy(run, i).ok) return;
    const heals = w.kind === 'heal' || w.kind === 'rest' || w.offer?.kind === 'heal';
    const rank = heals && hurt ? -1 : WANT.indexOf(w.kind) + (heals ? 10 : 0);
    if (rank < bestRank) (best = i), (bestRank = rank);
  });
  return best;
}

/**
 * One tick of shopping in a quiet room: walks toward the best ware the bot can afford and, within reach of its stall, buys it.
 * Returns the input to send, or null when the bot is done shopping and should leave by a gate.
 */
export function botShop(d: RunDirector, sim: Sim, onBuy?: () => void): Input | null {
  const want = botWareChoice(d.run);
  if (want < 0) return null;
  const stall = d.run.current.stalls![want];
  const base = { ...idleInput(), camOrigin: { x: sim.player.pos.x, y: sim.player.pos.y + 1.6, z: sim.player.pos.z } };
  if (dist(stall, sim.player.pos) > d.run.data.rewards.economy.interactReach * 0.7) return walkTo(sim, base, stall);
  if (d.buy(want, undefined, sim.player.pos).ok) {
    onBuy?.();
    sim.player.hp = d.run.hp;
  }
  return base;
}

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/** Plays an endless run with the scripted bot until it dies or `maxSeconds` of simulated time pass, and reports what happened. Deterministic for a seed. */
export function playRun(data: GameData, seed: number, maxSeconds: number): RunReport {
  const d = new RunDirector(data, seed, emptyLedger(), false, ENDLESS);
  const report: RunReport = { seed, victory: false, rooms: 0, seconds: 0, skillUse: {}, augmentUse: {}, reactions: {}, souls: 0, bought: 0, depth: 1, quiet: [] };
  let sim: Sim | null = null;
  let lastKiller = '';
  d.onEnter = () => {
    sim = null;
    lastKiller = '';
    if (isQuiet(d.run.current.type)) report.quiet.push({ kind: d.run.current.type, depth: depthAt(d.run.roomIndex), souls: d.run.souls, bought: 0 });
  };
  let ticks = 0;
  let roomTicks = 0;
  let shopTicks = 0;
  const limit = Math.floor(maxSeconds / TICK);
  while (d.phase !== 'dead' && ticks < limit) {
    if (d.phase === 'reward') {
      d.pick(botPickReward(d.run, d.offers));
      continue;
    }
    sim ??= createRunRoomSim(d.run, data);
    if (d.phase === 'doors' && !gateWish.has(sim)) {
      const wish = botPickGate(d.run, d.doors);
      if (wish !== undefined) gateWish.set(sim, wish);
    }
    // in a quiet room: walk to the best ware it can afford and buy it, then leave by a gate
    const input = d.phase === 'doors' && shopTicks < SHOP_LIMIT / TICK ? botShop(d, sim, () => (report.bought++, report.quiet[report.quiet.length - 1] && report.quiet[report.quiet.length - 1].bought++)) : null;
    if (input) shopTicks++;
    const events = sim.step([input ?? botInput(sim)]);
    ticks++;
    roomTicks++;
    for (const e of events) {
      if (e.type === 'cast') bump(report.skillUse, String(e.skillId));
      else if (e.type === 'reaction') bump(report.reactions, String(e.effect));
    }
    if (sim.lastHurtBy) lastKiller = sim.lastHurtBy;
    d.onPlayerHp(sim.player.hp);
    d.onEvents(events);
    if (!sim) (roomTicks = 0), (shopTicks = 0);
    // a room the bot cannot clear (or leave) in this long counts as a loss, so a stuck fight cannot hang a report
    else if (roomTicks * TICK > ROOM_LIMIT) ((lastKiller = 'timeout'), d.onPlayerHp(0));
  }
  for (const a of d.run.augments) bump(report.augmentUse, a.id);
  if (d.phase === 'dead') report.death = { room: d.run.current.index, type: d.run.current.type, theme: d.run.current.biome, killer: lastKiller };
  report.rooms = d.run.history.length;
  report.souls = d.run.soulsEarned;
  report.depth = depthAt(d.run.roomIndex);
  report.seconds = ticks * TICK;
  return report;
}
