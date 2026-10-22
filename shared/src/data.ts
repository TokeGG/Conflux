// Turns the raw JSON files into GameData and checks it. Entries keyed by id in their file get that id as a field.
import { ELEMENTS, STATUS_IDS, SLOTS, SHAPE_TYPES, CAST_ARCHETYPES, AI_ARCHETYPES, RIG_TYPES, ATTACK_TEMPLATES, type GameData } from './types.ts';

const KEYED = ['skills', 'augments', 'enemies', 'attacks', 'rooms', 'biomes', 'elites', 'unlocks', 'themes'] as const;
const SECTIONS = ['player', 'camera', 'animation', 'elements', 'statuses', 'reactions', 'rewards', ...KEYED] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Builds GameData from the parsed data files (a deep copy, so callers may change it freely). */
export function loadData(raw: Record<string, unknown>): GameData {
  for (const name of SECTIONS) if (raw[name] === undefined) throw new Error(`missing data section "${name}"`);
  for (const name of ['player', 'camera', 'animation', 'elements', 'statuses', 'rewards', 'reactions', ...KEYED] as const) {
    if (!isObject(raw[name])) throw new Error(`data section "${name}" must be an object`);
  }
  const copy = structuredClone(raw) as Record<string, any>;
  const reactions = copy.reactions as { cooldown: number; rows: unknown[] };
  if (typeof reactions.cooldown !== 'number' || !Array.isArray(reactions.rows)) throw new Error('data section "reactions" needs a cooldown and rows');
  for (const name of KEYED) for (const [key, entry] of Object.entries(copy[name] as Record<string, any>)) entry.id = key;
  return {
    player: copy.player,
    camera: copy.camera,
    animation: copy.animation,
    elements: copy.elements,
    statuses: copy.statuses,
    reactionCooldown: reactions.cooldown,
    reactions: reactions.rows as GameData['reactions'],
    skills: copy.skills,
    augments: copy.augments,
    enemies: copy.enemies,
    attacks: copy.attacks,
    rooms: copy.rooms,
    biomes: copy.biomes,
    elites: copy.elites,
    unlocks: copy.unlocks,
    themes: copy.themes,
    rewards: copy.rewards,
  } as GameData;
}

export interface ValidationContext {
  fxIds?: Set<string>;
  modelIds?: Set<string>;
  clipNames?: Set<string>;
}

