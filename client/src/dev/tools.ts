// Run and match tools: pacing, spawning, giving things, god mode, debug drawing and the reaction log.
import type { AssetEntry, DevCommand, GameData, SimBridge, SimEvent } from '@conflux/shared';
import { ELEMENTS, STATUS_IDS } from '@conflux/shared';
import { el } from './dom.ts';
import type { DevPage } from './page.ts';

/** The baked clip names of a rig, from the asset manifest ("clip.<rig>.<name>"). */
export function clipsForRig(manifest: AssetEntry[], rig: string): string[] {
  const prefix = `clip.${rig}.`;
  return manifest
    .filter((a) => a.id.startsWith(prefix))
    .map((a) => a.id.slice(prefix.length))
    .sort();
}

/** The time in the clip that a 0 to 1 slider position stands for. */
export function scrubTime(progress: number, duration: number): number {
  return Math.min(1, Math.max(0, progress)) * duration;
}

export function reactionLine(e: SimEvent): string {
  return `${Number(e.t).toFixed(1)} s  ${String(e.id)} (${String(e.effect)}) on #${String(e.enemyId)}`;
}

/** What the renderer should draw on top of the game, switched from the Tools page. */
export interface DebugFlags {
  hurtboxes: boolean;
  colliders: boolean;
  aiState: boolean;
}

export const noDebug = (): DebugFlags => ({ hurtboxes: false, colliders: false, aiState: false });

export class ToolsPage implements DevPage {
  readonly id = 'tools';
  readonly title = 'Run tools';
  private log: string[] = [];
  private logEl: HTMLElement | null = null;

  constructor(
    private bridge: SimBridge,
    private data: () => GameData,
    readonly flags: DebugFlags,
  ) {
    bridge.onFrame((_s, events) => {
      for (const e of events) if (e.type === 'reaction') this.log = [reactionLine(e), ...this.log].slice(0, 30);
      if (this.logEl && this.log.length) this.logEl.textContent = this.log.join('\n');
    });
  }

  private send(cmd: DevCommand): void {
    this.bridge.command(cmd);
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const section = (title: string) => {
      const box = el('div', { class: 'dev-section' });
      box.append(el('h4', {}, title));
      host.append(box);
      return box;
    };
    const button = (box: HTMLElement, label: string, fn: () => void, id?: string) => {
      const b = el('button', id ? { id } : {}, label);
      b.addEventListener('click', fn);
      box.append(b);
      return b;
    };
    const select = (box: HTMLElement, options: string[], id?: string) => {
      const s = el('select', id ? { id } : {});
      for (const o of options) s.append(el('option', { value: o }, o));
      box.append(s);
      return s;
    };
    const check = (box: HTMLElement, label: string, initial: boolean, fn: (on: boolean) => void, id?: string) => {
      const l = el('label', { class: 'dev-check' });
      const c = el('input', { type: 'checkbox', ...(id ? { id } : {}) });
      c.checked = initial;
      c.addEventListener('change', () => fn(c.checked));
      l.append(c, ` ${label}`);
      box.append(l);
    };
    const number = (box: HTMLElement, value: number, min: number, step: number) => {
      const i = el('input', { type: 'number', value: String(value), min: String(min), step: String(step), class: 'dev-num' });
      box.append(i);
      return i;
    };

    const time = section('Time');
    let paused = false;
    button(time, 'Pause / resume', () => this.send({ op: 'pause', on: (paused = !paused) }), 'tool-pause');
    button(time, 'Step one tick', () => this.send({ op: 'step' }), 'tool-step');
    const scale = el('input', { type: 'range', min: '0.1', max: '2', step: '0.1', value: '1' });
    const scaleText = el('span', {}, '1×');
    scale.addEventListener('input', () => {
      scaleText.textContent = `${scale.value}×`;
      this.send({ op: 'timescale', scale: Number(scale.value) });
    });
    time.append(' Speed ', scale, scaleText);

    const room = section('Room');
    button(room, 'Restart room', () => this.send({ op: 'restartRoom' }));
    const seed = number(room, 1, 0, 1);
    button(room, 'Restart with seed', () => this.send({ op: 'setSeed', seed: Number(seed.value) }));

    const spawn = section('Enemies');
    const enemies = select(spawn, Object.keys(this.data().enemies), 'tool-enemy');
    const count = number(spawn, 1, 1, 1);
    button(spawn, 'Spawn at crosshair', () => this.send({ op: 'spawn', enemy: enemies.value, count: Number(count.value), at: 'crosshair' }), 'tool-spawn');
    const status = select(spawn, STATUS_IDS as unknown as string[]);
    button(spawn, 'Spawn dummy with status', () => this.send({ op: 'spawnDummy', status: status.value, at: 'crosshair' }), 'tool-dummy');
    button(spawn, 'Kill all', () => this.send({ op: 'killAll' }), 'tool-killall');

    const give = section('Give');
    const skills = select(give, Object.keys(this.data().skills), 'tool-skill');
    button(give, 'Give skill', () => this.send({ op: 'giveSkill', skill: skills.value }), 'tool-give');
    ELEMENTS.forEach((name, i) => button(give, `Hold ${name}`, () => this.send({ op: 'setElement', i })));
    const augs = select(give, Object.keys(this.data().augments), 'tool-augment');
    const rarity = select(give, ['common', 'rare', 'epic'], 'tool-rarity');
    button(give, 'Give augment', () => this.send({ op: 'giveAugment', id: augs.value, rarity: rarity.value }), 'tool-give-augment');
    const apply = select(give, STATUS_IDS as unknown as string[]);
    button(give, 'Apply status to target', () => this.send({ op: 'applyStatus', id: apply.value }));

    const cheats = section('Testing');
    check(cheats, 'God mode', false, (on) => this.send({ op: 'god', on }), 'tool-god');
    check(cheats, 'No cooldowns', false, (on) => this.send({ op: 'noCooldowns', on }), 'tool-nocd');

    const draw = section('Draw');
    check(draw, 'Hurtboxes', this.flags.hurtboxes, (on) => (this.flags.hurtboxes = on), 'tool-draw-hurt');
    check(draw, 'Colliders', this.flags.colliders, (on) => (this.flags.colliders = on), 'tool-draw-colliders');
    check(draw, 'AI state and status timers', this.flags.aiState, (on) => (this.flags.aiState = on), 'tool-draw-ai');

    const log = section('Reaction log');
    this.logEl = el('pre', { class: 'dev-log', id: 'tool-log' }, this.log.join('\n') || 'No reactions yet.');
    log.append(this.logEl);
  }

  dispose(): void {
    this.logEl = null;
  }
}
