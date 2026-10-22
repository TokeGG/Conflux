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

type Spawn = (id: string, pos: Vec3, opts: { scale?: number; follow?: () => Vec3 | null }) => Promise<Handle>;

export class FxKeeper {
  private live = new Map<string, { handle: Handle | null; fx: KeptFx; starting: boolean; stopped: boolean }>();

  constructor(private spawn: Spawn) {}

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

/** The effect round an enemy that carries a status: which sheet, how big, and how high on its body. */
export function statusFxFor(status: string): { id: string; scale: number; y: number } | null {
  return (fxmap.statuses as Record<string, { id: string; scale: number; y: number }>)[status] ?? null;
}
