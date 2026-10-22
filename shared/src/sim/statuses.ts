// Statuses: timed conditions on the player or an enemy. Applying one again refreshes it; a stacking status (poison) also gains a stack.
import type { GameData, StatusId } from '../types.ts';
import { STATUS_IDS } from '../types.ts';
import { MARK_IDS } from './state.ts';
import { damageEnemy } from './skills.ts';
import type { EnemyState, PlayerState } from './state.ts';
import type { Sim } from './sim.ts';

export type Combatant = PlayerState | EnemyState;

const EPS = 1e-9;
/** Damage-over-time marks land this often. */
const MARK_TICK = 0.5;
const isEnemy = (c: Combatant): c is EnemyState => 'def' in c;

/** Starts the status at full duration, or does nothing when the target is immune to it. A stacking status gains a stack. */
export function applyStatus(sim: Sim, target: Combatant, id: StatusId, now: number): void {
  if (isEnemy(target) && (target.def.immune?.includes(id) || (target.def.element !== 'none' && sim.data.elements.status[target.def.element] === id))) return; // immune to its own element's status
  const cfg = sim.data.statuses[id];
  if (cfg.maxStacks) {
    const cur = target.statuses[id];
    const have = cur && cur.until > now + EPS ? cur.stacks ?? 1 : 0;
    target.statuses[id] = { until: now + cfg.duration, stacks: Math.min(cfg.maxStacks, have + 1) };
    return;
  }
  target.statuses[id] = { until: now + cfg.duration };
}

/** Runs one tick of damage over time and spreading, then drops the statuses that have run out. */
export function tickStatuses(sim: Sim, target: Combatant, dt: number): void {
  const now = sim.time;
  const prev = now - dt;
  for (const id of STATUS_IDS) {
    const st = target.statuses[id];
    const cfg = sim.data.statuses[id];
    if (!st || !cfg.tickInterval || cfg.tickInterval <= 0 || !cfg.tickDamage) continue;
    const start = st.until - cfg.duration;
    const interval = cfg.tickInterval;
    // the damage lands at start + k * interval for k = 1, 2, ...; fire every one this tick crossed
    const first = Math.floor((prev - start + EPS) / interval) + 1;
    const last = Math.floor((now - start + EPS) / interval);
    for (let k = Math.max(1, first); k <= last; k++) {
      if (start + k * interval > st.until + EPS) break;
      statusTick(sim, target, id, cfg.tickDamage * (st.stacks ?? 1), id === 'burning' ? cfg.spreadRadius ?? 0 : 0, st.until);
      if (isEnemy(target) && target.hp <= 0) return;
    }
  }
  const overheat = target.marks.overheat;
  const burning = target.statuses.burning;
  if (isEnemy(target) && overheat && burning && now < overheat.until && now < burning.until && (overheat.rate ?? 1) > 1) {
    // a burn that runs faster lands extra ticks between the normal ones
    const cfg = sim.data.statuses.burning;
    const gap = (cfg.tickInterval ?? 0.5) / ((overheat.rate ?? 1) - 1);
    overheat.nextTick ??= now + gap;
    while (now >= overheat.nextTick - EPS && overheat.nextTick < burning.until) {
      overheat.nextTick += gap;
      damageEnemy(sim, target, cfg.tickDamage ?? 0, 'status.overheat', target.pos);
      if (target.hp <= 0) return;
    }
  }
  if (isEnemy(target)) {
    for (const id of MARK_IDS) {
      const m = target.marks[id];
      if (!m || !m.dps) continue;
      m.nextTick ??= now + MARK_TICK;
      while (now >= m.nextTick - EPS && m.nextTick <= m.until + EPS) {
        m.nextTick += MARK_TICK;
        damageEnemy(sim, target, m.dps * MARK_TICK, `mark.${id}`, target.pos);
        if (target.hp <= 0) return;
      }
    }
  }
  const haste = target.marks.haste;
  if (!isEnemy(target) && haste && now < haste.until && (haste.rate ?? 1) > 1) {
    // the player's skills come back faster: every cooldown running down is pushed on by the extra share of this tick
    for (const k of Object.keys(target.cooldowns)) if (target.cooldowns[k] > now) target.cooldowns[k] -= dt * ((haste.rate ?? 1) - 1);
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

function statusTick(sim: Sim, target: Combatant, id: StatusId, damage: number, spread: number, until: number): void {
  if (isEnemy(target)) damageEnemy(sim, target, damage, `status.${id}`, target.pos);
  else sim.hurtPlayer(damage); // lastHurtBy stays on whatever set the player alight
  if (!isEnemy(target) || spread <= 0 || until - sim.time <= EPS) return; // the last tick of a fire spreads nothing
  for (const other of sim.enemies) {
    if (other === target || other.def.immune?.includes(id)) continue;
    if (Math.hypot(other.pos.x - target.pos.x, other.pos.z - target.pos.z) > spread) continue;
    // a spread flame inherits the source's end time, so fire passing back and forth cannot outlast the first ignition
    const have = other.statuses[id]?.until ?? 0;
    if (have < until) other.statuses[id] = { until };
  }
}

/** What a target's active statuses do to its speed, the damage it takes and deals, and whether it can act. */
export function statusModifiers(target: Combatant, now: number, cfg: GameData['statuses']): { speedMul: number; damageTakenMul: number; damageDealtMul: number; canAct: boolean } {
  let speedMul = 1;
  let damageTakenMul = 1;
  let damageDealtMul = 1;
  let canAct = true;
  for (const id of STATUS_IDS) {
    const s = target.statuses[id];
    if (!s || now >= s.until - EPS) continue;
    const def = cfg[id];
    speedMul *= def.speedMul ?? 1;
    damageTakenMul *= def.damageTakenMul ?? 1;
    damageDealtMul *= def.damageDealtMul ?? 1;
    if (def.canAct === false) canAct = false;
  }
  for (const id of MARK_IDS) {
    const m = target.marks[id];
    if (!m || now >= m.until - EPS) continue;
    speedMul *= m.speedMul ?? 1;
    damageTakenMul *= m.damageTakenMul ?? 1;
    if (m.ramp) damageTakenMul *= 1 + Math.min(m.cap ?? Infinity, m.ramp * Math.max(0, now - (m.since ?? now)));
    if (m.canAct === false) canAct = false;
  }
  return { speedMul, damageTakenMul, damageDealtMul, canAct };
}
