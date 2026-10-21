// A stable hash of the simulation state, used to prove two runs are identical. Numbers are rounded to 1e-4 first.
import type { MarkMap, EnemyState, PlayerState, Projectile, Zone } from './state.ts';
import type { StatusMap } from '../types.ts';

export interface HashState {
  tick: number;
  rng: number[][];
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: Projectile[];
  zones: Zone[];
}

const r4 = (n: number) => Math.round(n * 1e4);

function fnv(s: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const statuses = (m: StatusMap) => Object.keys(m).sort().map((k) => `${k}:${r4((m as Record<string, { until: number }>)[k].until)}`).join(',');
const vec = (v: { x: number; y: number; z: number }) => `${r4(v.x)},${r4(v.y)},${r4(v.z)}`;
const marks = (m: MarkMap) => Object.keys(m).sort().map((k) => { const v = (m as Record<string, { until: number; speedMul?: number; damageTakenMul?: number; canAct?: boolean }>)[k]; return `${k}:${r4(v.until)}:${r4(v.speedMul ?? 1)}:${r4(v.damageTakenMul ?? 1)}:${+(v.canAct ?? true)}`; }).join(',');
const rec = (o: Record<string, number>) => Object.keys(o).sort().map((k) => `${k}:${r4(o[k])}`).join(',');

export function stateHash(s: HashState): string {
  const p = s.player;
  const parts: string[] = [
    `t${s.tick}`,
    `rng${s.rng.map((w) => w.join('.')).join('/')}`,
    `p|${vec(p.pos)}|${vec(p.vel)}|${r4(p.facing)}|${r4(p.hp)}|${statuses(p.statuses)}|${marks(p.marks)}|${r4(p.dodgeUntil)}|${r4(p.invulnUntil)}|${r4(p.dodgeReadyAt)}|${p.element}|${r4(p.swapReadyAt)}|${p.castState ? `${p.castState.skillId}:${r4(p.castState.until)}:${r4(p.castState.move)}:${r4(p.castState.fireAt ?? 0)}:${+!!p.castState.fired}:${r4(p.castState.nextTick ?? 0)}:${p.castState.aim ? vec(p.castState.aim) : '-'}` : '-'}|${rec(p.cooldowns)}|${r4(p.swapBonusUntil)}|${p.buff ? `${p.buff.skillId}:${r4(p.buff.until)}:${r4(p.buff.absorb)}` : '-'}`,
  ];
  for (const e of s.enemies) {
    const g = e.guard ? `${+e.guard.on}:${r4(e.guard.until)}:${r4(e.guard.staggeredUntil)}` : '-';
    parts.push(`e|${e.id}|${e.def.id}|${vec(e.pos)}|${r4(e.facing)}|${r4(e.hp)}|${statuses(e.statuses)}|${marks(e.marks)}|${e.aiState}|${g}|${rec(e.cooldowns)}|${e.attack ? `${e.attack.attackId}:${r4(e.attack.hitAt)}:${r4(e.attack.yaw)}:${e.attack.phase}:${r4(e.attack.remaining)}:${+e.attack.hit}` : '-'}`);
  }
  for (const q of s.projectiles) parts.push(`j|${q.id}|${q.skillId}|${vec(q.pos)}|${vec(q.vel)}|${r4(q.diesAt)}`);
  for (const z of s.zones) parts.push(`z|${z.id}|${z.kind}|${vec(z.pos)}|${r4(z.radius)}|${r4(z.until)}|${r4(z.yaw)}|${r4(z.nextTick)}|${JSON.stringify(z.effects ?? {})}`);
  const text = parts.join('\n');
  return fnv(text, 2166136261).toString(16).padStart(8, '0') + fnv(text, 40503).toString(16).padStart(8, '0');
}
