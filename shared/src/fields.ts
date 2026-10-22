// The editable catalogue: which values of the game data the dev panel may change, with plain-words labels, units and bounds.
// A value that is not matched here cannot be patched.
import { CAST_ARCHETYPES } from './types.ts';

export interface FieldInfo {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Omitted for numbers. 'text' is a short name (a clip): max is its longest length, min 0 allows it to be empty. */
  kind?: 'boolean' | 'text';
  /** For text: the only values allowed. */
  oneOf?: readonly string[];
  /** True when the data file may not have the value at all (an optional setting): a patch then creates it, and `fallback` is what the game uses without it. */
  optional?: boolean;
  fallback?: number;
}

const n = (label: string, unit: string, min: number, max: number, step: number): FieldInfo => ({ label, unit, min, max, step });
const text = (label: string, max = 80, allowEmpty = false): FieldInfo => ({ label, unit: '', min: allowEmpty ? 0 : 1, max, step: 1, kind: 'text' });
const optional = (info: FieldInfo, fallback: number): FieldInfo => ({ ...info, optional: true, fallback });
const yesNo = (label: string): FieldInfo => ({ label, unit: '', min: 0, max: 1, step: 1, kind: 'boolean' });

const SHAPE: Record<string, FieldInfo> = {
  speed: n('Speed', 'm/s', 0, 100, 0.5),
  radius: n('Radius', 'm', 0, 30, 0.05),
  gravity: n('Gravity', 'm/s²', -30, 60, 0.5),
  lifetime: n('Lifetime', 's', 0, 30, 0.05),
  angle: n('Angle', '°', 1, 360, 1),
  range: n('Range', 'm', 0, 100, 0.5),
  width: n('Width', 'm', 0, 30, 0.1),
  length: n('Length', 'm', 0, 60, 0.5),
  height: n('Height', 'm', 0, 30, 0.1),
  tick: n('Tick interval', 's', 0.05, 5, 0.05),
  duration: n('Duration', 's', 0, 60, 0.1),
  count: n('Count', '', 1, 20, 1),
  distance: n('Distance', 'm', 0, 60, 0.5),
  absorb: n('Absorb', 'hp', 0, 1000, 1),
  damageTakenMul: n('Damage taken', '×', 0, 5, 0.05),
  speedMul: n('Move speed', '×', 0, 3, 0.05),
  explode: n('Explosion radius', 'm', 0, 10, 0.1),
  pierce: n('Passes through', 'enemies', 0, 10, 1),
  trailRadius: n('Trail width', 'm', 0, 10, 0.1),
  trailSeconds: n('Trail time', 's', 0, 30, 0.1),
};

