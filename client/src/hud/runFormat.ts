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
  if (o.kind === 'element') {
    return { title: cap(o.element ?? ''), tag: 'New element', detail: 'Takes over one of your three element keys. The one it replaces waits on the bench, skills and augments kept.' };
  }
  if (o.kind === 'augment') {
    const a = o.id ? data.augments[o.id] : undefined;
    return { title: a?.name ?? o.id ?? 'Augment', tag: `${cap(o.rarity ?? 'common')} augment`, detail: a ? augmentFor(a.target) : '' };
  }
  const pct = Math.round(data.rewards.healFraction * 100 * ({ common: 1, rare: 1.5, epic: 2 }[o.rarity ?? 'common']));
  return { title: 'Heal', tag: `${cap(o.rarity ?? 'common')} heal`, detail: `Restores ${pct}% of your health.` };
}

export interface ComboLine {
  /** The element you hold that this one combines with. */
  with: string;
  text: string;
}

const words = (id: string) => id.split('_').map(cap).join(' ');

/** What `element` combines into with each element in `held`, so the player can see what to mix. Either order reacts; each pair is one line. */
export function elementCombos(element: string, held: readonly string[], data: GameData): ComboLine[] {
  const lines: ComboLine[] = [];
  for (const other of held) {
    if (other === element) continue;
    const row = data.reactions.find((r) => (r.pair[0] === element && r.pair[1] === other) || (r.pair[0] === other && r.pair[1] === element));
    if (!row) continue;
    lines.push({ with: other, text: `${words(row.effect)} (either order)` });
  }
  return lines;
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

export interface GateText {
  kind: 'fight' | 'elite' | 'boss';
  title: string;
  sub: string;
}

const STYLE_NAME: Record<string, string> = { bonepit: 'Bone pit', cellar: 'Cellar', prison: 'Prison', grove: 'Grove', chapel: 'Chapel', crypt: 'Crypt', hall: 'Hall', cave: 'Cave', ember: 'Ember cavern', flooded: 'Flooded cave', library: 'Library', arena: 'Arena' };

/** The label hung above a gate: where it leads and what you get for going there. */
export function describeGate(d: DoorChoice, data: GameData): GateText {
  const style = STYLE_NAME[d.biome] ?? cap(d.biome);
  const kind = d.room.type === 'boss' ? 'boss' : d.room.type === 'elite' ? 'elite' : 'fight';
  const reward = { skill: 'a skill', augment: 'an augment', heal: 'healing', element: 'an element' }[d.reward] ?? d.reward;
  return { kind, title: kind === 'boss' ? `Boss: ${style}` : kind === 'elite' ? `Elite ${style}` : style, sub: `Reward: ${reward}` };
}

export function endSummary(run: RunState, bestToday = 0): { headline: string; lines: string[] } {
  const rooms = run.history.length;
  const lines = [`${rooms} ${rooms === 1 ? 'room' : 'rooms'} cleared`, `${run.skills.pool.length} skills, ${run.augments.length} augments`];
  if (run.daily) lines.push('Daily run', rooms >= bestToday && rooms > 0 ? `New best today: ${rooms} ${rooms === 1 ? 'room' : 'rooms'}` : `Best today: ${bestToday} ${bestToday === 1 ? 'room' : 'rooms'}`);
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
