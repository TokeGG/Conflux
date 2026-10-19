import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveAsset, licenceReport, type AssetEntry, type LicenceEntry } from '../src/assets.ts';
import { buildManifest } from '../../scripts/gen-manifest.ts';
import { checkLicences } from '../../scripts/check-licences.ts';

const dir = fileURLToPath(new URL('../../client/public/assets/', import.meta.url));
const manifest: AssetEntry[] = JSON.parse(readFileSync(dir + 'assets.json', 'utf8'));
const licences: LicenceEntry[] = JSON.parse(readFileSync(dir + 'licenses.json', 'utf8')).entries;
const quiet = () => {};

test('every file named in the manifest exists under client/public/assets', () => {
  assert.ok(manifest.length > 400, `only ${manifest.length} assets`);
  for (const a of manifest) for (const [profile, f] of Object.entries(a.files)) assert.ok(existsSync(dir + f), `${a.id} (${profile}): ${f} is missing`);
});

test('ids are unique and look like kind.name', () => {
  const ids = manifest.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z]+\.[a-z0-9_.-]+$/, id);
});

test('the key assets have ids', () => {
  const ids = new Set(manifest.map((a) => a.id));
  for (const id of ['model.golem', 'model.maw', 'model.reaper', 'model.treegolem', 'model.stump', 'model.oldwizard', 'model.wizardpack', 'model.staff_fire', 'clip.wizardpack.cast_1h_magic_attack_02', 'clip.oldwizard.loco_standing_idle', 'fx.fireball_travel', 'fx.steam_puff', 'env.forest.tree', 'data.fx', 'data.env', 'data.clips.wizardpack']) assert.ok(ids.has(id), `missing ${id}`);
});

test('resolveAsset returns the profile file, falls back to chunky, and names an unknown id', () => {
  const m: AssetEntry[] = [{ id: 'model.a', files: { chunky: 'models/a.glb', better: 'models/a_hi.glb' }, licence: 'x' }, { id: 'model.b', files: { chunky: 'models/b.glb' }, licence: 'x' }];
  assert.equal(resolveAsset(m, 'model.a', 'chunky'), 'models/a.glb');
  assert.equal(resolveAsset(m, 'model.a', 'better'), 'models/a_hi.glb');
  assert.equal(resolveAsset(m, 'model.b', 'better'), 'models/b.glb', 'a profile without its own file falls back to chunky');
  assert.throws(() => resolveAsset(m, 'model.nope', 'chunky'), /model\.nope/);
});

test('licenceReport lists the unverified assets from the real licenses.json', () => {
  const r = licenceReport(manifest, licences);
  for (const id of ['model.treegolem', 'model.reaper', 'model.wizardpack']) assert.ok(r.unverified.includes(id), `${id} should be unverified`);
  assert.ok(!r.unverified.includes('model.golem'));
  assert.ok(!r.unverified.includes('model.oldwizard'));
  assert.deepEqual(r.missing, [], 'every asset is covered by a licence entry');
});

test('licenceReport flags an asset whose licence entry does not exist', () => {
  const r = licenceReport([{ id: 'model.x', files: { chunky: 'x' }, licence: 'nowhere/' }], licences);
  assert.deepEqual(r.missing, ['model.x']);
});

test('checkLicences warns (exit 0) in warn mode and fails (non-zero) in enforce mode while assets are unverified', () => {
  assert.equal(checkLicences('warn', dir, quiet), 0);
  assert.notEqual(checkLicences('enforce', dir, quiet), 0);
});

test('assets.json is up to date with the files on disk', () => {
  assert.deepEqual(buildManifest(dir), manifest);
});

test('the manifest does not list its own bookkeeping files', () => {
  const files = manifest.flatMap((a) => Object.values(a.files));
  for (const f of files) assert.ok(!/(^|\/)(assets\.json|licenses\.json|README\.md)$/.test(f), f);
});