const REACTION_PARAM: Record<string, FieldInfo> = {
  radius: n('Radius', 'm', 0, 30, 0.5),
  damageMul: n('Damage', '× hit', 0, 10, 0.05),
  blindSeconds: n('Blind time', 's', 0, 30, 0.5),
  brittleSeconds: n('Brittle time', 's', 0, 30, 0.5),
  damageTakenMul: n('Damage taken', '×', 0.1, 5, 0.05),
  speedMul: n('Move speed', '×', 0, 3, 0.05),
  slowSeconds: n('Slow time', 's', 0, 30, 0.5),
  slowMul: n('Slow', '× speed', 0, 1, 0.05),
  rootSeconds: n('Root time', 's', 0, 30, 0.5),
  jumps: n('Chain jumps', '', 0, 10, 1),
  seconds: n('Duration', 's', 0, 30, 0.1),
  liftSeconds: n('Time the target is lifted', 's', 0, 10, 0.1),
  zoneRadius: n('Tornado radius', 'm', 0, 30, 0.5),
  drift: n('Drift speed', 'm/s', 0, 20, 0.5),
  dps: n('Damage per second', 'hp/s', 0, 500, 1),
  stunSeconds: n('Stun time', 's', 0, 10, 0.1),
  healPercentPerSecond: n('Healing', '% of health per s', 0, 50, 0.5),
  spreadBurning: n('Spreads burning', '0 or 1', 0, 1, 1),
  perStack: n('Extra damage per poison stack', '× hit', 0, 5, 0.05),
  rate: n('Speed-up', '×', 1, 10, 0.1),
  armourSeconds: n('Armour break time', 's', 0, 30, 0.5),
  grow: n('Growth', 'm/s', 0, 5, 0.1),
  count: n('Targets', '', 1, 10, 1),
  pull: n('Pull', 'm/s', 0, 20, 0.5),
  cloudRadius: n('Cloud radius', 'm', 0, 30, 0.5),
  strikeEvery: n('Bolt every', 's', 0.1, 10, 0.1),
  strikeDamage: n('Bolt damage', 'hp', 0, 200, 1),
  passes: n('Times the arc fires', '', 1, 5, 1),
  hits: n('Hits per target', '', 1, 10, 1),
  length: n('Beam length', 'm', 0, 60, 1),
  width: n('Beam width', 'm', 0, 10, 0.1),
  fraction: n('Share replayed', 'of damage', 0, 5, 0.05),
  ramp: n('Extra damage taken per second', '×/s', 0, 1, 0.01),
  cap: n('Most extra damage taken', '×', 0, 5, 0.05),
  healPerStack: n('Healing per poison stack', 'hp', 0, 100, 0.5),
  damageTakenPerStack: n('Damage taken per stack', '×', 0, 1, 0.01),
  maxStacks: n('Most stacks', '', 1, 20, 1),
  heal: n('Healed of damage dealt', '', 0, 2, 0.01),
};

const STATUS: Record<string, FieldInfo> = {
  duration: n('Duration', 's', 0.1, 120, 0.1),
  tickDamage: n('Damage per tick', 'hp', 0, 100, 0.5),
  tickInterval: n('Tick interval', 's', 0.1, 5, 0.1),
  spreadRadius: n('Spread radius', 'm', 0, 20, 0.5),
  speedMul: n('Move speed', '×', 0, 3, 0.05),
  damageTakenMul: n('Damage taken', '×', 0.1, 5, 0.05),
  damageDealtMul: n('Damage dealt', '×', 0, 3, 0.05),
  maxStacks: n('Most stacks', '', 1, 20, 1),
  canAct: yesNo('Can act'),
};

const ATTACK: Record<string, FieldInfo> = {
  damage: n('Damage', 'hp', 0, 1000, 1),
  windup: n('Windup', 's', 0, 10, 0.05),
  cooldown: n('Cooldown', 's', 0, 60, 0.1),
  range: n('Range', 'm', 0, 100, 0.5),
  radius: n('Radius', 'm', 0, 30, 0.1),
  angle: n('Angle', '°', 1, 360, 1),
  speed: n('Speed', 'm/s', 0, 100, 0.5),
};

