import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextVersion, applyBump } from '../../scripts/bump.ts';

function fixture(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'conflux-bump-'));
  mkdirSync(join(dir, 'client'));
  mkdirSync(join(dir, 'shared/data'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'conflux', version }, null, 2) + '\n');
  writeFileSync(join(dir, 'client/package.json'), JSON.stringify({ name: '@conflux/client', version }, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# Conflux · v${version}\n\nbody\n`);
  writeFileSync(join(dir, 'shared/data/patches.json'), JSON.stringify([{ version, date: '2026-10-16', at: '2026-10-16T10:00:00Z', notes: ['old'] }]));
  return dir;
}

test('nextVersion raises only the last number', () => {
  assert.equal(nextVersion('0.1.0'), '0.1.1');
  assert.equal(nextVersion('0.1.9'), '0.1.10');
});

test('nextVersion refuses anything that is not three numbers', () => {
  assert.throws(() => nextVersion('0.1'), /version/i);
  assert.throws(() => nextVersion('v0.1.0'), /version/i);
});

test('applyBump updates root, client, README line 1 and puts a new entry first', () => {
  const dir = fixture('0.1.0');
  applyBump(dir, 'Added the thing.', new Date('2026-10-17T20:24:05Z'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '0.1.1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'client/package.json'), 'utf8')).version, '0.1.1');
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8').split('\n')[0], '# Conflux · v0.1.1');
  assert.ok(readFileSync(join(dir, 'README.md'), 'utf8').includes('\nbody\n'));
  const patches = JSON.parse(readFileSync(join(dir, 'shared/data/patches.json'), 'utf8'));
  assert.deepEqual(patches[0], { version: '0.1.1', date: '2026-10-17', at: '2026-10-17T20:24:05Z', notes: ['Added the thing.'] });
  assert.equal(patches[1].version, '0.1.0');
});

test('applyBump refuses an empty note and changes nothing', () => {
  const dir = fixture('0.1.0');
  assert.throws(() => applyBump(dir, '   ', new Date()), /note/i);
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '0.1.0');
});