const has = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** Returns every problem found; an empty array means the data is valid. */
export function validateData(d: GameData, ctx: ValidationContext = {}): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  // elements
  for (const el of ELEMENTS) {
    const c = d.elements.cycle[el];
    if (!c) err(`elements.cycle is missing ${el}`);
    else for (const list of ['weak', 'resist'] as const) for (const x of c[list]) if (!has(ELEMENTS, x)) err(`elements.cycle.${el}.${list} has "${x}", which is not an element`);
    const s = d.elements.status[el];
    if (s !== null && !has(STATUS_IDS, s)) err(`elements.status.${el} is "${s}", which is not a status`);
  }
  for (const s of STATUS_IDS) if (!d.statuses[s]) err(`statuses is missing ${s}`);

  // reactions: one row for every pair of different elements, in either order
  const seenRows = new Set<string>();
  const seenPairs = new Set<string>();
  for (const el of ELEMENTS) {
    const r = d.elements.reacts?.[el];
    if (!has(STATUS_IDS, r)) err(`elements.reacts.${el} is "${r}", which is not a status`);
    else if (d.elements.status[el] && d.elements.status[el] !== r) err(`elements.reacts.${el} must be the element's own status (${d.elements.status[el]})`);
  }
  for (const r of d.reactions) {
    if (seenRows.has(r.id)) err(`duplicate reaction row id ${r.id}`);
    seenRows.add(r.id);
    const [a, b] = r.pair ?? [];
    if (!has(ELEMENTS, a) || !has(ELEMENTS, b)) err(`reaction ${r.id}: pair must be two elements`);
    else if (a === b) err(`reaction ${r.id}: a pair needs two different elements`);
    else {
      const key = [a, b].sort().join('|');
      if (seenPairs.has(key)) err(`duplicate reaction for the pair ${a} and ${b}`);
      seenPairs.add(key);
    }
    if (!r.effect) err(`reaction ${r.id}: it needs an effect`);
  }
  for (const a of ELEMENTS) {
    for (const b of ELEMENTS) {
      if (a < b && !seenPairs.has([a, b].sort().join('|'))) err(`reaction table is missing the pair ${a} and ${b}: every pair of elements needs a reaction`);
    }
  }

  // camera and animation
  const cam = d.camera;
  if (!(cam.distance > 0) || !(cam.fov > 0 && cam.fov < 180)) err('camera: distance and field of view must be positive');
  if (!(cam.pitchMin < 0 && cam.pitchMax > 0)) err('camera: the look limits must be one below and one above the horizon');
  for (const [rig, a] of Object.entries(d.animation.rigs)) {
    for (const [state, clip] of Object.entries({ ...a.states, ...a.cast })) if (typeof clip !== 'string' || !clip) err(`animation ${rig}: "${state}" needs a clip name`);
    for (const arch of CAST_ARCHETYPES) if (!a.cast[arch]) err(`animation ${rig}: no clip for the "${arch}" archetype`);
    if (!(a.transition >= 0) || !(a.castBlendRate > 0)) err(`animation ${rig}: blend times must be positive`);
  }

  // skills
  for (const [key, s] of Object.entries(d.skills)) {
    const c = s.cast;
    if (c && c.blend !== undefined && !(c.blend >= 0 && c.blend <= 1)) err(`skill ${key}: cast blend must be 0 to 1`);
    if (c && c.fireAt !== undefined && !(c.fireAt >= 0 && c.fireAt <= 1)) err(`skill ${key}: cast fireAt must be 0 to 1`);
  }
  for (const [key, s] of Object.entries(d.skills)) {
    if (!has(ELEMENTS, s.element)) err(`skill ${key}: element "${s.element}" is not an element`);
    else if (!key.startsWith(`${s.element}.`)) err(`skill ${key}: id must start with "${s.element}."`);
    if (!has(SLOTS, s.slot)) err(`skill ${key}: slot "${s.slot}" is not a slot`);
    if (!has(SHAPE_TYPES, s.shape?.type)) err(`skill ${key}: shape type "${s.shape?.type}" is not a shape`);
    if (s.applies !== null && !has(STATUS_IDS, s.applies)) err(`skill ${key}: applies "${s.applies}" is not a status`);
    if (!has(CAST_ARCHETYPES, s.cast?.archetype)) err(`skill ${key}: cast archetype "${s.cast?.archetype}" is not an archetype`);
    if (!(s.damage >= 0)) err(`skill ${key}: damage must be 0 or more`);
    if (!(s.cooldown >= 0)) err(`skill ${key}: cooldown must be 0 or more`);
    if (ctx.clipNames && !ctx.clipNames.has(s.cast?.clip)) err(`skill ${key}: cast clip "${s.cast?.clip}" does not exist`);
    if (ctx.fxIds) for (const [slot, id] of Object.entries(s.fx ?? {})) if (!ctx.fxIds.has(id)) err(`skill ${key}: fx ${slot} "${id}" does not exist`);
  }

  // attacks
  for (const [key, a] of Object.entries(d.attacks)) {
    if (!has(ATTACK_TEMPLATES, a.template)) err(`attack ${key}: template "${a.template}" is not a template`);
    if (a.applies && !has(STATUS_IDS, a.applies)) err(`attack ${key}: applies "${a.applies}" is not a status`);
  }

  // enemies
  for (const [key, e] of Object.entries(d.enemies)) {
    if (e.element !== 'none' && !has(ELEMENTS, e.element)) err(`enemy ${key}: element "${e.element}" is not an element`);
    for (const list of ['weak', 'resist'] as const) for (const x of e[list]) if (!has(ELEMENTS, x)) err(`enemy ${key}: ${list} has "${x}", which is not an element`);
    for (const x of e.immune ?? []) if (!has(STATUS_IDS, x)) err(`enemy ${key}: immune has "${x}", which is not a status`);
    if (!has(AI_ARCHETYPES, e.ai)) err(`enemy ${key}: ai "${e.ai}" is not an archetype`);
    if (!has(RIG_TYPES, e.rig?.type)) err(`enemy ${key}: rig type "${e.rig?.type}" is not a rig type`);
    if (!(e.hp > 0)) err(`enemy ${key}: hp must be above 0`);
    if (!(e.cost >= 0)) err(`enemy ${key}: cost must be 0 or more`);
    if (e.aura) {
      const why = auraError(e.aura);
      if (why) err(`enemy ${key}: aura ${why}`);
    }
    for (const a of e.attacks) if (!d.attacks[a]) err(`enemy ${key}: attack "${a}" does not exist`);
    if (ctx.modelIds && !ctx.modelIds.has(e.model)) err(`enemy ${key}: model "${e.model}" does not exist`);
  }

  // augments
  for (const [key, a] of Object.entries(d.augments)) {
    if (a.target.skill && !d.skills[a.target.skill]) err(`augment ${key}: target skill "${a.target.skill}" does not exist`);
    if (a.target.element && !has(ELEMENTS, a.target.element)) err(`augment ${key}: target element "${a.target.element}" is not an element`);
    if (!['stat', 'behavior', 'reaction'].includes(a.kind)) err(`augment ${key}: kind "${a.kind}" is not a kind`);
    if (!a.target.skill && !a.target.tag && !a.target.element && !a.target.reaction) err(`augment ${key}: it targets nothing`);
    if (a.target.reaction && !d.reactions.some((r) => r.id === a.target.reaction || r.effect === a.target.reaction)) err(`augment ${key}: target reaction "${a.target.reaction}" does not exist`);
    for (const op of a.ops) {
      if (!['add', 'mul', 'set', 'hook'].includes(op.op)) err(`augment ${key}: op "${op.op}" is not an op`);
      if (op.op === 'hook' ? !op.hook || !['explode', 'pierce', 'extraStream'].includes(op.hook) : !op.path) err(`augment ${key}: an op needs ${op.op === 'hook' ? 'a known hook' : 'a path'}`);
      const m = typeof op.value === 'string' ? /^\$rarity\.(\w+)$/.exec(op.value) : null;
      if (m) for (const r of ['common', 'rare', 'epic'] as const) if (typeof a.rarity?.[r]?.[m[1]] !== 'number') err(`augment ${key}: ${r} has no number "${m[1]}" for ${op.value}`);
    }
  }

  // rooms and biomes
  for (const [key, r] of Object.entries(d.rooms)) if (!d.biomes[r.biome]) err(`room ${key}: biome "${r.biome}" does not exist`);
  for (const [key, b] of Object.entries(d.biomes)) {
    for (const r of b.rooms) if (!d.rooms[r]) err(`biome ${key}: room "${r}" does not exist`);
    for (const e of b.enemyPool) if (!d.enemies[e]) err(`biome ${key}: enemy "${e}" does not exist`);
    for (const e of b.bosses ?? []) if (!d.enemies[e]) err(`biome ${key}: boss "${e}" does not exist`);
  }

  for (const [key, m] of Object.entries(d.elites)) {
    if (!['fire_aura', 'burning_trail', 'haste', 'extra_guard'].includes(key)) err(`elite ${key}: there is no behaviour for it`);
    if (!m.name) err(`elite ${key}: it needs a name`);
    for (const [k, v] of Object.entries(m.params ?? {})) if (typeof v !== 'number') err(`elite ${key}: ${k} must be a number`);
  }

  for (const [key, a] of Object.entries(d.unlocks)) {
    if (!a.name) err(`achievement ${key}: it needs a name`);
    if (!(a.atLeast > 0)) err(`achievement ${key}: atLeast must be above 0`);
    for (const s of a.unlocks.skills ?? []) if (!d.skills[s]) err(`achievement ${key}: skill "${s}" does not exist`);
    for (const x of a.unlocks.augments ?? []) if (!d.augments[x]) err(`achievement ${key}: augment "${x}" does not exist`);
  }

  for (const [key, t] of Object.entries(d.themes)) {
    const bad = (m: string) => err(`theme ${key}: ${m}`);
    if (!(t.weight > 0)) bad('weight must be above 0');
    if (!(t.cells[0] >= 3 && t.cells[1] >= t.cells[0])) bad('cells must be two numbers, the first at least 3 and the second not smaller');
    if (!t.floor.tex.length) bad('the floor needs at least one texture');
    if (!t.wall.tex.length) bad('the walls need at least one texture');
    if (!t.wall.gates.length) bad('it needs at least one gate piece');
    for (const pool of ['set', 'medium', 'small', 'wall'] as const) if (!t.pools[pool]?.length) bad(`its ${pool} pool is empty`);
    for (const p of Object.values(t.pools).flat()) if (!(p.scale > 0) || !(p.count[1] >= p.count[0]) || p.count[0] < 0) bad(`${p.kit}/${p.id} has a bad scale or count`);
    if (!Object.keys(t.mobs).length) bad('it needs mobs');
    for (const b of t.boss ?? []) if (!d.enemies[b]) bad(`boss "${b}" does not exist`);
    for (const [m, w] of Object.entries(t.mobs)) {
      if (!d.enemies[m]) bad(`mob "${m}" does not exist`);
      if (!(w > 0)) bad(`mob "${m}" needs a weight above 0`);
    }
  }

  const eco = d.rewards.economy;
  if (!eco) err('rewards.economy is missing');
  else {
    for (const k of ['skill', 'augment', 'heal', 'element'] as const) if (!(eco.price[k] >= 0)) err(`rewards.economy.price.${k} must be 0 or more`);
    for (const r of ['common', 'rare', 'epic'] as const) if (!(eco.rarityMul[r] > 0)) err(`rewards.economy.rarityMul.${r} must be above 0`);
    if (!(eco.pickupRadius > 0) || !(eco.interactReach > 0)) err('rewards.economy needs a pickupRadius and an interactReach above 0');
    if (!(eco.depthScale >= 0) || !(eco.eliteSoulsMul >= 1)) err('rewards.economy needs a depthScale of 0 or more and an eliteSoulsMul of 1 or more');
  }
  for (const [key, e] of Object.entries(d.enemies)) if (e.souls !== undefined && !(e.souls >= 0)) err(`enemy ${key}: souls must be 0 or more`);
  if (!(d.rewards.offers > 0)) err('rewards.offers must be above 0');
  if (!(d.rewards.scaling.hpPerRoom >= 0) || !(d.rewards.scaling.damagePerRoom >= 0)) err('rewards.scaling needs hpPerRoom and damagePerRoom of 0 or more');
  return errors;
}


/** Why a boss aura is not usable, or null: a hex colour, a light that is faint (0 to 30) and a reach of 1 to 20 m. */
export function auraError(a: { color?: unknown; intensity?: unknown; radius?: unknown }): string | null {
  if (typeof a.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.color)) return 'colour must be a #rrggbb string';
  if (typeof a.intensity !== 'number' || !(a.intensity >= 0 && a.intensity <= 30)) return 'intensity must be 0 to 30';
  if (typeof a.radius !== 'number' || !(a.radius >= 1 && a.radius <= 20)) return 'radius must be 1 to 20';
  return null;
}