const EXACT: Record<string, FieldInfo> = {
  'player.health': n('Health', 'hp', 1, 1000, 1),
  'player.moveSpeed': n('Move speed', 'm/s', 1, 20, 0.1),
  'player.radius': n('Body radius', 'm', 0.1, 1, 0.05),
  'player.maxAimRange': n('Max aim range', 'm', 10, 200, 1),
  'player.dodge.duration': n('Dodge length', 's', 0.1, 2, 0.05),
  'player.dodge.invulnerable': n('Dodge invulnerable time', 's', 0, 2, 0.05),
  'player.dodge.cooldown': n('Dodge cooldown', 's', 0, 10, 0.05),
  'player.dodge.speed': n('Dodge speed', 'm/s', 1, 30, 0.5),
  'player.jump.speed': n('Jump speed', 'm/s', 1, 20, 0.1),
  'player.jump.gravity': n('Jump gravity', 'm/s²', 1, 60, 0.5),
  'player.dashSpeed': n('Dash skill speed', 'm/s', 5, 60, 0.5),
  'player.swap.cooldown': n('Element swap cooldown', 's', 0, 5, 0.05),
  'player.swap.bonusWindow': n('Swap-in bonus window', 's', 0, 10, 0.1),
  'player.swap.bonusDamage': n('Swap-in bonus damage', '×', 1, 3, 0.05),
  'player.cast.windupMove': n('Move speed while winding up', '×', 0, 1, 0.05),
  'player.cast.channelMove': n('Move speed while channelling', '×', 0, 1, 0.05),
  'camera.distance': n('Camera distance', 'm', 0.5, 15, 0.1),
  'camera.shoulder': n('Camera shoulder offset', 'm', -3, 3, 0.05),
  'camera.height': n('Camera pivot height', 'm', 0, 4, 0.05),
  'camera.collisionRadius': n('Camera wall clearance', 'm', 0.05, 1, 0.05),
  'camera.fov': n('Field of view', '°', 30, 110, 1),
  'camera.pitchMin': n('Look down limit', 'rad', -1.55, 0, 0.05),
  'camera.pitchMax': n('Look up limit', 'rad', 0, 1.55, 0.05),
  'camera.followRate': n('Camera smoothing (0 = rigid)', 'per s', 0, 60, 0.5),
  'camera.mouseSensitivity': n('Mouse sensitivity', 'rad per pixel', 0.0003, 0.01, 0.0001),
  'elements.multipliers.weak': n('Damage to a weakness', '×', 1, 5, 0.05),
  'elements.multipliers.resist': n('Damage to a resistance', '×', 0, 1, 0.05),
  reactionCooldown: n('Reaction cooldown per enemy', 's', 0, 10, 0.05),
  'rewards.offers': n('Offers per reward', '', 1, 6, 1),
  'rewards.healFraction': n('Heal reward', 'of max health', 0, 1, 0.05),
  'rewards.guaranteeSkillByRoom': n('A skill offer by room', '', 1, 20, 1),
  'rewards.scaling.hpPerRoom': n('Enemy health per room', '× per room', 0, 1, 0.01),
  'rewards.scaling.damagePerRoom': n('Enemy damage per room', '× per room', 0, 1, 0.01),
  'rewards.economy.pickupRadius': n('Soul pickup radius', 'm', 0.5, 10, 0.1),
  'rewards.economy.eliteSoulsMul': n('Elite souls', '×', 1, 10, 0.5),
  'rewards.economy.depthScale': n('Price rise per floor', '× base', 0, 3, 0.05),
  'rewards.economy.restHeal': n('Rest room heal', 'of max health', 0, 1, 0.05),
  'rewards.economy.shrineTradeHp': n('Shrine trade: health', 'of max health', 0, 0.9, 0.05),
  'rewards.economy.shrineTradeSouls': n('Shrine trade: souls', '', 0, 1000, 5),
  'rewards.economy.interactReach': n('Reach to buy', 'm', 0.5, 10, 0.1),
  'rewards.rarity.early.until': n('Early rarity until room', '', 1, 20, 1),
};

