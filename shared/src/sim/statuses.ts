// Statuses: timed conditions on the player or an enemy. Applying one again refreshes it; it never stacks.
import type { GameData, StatusId } from '../types.ts';
import { STATUS_IDS } from '../types.ts';
import { MARK_IDS } from './state.ts';
import { damageEnemy } from './skills.ts';
import type { EnemyState, PlayerState } from './state.ts';
import type { Sim } from './sim.ts';

export type Combatant = PlayerState | EnemyState;

const EPS = 1e-9;
const isEnemy = (c: Combatant): c is EnemyState => 'def' in c;

/** Starts the status at full duration, or does nothing when the target is immune to it. */
export function applyStatus(sim: Sim, target: Combatant, id: StatusId, now: number): void {
  if (isEnemy(target) && target.def.immune?.includes(id)) return;
  target.statuses[id] = { until: now + sim.data.statuses[id].duration };
}

/** Runs one tick of damage over time and spreading, then drops the statuses that have run out. */
export function tickStatuses(sim: Sim, target: Combatant, dt: number): void {
  const now = sim.time;
  const prev = now - dt;
  const burning = target.statuses.burning;
  const cfg = sim.data.statuses.burning;
  if (burning && cfg.tickInterval && cfg.tickInterval > 0) {
    const start = burning.until - cfg.duration;
    const interval = cfg.tickInterval;
    // the burn lands at start + k * interval for k = 1, 2, ...; fire every one this tick crossed
    const first = Math.floor((prev - start + EPS) / interval) + 1;
    const last = Math.floor((now - start + EPS) / interval);
    for (let k = Math.max(1, first); k <= last; k++) {
      if (start + k * interval > burning.until + EPS) break;
      burnTick(sim, target, cfg.tickDamage ?? 0, cfg.spreadRadius ?? 0, burning.until);
      if (isEnemy(target) && target.hp <= 0) return;
    }
  }
  for (const id of STATUS_IDS) {
    const s = target.statuses[id];
    if (s && now >= s.until - EPS) delete target.statuses[id];
  }
  for (const id of MARK_IDS) {
    const m = target.marks[id];
    if (m && now >= m.until - EPS) delete target.marks[id];
  }
}

function burnTick(sim: Sim, target: Combatant, damage: number, spread: number, until: number): void {
  if (isEnemy(target)) damageEnemy(sim, target, damage, 'status.burning', target.pos);
  else sim.hurtPlayer(damage);
  if (!isEnemy(target) || spread <= 0 || until - sim.time <= EPS) return; // the last tick of a fire spreads nothing
  for (const other of sim.enemies) {
    if (other === target || other.def.immune?.includes('burning')) continue;
    if (Math.hypot(other.pos.x - target.pos.x, other.pos.z - target.pos.z) > spread) continue;
    // a spread flame inherits the source's end time, so fire passing back and forth cannot outlast the first ignition
    const have = other.statuses.burning?.until ?? 0;
    if (have < until) other.statuses.burning = { until };
  }
}

/** What a target's active statuses do to its speed, the damage it takes and whether it can act. */
export function statusModifiers(target: Combatant, now: number, cfg: GameData['statuses']): { speedMul: number; damageTakenMul: number; canAct: boolean } {
  let speedMul = 1;
  let damageTakenMul = 1;
  let canAct = true;
  for (const id of STATUS_IDS) {
    const s = target.statuses[id];
    if (!s || now >= s.until - EPS) continue;
    const def = cfg[id];
    speedMul *= def.speedMul ?? 1;
    damageTakenMul *= def.damageTakenMul ?? 1;
    if (def.canAct === false) canAct = false;
  }
  for (const id of MARK_IDS) {
    const m = target.marks[id];
    if (!m || now >= m.until - EPS) continue;
    speedMul *= m.speedMul ?? 1;
    damageTakenMul *= m.damageTakenMul ?? 1;
    if (m.canAct === false) canAct = false;
  }
  return { speedMul, damageTakenMul, canAct };
}
