// The dev panel's commands to the simulation. Pacing (pause, step, timescale) lives in SimRunner; everything that changes the
// game lands here, and marks the run as tuned so it never counts toward unlocks.
import { resolveAim } from '../aim.ts';
import { validateData } from '../data.ts';
import type { SimRunner, DevCommand } from '../bridge.ts';
import { ELEMENTS, RARITIES, STATUS_IDS, type GameData, type Rarity, type StatusId } from '../types.ts';
import { canSocket, socketFor } from '../run/augments.ts';
import { aimDir, v3, type Vec3 } from '../math.ts';
import { damageEnemy } from './skills.ts';
import { runAttack } from './attacks.ts';
import { applyStatus } from './statuses.ts';
import { enemyHurtboxes, spawnEnemy } from './state.ts';
import type { Sim } from './sim.ts';

const MAX_SPAWN = 50;
/** How far ahead of the player spawned enemies go when the crosshair is not on anything solid. */
const SKY_SPAWN_DISTANCE = 8;

/** Where the crosshair points on the ground or an enemy, or a short way ahead of the player when it points at the sky. */
function crosshair(sim: Sim): { point: Vec3; enemyId: number | null } {
  const i = sim.lastInput;
  const p = sim.player;
  const origin = i?.camOrigin ?? { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z };
  const yaw = i?.aimYaw ?? 0;
  const pitch = i?.aimPitch ?? 0;
  const aim = resolveAim(sim.world, sim.enemies.flatMap((e) => enemyHurtboxes(e)), origin, yaw, pitch, sim.data.player.maxAimRange);
  if (aim.hitWorld || aim.hitEnemy !== null) return { point: aim.point, enemyId: aim.hitEnemy };
  const ahead = v3.add(p.pos, v3.scale(aimDir(yaw, 0), SKY_SPAWN_DISTANCE));
  return { point: ahead, enemyId: null };
}

function spawnAt(sim: Sim, enemy: string, count: number, at: unknown): string | null {
  if (!sim.data.enemies[enemy]) return `unknown enemy ${enemy}`;
  if (!Number.isInteger(count) || count < 1 || count > MAX_SPAWN) return `count must be 1 to ${MAX_SPAWN}`;
  const centre = at && typeof at === 'object' ? (at as Vec3) : crosshair(sim).point;
  for (let k = 0; k < count; k++) {
    // a spiral so a crowd is spread out rather than stacked
    const angle = k * 2.4;
    const radius = k === 0 ? 0 : 1.4 * Math.sqrt(k);
    const x = centre.x + Math.cos(angle) * radius;
    const z = centre.z + Math.sin(angle) * radius;
    spawnEnemy(sim, enemy, { x, y: sim.world.groundAt(x, z), z });
  }
  return null;
}

const isStatus = (v: unknown): v is StatusId => (STATUS_IDS as readonly unknown[]).includes(v);