const PATTERNS: [RegExp, (m: RegExpExecArray) => FieldInfo | undefined][] = [
  [/^statuses\.[a-z]+\.(\w+)$/, (m) => STATUS[m[1]]],
  [/^reactions\..+\.params\.(\w+)$/, (m) => REACTION_PARAM[m[1]]],
  [/^skills\..+\.damage$/, () => n('Damage', 'hp', 0, 1000, 1)],
  [/^skills\..+\.statusChance$/, () => n('Status chance', '', 0, 1, 0.05)],
  [/^skills\..+\.cooldown$/, () => n('Cooldown', 's', 0, 60, 0.05)],
  [/^animation\.rigs\.\w+\.states\.\w+$/, () => text('Clip for this state')],
  [/^animation\.rigs\.\w+\.cast\.\w+$/, () => text('Clip for this cast archetype')],
  [/^animation\.rigs\.\w+\.transition$/, () => n('Blend between moves', 's', 0, 1, 0.01)],
  [/^animation\.rigs\.\w+\.castBlendRate$/, () => n('Upper-body cast blend speed', 'per s', 1, 60, 0.5)],
  [/^skills\..+\.cast\.clip$/, () => text('Cast clip (empty: the archetype\'s)', 80, true)],
  [/^skills\..+\.cast\.archetype$/, () => ({ ...text('Cast archetype'), oneOf: CAST_ARCHETYPES })],
  [/^skills\..+\.cast\.blend$/, () => optional(n('Upper-body blend', '0 to 1', 0, 1, 0.05), 1)],
  [/^skills\..+\.cast\.fireAt$/, () => optional(n('Fires at (share of the clip, 0 = play at normal speed)', 'of clip', 0, 1, 0.01), 0)],
  [/^enemies\..+\.rig\.clips\.\w+(?:\.\d+)?$/, () => text('Clip for this mob state')],
  [/^skills\..+\.cast\.windup$/, () => n('Windup', 's', 0, 5, 0.01)],
  [/^skills\..+\.cast\.move$/, () => n('Move speed while casting', '×', 0, 1, 0.05)],
  [/^skills\..+\.shape\.(\w+)$/, (m) => SHAPE[m[1]]],
  [/^augments\..+\.rarity\.(?:common|rare|epic)\.(\w+)$/, (m) => n(`Augment value: ${m[1]}`, '', -1000, 1000, 0.1)],
  [/^enemies\..+\.hp$/, () => n('Health', 'hp', 1, 100000, 1)],
  [/^enemies\..+\.speed$/, () => n('Move speed', 'm/s', 0, 30, 0.1)],
  [/^enemies\..+\.cost$/, () => n('Encounter cost', '', 0, 50, 1)],
  [/^enemies\..+\.souls$/, () => n('Souls dropped', '', 0, 500, 1)],
  [/^enemies\..+\.scale$/, () => n('Model scale', '×', 0.1, 10, 0.05)],
  [/^enemies\..+\.guard\.reduction$/, () => n('Guard damage reduction', '', 0, 1, 0.05)],
  [/^enemies\..+\.guard\.(onFor|offFor|staggerOnWeak)$/, (m) => n({ onFor: 'Guard up for', offFor: 'Guard down for', staggerOnWeak: 'Stagger on weakness' }[m[1]]!, 's', 0, 60, 0.1)],
  [/^enemies\..+\.hurtboxes\.\d+\.r$/, () => n('Hurtbox radius', 'm', 0.05, 5, 0.05)],
  [/^enemies\..+\.hurtboxes\.\d+\.[ab]\.\d+$/, () => n('Hurtbox point', 'm', -20, 20, 0.05)],
  [/^enemies\..+\.aura\.intensity$/, () => n('Aura light', '', 0, 30, 0.5)],
  [/^enemies\..+\.aura\.radius$/, () => n('Aura reach', 'm', 1, 20, 0.5)],
  [/^enemies\..+\.phases\.\d+$/, () => n('Phase threshold', 'of health', 0, 1, 0.01)],
  [/^elites\.[a-z_]+\.params\.(\w+)$/, (m) => n(`Elite: ${m[1]}`, '', 0, 100, 0.1)],
  [/^attacks\..+\.summon\.count$/, () => n('Summoned enemies', '', 1, 20, 1)],
  [/^attacks\..+\.summon\.cap$/, () => n('Most summoned alive', '', 1, 50, 1)],
  [/^attacks\..+\.(\w+)$/, (m) => ATTACK[m[1]]],
  [/^rewards\.economy\.price\.(?:skill|augment|heal|element)$/, () => n('Base price', 'souls', 0, 5000, 5)],
  [/^rewards\.economy\.rarityMul\.(?:common|rare|epic)$/, () => n('Price by rarity', '×', 0.1, 10, 0.1)],
  [/^rewards\.rarity\.(?:early|late)\.weights\.(?:common|rare|epic)$/, () => n('Rarity weight', '', 0, 100, 1)],
];

/** The catalogue entry for a dotted path, or null when the value is not editable. */
export function fieldFor(path: string): FieldInfo | null {
  if (EXACT[path]) return EXACT[path];
  for (const [re, make] of PATTERNS) {
    const m = re.exec(path);
    if (m) return make(m) ?? null;
  }
  return null;
}
