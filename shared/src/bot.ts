// A scripted player: picks a target, swaps to the element that hurts it most, aims, keeps its distance, and rolls out of
// attacks that are about to land. It reads the simulation directly, so it is a stand-in for a person in headless fights.
import { BTN, ELEMENTS, idleInput, type Input } from './types.ts';
import { TICK, type Sim } from './sim/sim.ts';
import { RunDirector, createRunRoomSim } from './run/director.ts';
import { emptyLedger } from './run/unlocks.ts';
import type { DoorChoice, RunState } from './run/run.ts';
import type { RewardOffer } from './run/rewards.ts';
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

/** The element index to hold against the current target: its weakness if there is a skill for it, never one it resists. */
export function chooseElement(sim: Sim): number {
  const p = sim.player;
  const t = pickTarget(sim);
  if (!t) return p.element;
  let best = p.element;
  let bestScore = -Infinity;
  ELEMENTS.forEach((el, i) => {
    if (!p.loadout[el].basic) return;
    const score = (t.def.weak.includes(el) ? 3 : t.def.resist.includes(el) ? 0 : 1.5) + (i === p.element ? 0.3 : 0);
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

export function botInput(sim: Sim): Input {
  const p = sim.player;
  const eye = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
  const input = { ...idleInput(), camOrigin: eye };
  const t = pickTarget(sim);
  if (!t) return input;

  const want = chooseElement(sim);
  input.swapTo = want !== p.element ? want : -1;

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
    if (p.hp < 60 && ready(utility) && sim.data.skills[utility]?.shape.type === 'self') input.buttons |= BTN.UTIL;
    else if (ready(secondary) && d < 7.5) input.buttons |= BTN.RMB;
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
}

/** A room the bot cannot clear in this long counts as a loss, so a stuck fight cannot hang a report. */
const ROOM_LIMIT = 180;

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

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/** Plays a whole run with the scripted bot and reports what happened. Deterministic for a seed. */
export function playRun(data: GameData, seed: number, maxSeconds: number): RunReport {
  const d = new RunDirector(data, seed, emptyLedger());
  const report: RunReport = { seed, victory: false, rooms: 0, seconds: 0, skillUse: {}, augmentUse: {}, reactions: {} };
  let ticks = 0;
  const limit = Math.floor(maxSeconds / TICK);
  while (d.phase !== 'dead' && d.phase !== 'won' && ticks < limit) {
    if (d.phase === 'reward') d.pick(botPickReward(d.run, d.offers));
    else if (d.phase === 'doors') d.enter(botPickDoor(d.run, d.doors));
    else {
      const sim = createRunRoomSim(d.run, data);
      while (d.phase === 'fighting' && ticks < limit) {
        const events = sim.step([botInput(sim)]);
        ticks++;
        for (const e of events) {
          if (e.type === 'cast') bump(report.skillUse, String(e.skillId));
          else if (e.type === 'reaction') bump(report.reactions, String(e.effect));
        }
        d.onPlayerHp(sim.player.hp);
        d.onEvents(events);
        if (sim.time > ROOM_LIMIT) d.onPlayerHp(0);
      }
    }
  }
  for (const a of d.run.augments) bump(report.augmentUse, a.id);
  report.victory = d.phase === 'won';
  report.rooms = d.run.history.length;
  report.seconds = ticks * TICK;
  return report;
}