/** Applies one sim-level dev command. Returns null, or why it was refused. */
export function applyDevCommand(sim: Sim, cmd: DevCommand): string | null {
  const done = (err: string | null) => {
    if (!err) sim.tuned = true;
    return err;
  };
  switch (cmd.op) {
    case 'spawn':
      return done(spawnAt(sim, String(cmd.enemy), cmd.count === undefined ? 1 : Number(cmd.count), cmd.at === 'crosshair' ? undefined : cmd.at));
    case 'spawnDummy': {
      if (cmd.status !== undefined && !isStatus(cmd.status)) return `unknown status ${String(cmd.status)}`;
      const before = sim.enemies.length;
      const err = spawnAt(sim, 'enemy.dummy', 1, cmd.at === 'crosshair' ? undefined : cmd.at);
      if (err) return err;
      if (cmd.status) applyStatus(sim, sim.enemies[before], cmd.status, sim.time);
      return done(null);
    }
    case 'forceAttack': {
      // starts an attack now whatever its cooldown (a mob's AI may never pick it), aimed at the player
      const e = cmd.enemy === undefined ? sim.enemies[0] : sim.enemies.find((o) => o.id === cmd.enemy);
      if (!e) return `no enemy ${String(cmd.enemy)}`;
      const id = String(cmd.attack);
      if (!sim.data.attacks[id]) return `unknown attack ${id}`;
      if (e.attack) return 'that enemy is busy with an attack';
      delete e.cooldowns[id];
      runAttack(sim, e, id, sim.player.pos);
      return done(null);
    }
    case 'killAll':
      for (const e of [...sim.enemies]) damageEnemy(sim, e, e.hp, 'dev.killAll', e.pos);
      return done(null);
    case 'giveSkill': {
      const s = sim.data.skills[String(cmd.skill)];
      if (!s) return `unknown skill ${String(cmd.skill)}`;
      sim.player.loadout[s.element][s.slot] = s.id;
      return done(null);
    }
    case 'giveAugment': {
      const def = sim.data.augments[String(cmd.id)];
      if (!def) return `unknown augment ${String(cmd.id)}`;
      if (!(RARITIES as readonly unknown[]).includes(cmd.rarity)) return `unknown rarity ${String(cmd.rarity)}`;
      const socket = socketFor(def);
      if (socket !== '*' && !canSocket(socket, sim.augments)) return `${socket} has no free socket`;
      sim.setAugments([...sim.augments, { id: def.id, rarity: cmd.rarity as Rarity, skill: socket }]);
      return done(null);
    }
    case 'setElement': {
      const i = Number(cmd.i);
      if (!Number.isInteger(i) || i < 0 || i >= ELEMENTS.length) return `unknown element ${String(cmd.i)}`;
      // holding a benched element takes over the slot of the one held now
      if (!sim.player.equipped.includes(ELEMENTS[i])) sim.player.equipped[sim.player.equipped.indexOf(ELEMENTS[sim.player.element])] = ELEMENTS[i];
      sim.player.element = i;
      return done(null);
    }
    case 'applyStatus': {
      if (!isStatus(cmd.id)) return `unknown status ${String(cmd.id)}`;
      const target = crosshair(sim).enemyId;
      const enemy = target === null ? undefined : sim.enemies.find((e) => e.id === target);
      applyStatus(sim, enemy ?? sim.player, cmd.id, sim.time);
      return done(null);
    }
    case 'teleport': {
      const x = Number(cmd.x);
      const z = Number(cmd.z);
      if (typeof cmd.x !== 'number' || typeof cmd.z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return 'teleport needs numbers x and z';
      sim.player.pos = { x, y: 0, z };
      return done(null);
    }
    case 'god':
      sim.god = cmd.on === true;
      return done(null);
    case 'noCooldowns':
      sim.noCooldowns = cmd.on === true;
      return done(null);
    case 'setData': {
      const next = cmd.data as GameData;
      let errors: string[];
      try {
        errors = validateData(next);
      } catch {
        return 'that is not game data';
      }
      if (errors.length) return `that data is not valid: ${errors[0]}`;
      Object.assign(sim.data, structuredClone(next));
      for (const e of sim.enemies) e.def = sim.data.enemies[e.def.id] ?? e.def;
      return done(null);
    }
    default:
      return `unknown dev command ${String(cmd.op)}`;
  }
}

/** Connects the commands to a runner. `rebuild` makes a fresh sim for a room restart or a new seed. */
export function installDevCommands(runner: SimRunner, rebuild: (seed: number) => Sim): void {
  runner.setCommandHandler((cmd) => {
    if (cmd.op === 'restartRoom') runner.replaceSim(rebuild(runner.sim.seed));
    else if (cmd.op === 'setSeed' && Number.isInteger(cmd.seed)) runner.replaceSim(rebuild(cmd.seed as number));
    else applyDevCommand(runner.sim, cmd);
  });
}
