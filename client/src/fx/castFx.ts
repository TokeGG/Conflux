// What a cast looks like beyond the hit: cones and dash trails drawn from the hand when the skill leaves it, the aura of a shield or buff,
// and the pieces of a channelled stream. Pure: the game turns these into sprites.
import { castOriginAt, type CastOrigin, type SimEvent, type SkillDef, type Vec3 } from '@conflux/shared';
import type { KeptFx } from './keeper.ts';

type Skills = Record<string, Pick<SkillDef, 'fx' | 'shape'>>;

export interface CastPiece {
  id: string;
  pos: Vec3;
  scale: number;
  /** A direction in the world the sheet's right side points along (cones and streams). */
  dir?: Vec3;
}

/** Metres of world one effect frame covers at scale 1 (192 px at 64 px per metre). */
export const FRAME_METRES = 3;
/** How much of a frame the drawn shape fills, so a cone's sheet can be sized to its range. */
export const FILL = 0.7;
const AURA_HEIGHT = 0.9;
const AURA_SCALE = 0.8;
const STREAM_PIECE_METRES = 2.4;
const TRAIL_STEP = 1.3;
const TRAIL_SCALE = 0.7;

const dirOf = (yaw: number, pitch: number): Vec3 => ({ x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) });

/** The extra effects of a skill leaving the hand: a cone's sheet along its range, a dash's trail along its path (a dash with a ground trail leaves that to its zones). */
export function castExtras(e: SimEvent, skills: Skills, feet: Vec3): CastPiece[] {
  const skill = skills[String(e.skillId)];
  if (!skill) return [];
  const hand = { x: e.x as number, y: e.y as number, z: e.z as number };
  const yaw = e.yaw as number;
  if (skill.shape.type === 'cone' && skill.fx.cone) {
    const range = skill.shape.range ?? 5;
    const d = dirOf(yaw, e.pitch as number);
    return [{ id: skill.fx.cone, pos: { x: hand.x + d.x * range * 0.55, y: hand.y + d.y * range * 0.55, z: hand.z + d.z * range * 0.55 }, scale: range / (FRAME_METRES * FILL), dir: d }];
  }
  if (skill.shape.type === 'dash' && skill.fx.trail && !skill.shape.trailRadius) {
    const dist = Math.max(0, (e.distance as number) ?? 0);
    const out: CastPiece[] = [];
    for (let d = 0; d <= dist + 1e-9; d += TRAIL_STEP) out.push({ id: skill.fx.trail, pos: { x: feet.x + Math.sin(yaw) * d, y: feet.y + 0.3, z: feet.z + Math.cos(yaw) * d }, scale: TRAIL_SCALE });
    return out;
  }
  return [];
}

interface PlayerBits {
  pos: Vec3;
  facing: number;
  buff: string | null;
  casting: string | null;
  aim: Vec3 | null;
}

/** The effects that last as long as the player's buff or channel does, keyed for the FxKeeper. */
export function keptCastFx(p: PlayerBits, skills: Skills, origin: CastOrigin): Map<string, KeptFx> {
  const out = new Map<string, KeptFx>();
  const aura = p.buff ? skills[p.buff]?.fx.self : undefined;
  if (aura) out.set('buff', { id: aura, pos: { x: p.pos.x, y: p.pos.y + AURA_HEIGHT, z: p.pos.z }, scale: AURA_SCALE });
  const stream = p.casting ? skills[p.casting] : undefined;
  if (stream && stream.shape.type === 'stream' && stream.fx.stream && p.aim) {
    const hand = castOriginAt(p.pos, p.facing, origin);
    const to = { x: p.aim.x - hand.x, y: p.aim.y - hand.y, z: p.aim.z - hand.z };
    const dist = Math.hypot(to.x, to.y, to.z);
    if (dist > 0.3) {
      const d = { x: to.x / dist, y: to.y / dist, z: to.z / dist };
      const length = Math.min(stream.shape.range ?? 8, dist);
      const n = Math.max(2, Math.ceil(length / STREAM_PIECE_METRES));
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * length;
        out.set(`stream${i}`, { id: stream.fx.stream, pos: { x: hand.x + d.x * t, y: hand.y + d.y * t, z: hand.z + d.z * t }, scale: length / n / (FRAME_METRES * FILL) + 0.2, dir: d });
      }
    }
  }
  return out;
}
