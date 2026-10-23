// Effects that last as long as something else does: the ground fire of a dash, a cyclone, a tornado, and the swirl, flames or
// drops round an enemy while it carries a status. Every effect sheet plays once, so the keeper starts it again until its key is gone.
import type { SkillDef, Vec3 } from '@conflux/shared';
import fxmap from './fxmap.json' with { type: 'json' };

export interface KeptFx {
  id: string;
  pos: Vec3;
  scale: number;
}

interface Handle {
  readonly done: boolean;
  stop(): void;
}

type Spawn = (id: string, pos: Vec3, opts: { scale?: number; life?: number; follow?: () => Vec3 | null }) => Promise<Handle>;

export class FxKeeper {
  private live = new Map<string, { handle: Handle | null; fx: KeptFx; starting: boolean; stopped: boolean }>();

  constructor(private spawn: Spawn) {}

  /** Stops everything and forgets it (a room change); the keys still wanted start again on the next sync. */
  reset(): void {
    for (const rec of this.live.values()) {
      rec.stopped = true;
      rec.handle?.stop();
    }
    this.live.clear();
  }

  /** Brings the running effects in line with `active`: starts new keys, restarts finished ones, stops keys that are gone. */
  async sync(active: Map<string, KeptFx>): Promise<void> {
    for (const [key, rec] of this.live) {
      if (active.has(key)) continue;
      rec.stopped = true;
      rec.handle?.stop();
      this.live.delete(key);
    }
    const starts: Promise<void>[] = [];
    for (const [key, fx] of active) {
      let rec = this.live.get(key);
      if (!rec) this.live.set(key, (rec = { handle: null, fx, starting: false, stopped: false }));
      rec.fx = fx; // the follow callback reads the latest position
      if (rec.starting || (rec.handle && !rec.handle.done)) continue;
      rec.starting = true;
      const r = rec;
      starts.push(
        this.spawn(fx.id, fx.pos, { scale: fx.scale, follow: () => r.fx.pos })
          .then((h) => {
            r.handle = h;
            if (r.stopped) h.stop();
          })
          .catch(() => undefined)
          .finally(() => {
            r.starting = false;
          }),
      );
    }
    await Promise.all(starts);
  }
}

/** The effect a zone shows: its skill's zone effect, else its trail effect, else the reaction zone table. Sized to the zone. */
export function zoneFxFor(kind: string, skills: Record<string, Pick<SkillDef, 'fx'>>): { id: string } | null {
  const own = skills[kind]?.fx?.zone ?? skills[kind]?.fx?.trail;
  if (own) return { id: own };
  const id = (fxmap.zones as Record<string, string>)[kind];
  return id ? { id } : null;
}

interface StatusLayer {
  id: string;
  scale: number;
}

/** One sheet effect round an enemy: which sheet, how big, and how high on its body (metres above its feet). */
export interface StatusFx {
  id: string;
  scale: number;
  y: number;
}

/** A sheet frame is 3 m wide at scale 1, and the mob the table's scales are meant for is about this tall. */
const REFERENCE_HEIGHT = 2;
const SIZE_RANGE: [number, number] = [0.65, 1.7];

/** How many copies of an effect stack up a mob of this height, so a tall one is covered and not just dotted. */
export function statusCopies(height: number): number {
  return height < 1.6 ? 1 : height < 2.8 ? 2 : 3;
}

/**
 * The sheet effects round an enemy that carries a status or mark: each of the status's layers, in two or three copies at different
 * heights for a tall mob, scaled to its height. Empty for a status with no effect.
 */
export function statusFxLayers(status: string, height: number): StatusFx[] {
  const layers = (fxmap.statuses as Record<string, { layers: StatusLayer[] }>)[status]?.layers;
  if (!layers) return [];
  const h = Number.isFinite(height) && height > 0 ? height : REFERENCE_HEIGHT;
  const size = Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], h / REFERENCE_HEIGHT));
  const n = statusCopies(h);
  const out: StatusFx[] = [];
  layers.forEach((l, k) => {
    for (let i = 0; i < n; i++) {
      // the sheet's anchor sits low in its frame, so the effect is lifted a little to centre on the body; layers interleave in height
      const frac = (i + 0.25 + (k % 2) * 0.35) / n;
      out.push({ id: l.id, scale: l.scale * size, y: Math.max(0.1, h * frac * 0.9) });
    }
  });
  return out;
}

/** The first effect round an enemy that carries a status (for tools that want one sheet): which sheet, how big, how high. */
export function statusFxFor(status: string): StatusFx | null {
  return statusFxLayers(status, REFERENCE_HEIGHT)[0] ?? null;
}
