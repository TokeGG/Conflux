import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { genCredits, genWiki, type LicenseEntry } from '../src/wiki.ts';
import { defaultData } from '../src/files.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('WIKI.md is up to date: run `npm run wiki` after changing skills, augments, reactions, statuses or enemies', () => {
  assert.equal(read('../../WIKI.md'), genWiki(defaultData()));
});

test('the wiki lists every skill, augment, reaction row, status and enemy', () => {
  const data = defaultData();
  const wiki = genWiki(data);
  for (const id of [...Object.keys(data.skills), ...Object.keys(data.augments), ...Object.keys(data.enemies)]) assert.ok(wiki.includes(`\`${id}\``), `${id} is missing`);
  for (const r of data.reactions) assert.ok(wiki.includes(`\`${r.id}\``), `${r.id} is missing`);
  for (const s of Object.keys(data.statuses)) assert.ok(wiki.includes(`\`${s}\``), `${s} is missing`);
});

test('the wiki is the same every time it is generated', () => {
  assert.equal(genWiki(defaultData()), genWiki(defaultData()));
});

test('the credits list every CC-BY asset with its author, title and link', () => {
  const entries: LicenseEntry[] = JSON.parse(read('../../client/public/assets/licenses.json')).entries;
  const ccby = entries.filter((e) => e.license.startsWith('CC-BY'));
  assert.ok(ccby.length >= 5);
  const credits = genCredits(entries);
  for (const e of ccby) {
    assert.ok(credits.includes(e.author), `${e.author} is missing`);
    assert.ok(credits.includes(e.title), `${e.title} is missing`);
    assert.ok(credits.includes(e.source), `${e.source} is missing`);
  }
});

test('the credits do not list assets that need no credit', () => {
  const credits = genCredits([
    { path: 'a.glb', title: 'Credit me', author: 'Ann', license: 'CC-BY-4.0', verified: true, source: 'https://x/a' },
    { path: 'b.glb', title: 'Free thing', author: 'Bob', license: 'CC0', verified: true, source: 'https://x/b' },
  ]);
  assert.ok(credits.includes('Credit me') && !credits.includes('Free thing'));
});
