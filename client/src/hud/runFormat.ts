// The words on the run screens, kept apart from the DOM so they can be tested.
import type { DoorChoice, GameData, RewardOffer, RunState } from '@conflux/shared';
import { skillLabel } from './format.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface OfferText {
  title: string;
  tag: string;
  detail: string;
}

function augmentFor(t: { skill?: string; tag?: string; element?: string; reaction?: string }): string {
  if (t.skill) return `Socket in ${skillLabel(t.skill)}`;
  if (t.reaction) return `Strengthens the ${t.reaction.replace(/_/g, ' ')} reaction`;
  if (t.element) return `Passive for ${t.element} skills`;
  return t.tag ? `Passive for ${t.tag} skills` : '';
}

export function describeOffer(o: RewardOffer, data: GameData): OfferText {
  if (o.kind === 'skill') {
    const id = o.id ?? '';
    return { title: skillLabel(id), tag: `${cap(o.element ?? data.skills[id]?.element ?? '')} skill`, detail: data.skills[id] ? `${data.skills[id].slot} slot, ${data.skills[id].shape.type}` : '' };
  }
  if (o.kind === 'augment') {
    const a = o.id ? data.augments[o.id] : undefined;
    return { title: a?.name ?? o.id ?? 'Augment', tag: `${cap(o.rarity ?? 'common')} augment`, detail: a ? augmentFor(a.target) : '' };
  }
  const pct = Math.round(data.rewards.healFraction * 100 * ({ common: 1, rare: 1.5, epic: 2 }[o.rarity ?? 'common']));
  return { title: 'Heal', tag: `${cap(o.rarity ?? 'common')} heal`, detail: `Restores ${pct}% of your health.` };
}

export interface DoorText {
  reward: string;
  biome: string;
  badge: string;
}

export function describeDoor(d: DoorChoice, data: GameData): DoorText {
  return {
    reward: cap(d.reward),
    biome: cap(d.biome),
    badge: d.room.type === 'boss' ? 'Boss' : d.room.type === 'elite' ? 'Elite' : '',
  };
}

export function endSummary(run: RunState): { headline: string; lines: string[] } {
  const rooms = run.history.length;
  const lines = [`${rooms} ${rooms === 1 ? 'room' : 'rooms'} cleared`, `${run.skills.pool.length} skills, ${run.augments.length} augments`];
  if (run.tuned) lines.push('This run used tuned numbers, so it does not count toward unlocks.');
  return { headline: run.status === 'victory' ? 'Victory' : 'You fell', lines };
}

/** One line per achievement earned: its name and what it opened. */
export function achievementLines(ids: string[], data: GameData): string[] {
  return ids.flatMap((id) => {
    const a = data.unlocks[id];
    if (!a) return [];
    const names = [...(a.unlocks.skills ?? []).map(skillLabel), ...(a.unlocks.augments ?? []).map((x) => data.augments[x]?.name ?? x)];
    return [`${a.name}: unlocked ${names.join(', ')}`];
  });
}
