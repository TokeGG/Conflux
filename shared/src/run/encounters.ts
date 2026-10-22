// Filling a room with enemies: spend a budget on enemy costs from the biome's pool.
import type { Vec3 } from '../math.ts';
import type { Rng } from '../rng.ts';
import type { BiomeDef, EnemyDef } from '../types.ts';

const MAX_ENEMIES = 40;
const RING_RADIUS = 6;
const JITTER = 1.2;

/**
 * Enemies for a room. Spends at most `budget`, except that a room is never empty: when even the cheapest enemy costs more
 * than the budget, that one enemy comes anyway. Positions come from the room's spawn points, or a ring when none are given.
 */
export function encounterFor(budget: number, biome: Pick<BiomeDef, 'id' | 'enemyPool'>, enemies: Record<string, EnemyDef>, rng: Rng, spots: Vec3[] = [], weights?: Record<string, number>, maxEnemies = MAX_ENEMIES): { enemyId: string; at: Vec3; elite?: string }[] {
  const pool = biome.enemyPool.filter((id) => enemies[id]);
  if (pool.length === 0) throw new Error(`biome ${biome.id} has no enemies to draw from`);
  const cheapest = [...pool].sort((a, b) => enemies[a].cost - enemies[b].cost || a.localeCompare(b))[0];
  const picked: string[] = [];
  let left = budget;
  while (picked.length < maxEnemies) {
    const fit = pool.filter((id) => enemies[id].cost <= left);
    if (fit.length === 0) break;
    const id = weights ? rng.weighted(fit, (m) => weights[m] ?? 1) : rng.pick(fit);
    picked.push(id);
    left -= enemies[id].cost;
  }
  if (picked.length === 0) picked.push(cheapest);
  return picked.map((enemyId, i) => {
    if (spots.length > 0) {
      const s = spots[i % spots.length];
      return { enemyId, at: { x: s.x + (rng.next() - 0.5) * 2 * JITTER, y: 0, z: s.z + (rng.next() - 0.5) * 2 * JITTER } };
    }
    const a = (i / picked.length) * Math.PI * 2;
    return { enemyId, at: { x: Math.cos(a) * RING_RADIUS, y: 0, z: Math.sin(a) * RING_RADIUS } };
  });
}
