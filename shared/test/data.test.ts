import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData, validateData, type ValidationContext } from '../src/data.ts';
import { DATA_FILES, defaultData } from '../src/files.ts';
import { ELEMENTS, STATUS_IDS, BTN } from '../src/types.ts';

const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const fxIds = new Set<string>(json('../data/fxIds.json'));
const clipNames = new Set<string>(json('../../client/public/assets/clips/wizardpack/index.json').clips.map((c: { name: string }) => c.name));
const ctx: ValidationContext = { fxIds, clipNames, modelIds: new Set((json('../../client/public/assets/assets.json') as { id: string }[]).filter((a) => a.id.startsWith('model.')).map((a) => a.id)) };
const fresh = () => structuredClone(defaultData());

test('the shipped data loads and validates with no errors', () => {
  assert.deepEqual(validateData(defaultData(), ctx), []);
});

test('validation without a context skips the asset checks and still passes', () => {
  assert.deepEqual(validateData(defaultData()), []);
});

test('a skill whose applies is "frozen" is flagged with the skill id and the bad value', () => {
  const d = fresh();
  (d.skills['fire.fireball'] as { applies: string | null }).applies = 'frozen';
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => e.includes('fire.fireball') && e.includes('frozen')), errors.join('\n'));
});

test('an enemy weak entry that is not an element is flagged', () => {
  const d = fresh();
  d.enemies['enemy.dummy'].weak = ['lava' as never];
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => e.includes('enemy.dummy') && e.includes('lava')), errors.join('\n'));
});

test('a reaction table missing the ordered pair (soaked, wind) is flagged', () => {
  const d = fresh();
  d.reactions = d.reactions.filter((r) => !(r.existing === 'soaked' && r.hitBy === 'wind'));
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => e.includes('soaked') && e.includes('wind')), errors.join('\n'));
});

test('an enemy whose model id is not in ctx.modelIds is flagged', () => {
  const d = fresh();
  d.enemies['enemy.dummy'].model = 'model.nope';
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => e.includes('enemy.dummy') && e.includes('model.nope')), errors.join('\n'));
});

test('a skill that points at an unknown effect or clip is flagged', () => {
  const d = fresh();
  d.skills['fire.fireball'].fx.hit = 'fx.no_such_effect';
  d.skills['fire.fireball'].cast.clip = 'no_such_clip';
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => e.includes('fx.no_such_effect')));
  assert.ok(errors.some((e) => e.includes('no_such_clip')));
});

test('duplicate reaction row ids are flagged', () => {
  const d = fresh();
  d.reactions.push({ ...d.reactions[0] });
  const errors = validateData(d, ctx);
  assert.ok(errors.some((e) => /duplicate/i.test(e) && e.includes(d.reactions[0].id)), errors.join('\n'));
});

test('an enemy attack id that does not exist is flagged', () => {
  const d = fresh();
  d.enemies['enemy.dummy'].attacks = ['atk.nope'];
  assert.ok(validateData(d, ctx).some((e) => e.includes('atk.nope')));
});

test('an augment that targets a skill that does not exist is flagged', () => {
  const d = fresh();
  const first = Object.values(d.augments)[0];
  first.target = { skill: 'fire.missing' };
  assert.ok(validateData(d, ctx).some((e) => e.includes('fire.missing')));
});

test('loadData names the missing section', () => {
  const { skills: _skills, ...rest } = DATA_FILES as unknown as Record<string, unknown>;
  assert.throws(() => loadData(rest), /skills/);
});

test('loadData gives every keyed entry its id', () => {
  const d = defaultData();
  for (const [key, s] of Object.entries(d.skills)) assert.equal(s.id, key);
  for (const [key, e] of Object.entries(d.enemies)) assert.equal(e.id, key);
});

test('fxIds.json lists exactly the effects in fx.json', () => {
  const fx: { effects: { id: string }[] } = json('../../client/public/assets/fx/spellwoven/fx.json');
  assert.deepEqual([...fxIds].sort(), fx.effects.map((e) => `fx.${e.id}`).sort());
});

test('the spec numbers are in the data files', () => {
  const d = defaultData();
  assert.deepEqual([d.player.health, d.player.moveSpeed], [100, 6]);
  assert.deepEqual([d.player.dodge.duration, d.player.dodge.invulnerable, d.player.dodge.cooldown], [0.4, 0.25, 1.2]);
  assert.deepEqual([d.player.swap.cooldown, d.player.swap.bonusWindow, d.player.swap.bonusDamage], [0.4, 3, 1.25]);
  assert.deepEqual([d.player.cast.windupMove, d.player.cast.channelMove], [0.7, 0.5]);
  assert.deepEqual([d.statuses.burning.duration, d.statuses.soaked.duration, d.statuses.rocked.duration, d.statuses.gusted.duration], [5, 8, 8, 1.2]);
  assert.equal(d.statuses.soaked.speedMul, 0.85);
  assert.equal(d.statuses.rocked.damageTakenMul, 1.15);
  assert.deepEqual([d.elements.multipliers.weak, d.elements.multipliers.resist], [1.5, 0.5]);
  assert.equal(d.reactionCooldown, 0.75);
});

test('the weakness cycle is fire to water, water to earth, earth to wind, wind to fire', () => {
  const c = defaultData().elements.cycle;
  assert.deepEqual([c.fire.weak, c.water.weak, c.earth.weak, c.wind.weak], [['water'], ['earth'], ['wind'], ['fire']]);
  assert.deepEqual([c.fire.resist, c.water.resist, c.earth.resist, c.wind.resist], [['wind'], ['fire'], ['water'], ['earth']]);
});

test('there are 12 reaction rows and 10 distinct effects', () => {
  const rows = defaultData().reactions;
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map((r) => r.effect)).size, 10);
});

test('constants: four elements, four statuses, button bits are distinct', () => {
  assert.deepEqual([...ELEMENTS], ['fire', 'water', 'earth', 'wind']);
  assert.deepEqual([...STATUS_IDS], ['burning', 'soaked', 'rocked', 'gusted']);
  const bits = Object.values(BTN);
  assert.equal(new Set(bits).size, bits.length);
  assert.deepEqual(bits, [1, 2, 4, 8, 16, 32]);
});

test('the rewards file holds the rarity weights and the skill guarantee from the spec', () => {
  const r = defaultData().rewards;
  assert.equal(r.offers, 3);
  assert.deepEqual(r.rarity.early, { until: 3, weights: { common: 70, rare: 27, epic: 3 } });
  assert.deepEqual(r.rarity.late.weights, { common: 40, rare: 45, epic: 15 });
  assert.equal(r.guaranteeSkillByRoom, 3);
});
