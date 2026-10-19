import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import patches from '../data/patches.json' with { type: 'json' };

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rootVersion: string = JSON.parse(read('../../package.json')).version;

test('the newest patch-notes entry matches the root package version', () => {
  assert.equal(patches[0]?.version, rootVersion);
});

test('client/package.json has the same version as the root', () => {
  assert.equal(JSON.parse(read('../../client/package.json')).version, rootVersion);
});

test('README line 1 carries the same version', () => {
  const first = read('../../README.md').split('\n')[0];
  assert.equal(first, `# Conflux · v${rootVersion}`);
});

test('versions stay below 1.0', () => {
  assert.equal(rootVersion.split('.')[0], '0');
});

test('patch entries have date, an ISO time and notes, newest first', () => {
  assert.ok(patches.length > 0);
  for (const p of patches) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(p.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(Array.isArray(p.notes) && p.notes.length > 0);
  }
  const key = (v: string) => v.split('.').map(Number);
  for (let i = 1; i < patches.length; i++) {
    const [a, b] = [key(patches[i - 1].version), key(patches[i].version)];
    const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    assert.ok(newer > 0, `entry ${i} is not older than entry ${i - 1}`);
  }
});
