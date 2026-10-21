import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxLines, capsuleLines } from '../src/dev/debugDraw.ts';
import { enemyHurtboxes, hurtboxesFor, spawnEnemy } from '@conflux/shared';
import { defaultData, Sim } from '@conflux/shared';

test('a box is 12 edges and a capsule is two rings and four struts', () => {
  assert.equal(boxLines({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }).length, 12 * 2 * 3);
  const c = capsuleLines({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 1.5, z: 0 }, 0.4);
  assert.ok(c.length > 0 && c.length % 6 === 0, 'whole segments');
  const ys = c.filter((_, i) => i % 3 === 1);
  assert.ok(Math.min(...ys) >= 0.5 - 1e-9 && Math.max(...ys) <= 1.5 + 1e-9, 'the rings sit at the capsule ends');
});

test('hurtboxesFor (used by the debug view on snapshots) matches the sim\'s own hurtboxes', () => {
  const sim = new Sim(defaultData(), 1);
  const e = spawnEnemy(sim, 'enemy.dummy', { x: 3, y: 0, z: 4 });
  e.facing = 1.1;
  assert.deepEqual(hurtboxesFor(e.def, e.pos, e.facing, e.id), enemyHurtboxes(e));
});
