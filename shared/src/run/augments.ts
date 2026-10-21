// Augments: data entries that reshape a skill (or a reaction). They are applied as pure functions over the skill's data, in the
// order they were found, so the same skill and the same augments always give the same result.
import type { AugmentDef, AugmentOp, ReactionDef, SkillDef } from '../types.ts';
import type { OwnedAugment } from './run.ts';

/** Sockets on one skill. */
export const MAX_SOCKETS = 3;
export const HOOKS = ['explode', 'pierce', 'extraStream'] as const;

export function canSocket(skillId: string, owned: readonly OwnedAugment[]): boolean {
  return owned.filter((a) => a.skill === skillId).length < MAX_SOCKETS;
}

const matchesSkill = (t: AugmentDef['target'], s: SkillDef): boolean => (t.skill ? t.skill === s.id : t.tag ? s.tags.includes(t.tag) : t.element ? t.element === s.element : false);
const matchesReaction = (t: AugmentDef['target'], r: ReactionDef): boolean => !!t.reaction && (t.reaction === r.id || t.reaction === r.effect);

function resolve(value: AugmentOp['value'], def: AugmentDef, rarity: OwnedAugment['rarity']): number | string | boolean | undefined {
  if (typeof value !== 'string') return value;
  const m = /^\$rarity\.(\w+)$/.exec(value);
  if (!m) return value;
  const v = def.rarity[rarity]?.[m[1]];
  if (typeof v !== 'number') throw new Error(`augment ${def.id}: no number "${m[1]}" at ${rarity}`);
  return v;
}

function walk(root: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } {
  const segs = path.split('.');
  let cur = root;
  for (const s of segs.slice(0, -1)) {
    if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  }
  return { parent: cur, key: segs[segs.length - 1] };
}

/** Applies one augment's ops to a copy-in-place target. */
function applyOps(target: Record<string, unknown>, def: AugmentDef, rarity: OwnedAugment['rarity']): void {
  for (const op of def.ops) {
    const value = resolve(op.value, def, rarity);
    if (op.op === 'hook') {
      const shape = (target.shape ??= {}) as Record<string, number | undefined>;
      const n = typeof value === 'number' ? value : 1;
      if (op.hook === 'explode') shape.explode = n;
      else if (op.hook === 'pierce') shape.pierce = (shape.pierce ?? 0) + n;
      else if (op.hook === 'extraStream') shape.count = (shape.count ?? 1) + n;
      else throw new Error(`augment ${def.id}: unknown hook "${op.hook}"`);
      continue;
    }
    if (!op.path) throw new Error(`augment ${def.id}: an op has no path`);
    const { parent, key } = walk(target, op.path);
    const now = typeof parent[key] === 'number' ? (parent[key] as number) : 0;
    if (op.op === 'add') parent[key] = now + Number(value);
    else if (op.op === 'mul') parent[key] = now * Number(value);
    else parent[key] = value;
  }
}

/** The skill as the owned augments leave it. The input is never changed. */
export function applyAugments(skill: SkillDef, owned: readonly OwnedAugment[], defs: Record<string, AugmentDef>): SkillDef {
  const out = structuredClone(skill) as unknown as Record<string, unknown>;
  for (const a of owned) {
    const def = defs[a.id];
    if (def && def.kind !== 'reaction' && matchesSkill(def.target, skill)) applyOps(out, def, a.rarity);
  }
  return out as unknown as SkillDef;
}

/** A reaction's numbers as the owned reaction augments leave them. */
export function applyReactionAugments(row: ReactionDef, owned: readonly OwnedAugment[], defs: Record<string, AugmentDef>): Record<string, number> {
  const holder = { params: { ...row.params } } as Record<string, unknown>;
  for (const a of owned) {
    const def = defs[a.id];
    if (def && def.kind === 'reaction' && matchesReaction(def.target, row)) applyOps(holder, def, a.rarity);
  }
  return holder.params as Record<string, number>;
}

/** The skill an augment fills a socket of when it is claimed, or '*' for a passive. */
export const socketFor = (def: AugmentDef): string => def.target.skill ?? '*';
