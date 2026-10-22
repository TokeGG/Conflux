// The Skill animation page, after MMO Arena's skill window: pick a skill, and a caster on a small stage casts it again and again with the
// skill's own effects. Change which clip plays, the cast archetype, the windup, the point in the clip where the skill fires, the move speed
// while casting and the upper-body blend, and the next cast shows it (staged edits are previewed at once). "Try now" in the toolbar puts
// them in the run; "Copy this skill's patch" exports them as patches for skills.json's cast block.
import * as THREE from 'three';
import type { GameData, SkillDef } from '@conflux/shared';
import type { AssetLoader } from '../../assets/loader.ts';
import { castClipChoice, castSpeed, previewAt } from '../../anim/castTiming.ts';
import { FxSystem, type FxHandle } from '../../fx/sprites.ts';
import { castRows, clipChoices, patchesText, type CastRow } from '../animRows.ts';
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';
import type { DevState } from '../devstate.ts';
import { loadStagePlayer, playerRigs, Stage } from '../stage.ts';
import type { CharacterRig } from '../../anim/rig.ts';
import { CAST_ARCHETYPES } from '@conflux/shared';

const REST = 1.2;
const SPEEDS: [number, string][] = [[1, '1×'], [0.5, '½×'], [0.25, '¼×'], [0.1, '⅒×']];
const TARGET_Z = 6;

export interface SkillAnimOptions {
  loader: AssetLoader;
  state: DevState;
  base: () => GameData;
  changed(): void;
}

export class SkillAnimPage implements DevPage {
  readonly id = 'skillanim';
  readonly title = 'Skill animation';
  readonly pausesSim = true;
  private skillId = '';
  private rigName = '';
  private stage: Stage | null = null;
  private fx: FxSystem | null = null;
  private rig: CharacterRig | null = null;
  private dummy: THREE.Mesh | null = null;
  private token = 0;
  private t = 0;
  private speedMul = 1;
  private loop = true;
  private paused = false;
  private castW = 0;
  private lastFired = false;
  private cycle = 0;
  private flights: { pos: { x: number; y: number; z: number }; vz: number; left: number; handle: FxHandle | null; hit: string | undefined }[] = [];
  private live: FxHandle[] = [];
  private formHost: HTMLElement | null = null;
  private info: HTMLElement | null = null;
  private patchBox: HTMLElement | null = null;

  constructor(private o: SkillAnimOptions) {}

  private data(): GameData {
    return this.o.state.layers.current();
  }

  private skill(): SkillDef | undefined {
    return this.data().skills[this.skillId];
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const data = this.data();
    const ids = Object.keys(data.skills).sort();
    if (!ids.includes(this.skillId)) this.skillId = ids[0] ?? '';
    const rigs = playerRigs(this.o.loader);
    if (!rigs.includes(this.rigName)) this.rigName = rigs[0] ?? '';
    const stage = new Stage();
    this.stage = stage;
    stage.canvas.id = 'skillanim-canvas';
    this.fx = new FxSystem(stage.scene, this.o.loader, 'linear');

    const head = el('div', { class: 'dev-pagehead' });
    const pick = el('select', { id: 'skillanim-pick', title: 'Which skill' });
    for (const element of [...new Set(ids.map((i) => data.skills[i].element))]) {
      const g = el('optgroup', { label: element });
      for (const id of ids.filter((i) => data.skills[i].element === element)) g.append(el('option', { value: id }, id));
      pick.append(g);
    }
    pick.value = this.skillId;
    const rigSel = el('select', { id: 'skillanim-rig', title: 'Which player model' });
    for (const r of rigs) rigSel.append(el('option', { value: r }, r));
    rigSel.value = this.rigName;
    head.append(el('label', {}, 'Skill '), pick, rigSel);

    const tools = el('div', { class: 'dev-viewer-controls' });
    const cast = el('button', { id: 'skillanim-cast', title: 'Cast the skill once more from the start' }, '▶ Cast it');
    const loop = el('button', { class: 'dev-on', id: 'skillanim-loop', title: 'Cast again every few seconds' }, '⟲ Repeat');
    const pause = el('button', { id: 'skillanim-pause', title: 'Hold the picture still' }, '⏸ Pause');
    const speed = el('select', { title: 'How fast it plays', id: 'skillanim-speed' });
    for (const [v, l] of SPEEDS) speed.append(el('option', { value: String(v) }, l));
    cast.addEventListener('click', () => this.recast());
    loop.addEventListener('click', () => {
      this.loop = !this.loop;
      loop.classList.toggle('dev-on', this.loop);
    });
    pause.addEventListener('click', () => {
      this.paused = !this.paused;
      pause.classList.toggle('dev-on', this.paused);
      pause.textContent = this.paused ? '▶ Play' : '⏸ Pause';
    });
    speed.addEventListener('change', () => (this.speedMul = Number(speed.value)));
    const both = el('button', { title: 'Frame the caster and the target together' }, 'Both');
    both.addEventListener('click', () => stage.frame('side', this.dummy ? [this.dummy] : []));
    tools.append(cast, loop, pause, speed, ...stage.viewButtons(), both);

    this.info = el('div', { class: 'dev-msg', id: 'skillanim-info' });
    this.formHost = el('div', { class: 'dev-rows', id: 'skillanim-rows' });
    this.patchBox = el('pre', { class: 'dev-log', id: 'skillanim-patch', hidden: '' });
    const copy = el('button', { title: 'Copy the edits to this skill\'s cast as JSON patches' }, 'Copy this skill\'s patch');
    copy.addEventListener('click', () => void this.copyPatch());
    const stageBox = el('div', { class: 'dev-stagebox' });
    stageBox.append(stage.root, tools);
    const right = el('div', {});
    right.append(this.info, this.formHost, copy, this.patchBox);
    const layout = el('div', { class: 'dev-two' });
    layout.append(stageBox, right);
    host.append(head, layout);

    pick.addEventListener('change', () => {
      this.skillId = pick.value;
      this.drawForm();
      this.recast();
    });
    rigSel.addEventListener('change', () => {
      this.rigName = rigSel.value;
      void this.loadCaster();
    });

    stage.onFrame((dt) => this.frame(dt));
    stage.start();
    void this.loadCaster();
    this.drawForm();
  }

  private rows(): CastRow[] {
    return castRows(this.data(), this.o.base(), this.skillId, this.o.state.staged);
  }

  private num(key: string): number {
    const r = this.rows().find((x) => x.path.endsWith(`.${key}`));
    return typeof r?.value === 'number' ? r.value : 0;
  }

  private str(key: string): string {
    const r = this.rows().find((x) => x.path.endsWith(`.${key}`));
    return typeof r?.value === 'string' ? r.value : '';
  }

  private async loadCaster(): Promise<void> {
    const stage = this.stage;
    if (!stage) return;
    const token = ++this.token;
    stage.subject.clear();
    this.rig = null;
    try {
      const { root, rig } = await loadStagePlayer(this.o.loader, this.rigName);
      if (token !== this.token) return;
      stage.subject.add(root);
      this.rig = rig;
      this.drawForm();
      const dummy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 16), new THREE.MeshStandardMaterial({ color: 0x8a5a4a, roughness: 0.9 }));
      dummy.position.set(0, 0.9, TARGET_Z);
      this.dummy = dummy;
      stage.scene.add(dummy);
      stage.frame('side');
      this.recast();
    } catch (e) {
      if (this.info) this.info.textContent = `Could not load the caster: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private recast(): void {
    this.t = 0;
    this.cycle = 0;
    this.lastFired = false;
    this.rig?.restartCast();
    this.endEffects();
  }

  private endEffects(): void {
    for (const f of this.flights) f.handle?.stop();
    this.flights = [];
    for (const h of this.live) h.stop();
    this.live = [];
  }

  /** What the cast looks like with the page's values (staged edits included). */
  private timing() {
    const data = this.data();
    const skill = this.skill();
    const rig = this.rig;
    if (!skill || !rig) return null;
    const anim = data.animation.rigs[this.rigName];
    const clip = castClipChoice({ archetype: (this.str('archetype') || skill.cast.archetype) as SkillDef['cast']['archetype'], clip: this.str('clip') }, (n) => rig.hasClip(n), anim?.cast);
    const clipSeconds = rig.clipDuration(clip);
    const windup = this.num('windup');
    const fireAt = this.num('fireAt');
    const speed = castSpeed(fireAt, clipSeconds, windup);
    const blend = this.rows().find((r) => r.path.endsWith('.blend'))?.value;
    return { clip, clipSeconds, windup, fireAt, speed, blend: typeof blend === 'number' ? blend : 1, rate: anim?.castBlendRate ?? 15 };
  }

  private frame(dt: number): void {
    const stage = this.stage;
    const rig = this.rig;
    const tm = this.timing();
    if (!stage || !rig || !tm) return;
    const step = this.paused ? 0 : dt * this.speedMul;
    this.t += step;
    const period = previewAt(0, { windup: tm.windup, clipSeconds: tm.clipSeconds, speed: tm.speed, rest: REST }).period;
    if (this.loop && period > 0 && this.t >= period) {
      this.t -= period;
      this.cycle++;
      this.lastFired = false;
      rig.restartCast();
      this.endEffects();
    } else if (!this.loop && this.t > period) {
      this.t = period; // one cast, then rest
    }
    const st = previewAt(this.t, { windup: tm.windup, clipSeconds: tm.clipSeconds, speed: tm.speed, rest: REST });
    const casting = this.t < period && st.casting;
    this.castW += ((casting ? tm.blend : 0) - this.castW) * Math.min(1, step * tm.rate);
    rig.setCastSpeed(tm.speed);
    rig.play('idle', tm.clip, this.castW, 0);
    rig.update(step);
    if (casting && st.fired && !this.lastFired) this.fire();
    if (this.t < period) this.lastFired = st.fired;
    this.moveFlights(step);
    this.fx?.update(step, stage.camera);
    if (this.info) {
      const fireSec = tm.fireAt > 0 ? tm.fireAt * tm.clipSeconds : null;
      this.info.textContent = `${tm.clip}: ${tm.clipSeconds.toFixed(2)} s` + (fireSec !== null ? `, releases at ${fireSec.toFixed(2)} s, played at ${tm.speed.toFixed(2)}× so it lands on the ${tm.windup.toFixed(2)} s windup` : `, played at its own speed (fires at ${tm.windup.toFixed(2)} s)`);
    }
  }

  private spawn(id: string | undefined, pos: { x: number; y: number; z: number }, opts: { follow?: () => { x: number; y: number; z: number } | null } = {}): FxHandle | null {
    if (!id || !this.fx) return null;
    let handle: FxHandle | null = null;
    void this.fx.spawn(id, pos, opts).then((h) => {
      handle = h;
      this.live.push(h);
    }, () => undefined);
    return handle;
  }

  /** The skill leaves the hand: its own effects, placed the way the game places them. */
  private fire(): void {
    const skill = this.skill();
    if (!skill) return;
    const hand = { x: 0, y: 1.3, z: 0.6 };
    const fx = skill.fx ?? {};
    const shape = skill.shape;
    if (shape.type === 'projectile') {
      const speed = shape.speed ?? 15;
      const life = Math.min(shape.lifetime ?? 1.5, (TARGET_Z - 0.6) / speed);
      const flight = { pos: { ...hand }, vz: speed, left: life, handle: null as FxHandle | null, hit: fx.hit };
      this.flights.push(flight);
      void this.fx?.spawn(fx.travel ?? fx.loop ?? '', flight.pos, { follow: () => flight.pos }).then((h) => (flight.handle = h), () => undefined);
      if (fx.trail) void this.fx?.spawn(fx.trail, flight.pos, { follow: () => flight.pos }).then((h) => this.live.push(h), () => undefined);
      return;
    }
    const at = shape.type === 'zone' ? { x: 0, y: 0.3, z: TARGET_Z } : shape.type === 'self' || shape.type === 'dash' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 1.1, z: 2.2 };
    for (const slot of ['pop', 'zone', 'loop', 'travel'] as const) this.spawn(fx[slot], at);
    this.spawn(fx.hit, { x: 0, y: 1, z: shape.type === 'zone' ? TARGET_Z : 2.4 });
  }

  private moveFlights(step: number): void {
    for (const f of [...this.flights]) {
      f.pos.z += f.vz * step;
      f.left -= step;
      if (f.left <= 0) {
        f.handle?.stop();
        this.spawn(f.hit, { x: 0, y: 1, z: Math.min(f.pos.z + 0.2, TARGET_Z) });
        this.flights.splice(this.flights.indexOf(f), 1);
      }
    }
  }

  private drawForm(): void {
    const host = this.formHost;
    if (!host) return;
    host.replaceChildren();
    const rig = this.rig;
    const available = rig ? rig.clipNames() : [];
    const group = el('div', { class: 'dev-group' });
    group.append(el('h4', {}, `${this.skillId}: cast`));
    for (const r of this.rows()) group.append(this.drawRow(r, available));
    host.append(group);
  }

  private stage1(path: string, value: string | number, msg: HTMLElement, wrap: HTMLElement, fileValue: string | number): void {
    const err = this.o.state.stage({ path, value });
    msg.textContent = err ?? 'not tried yet';
    wrap.classList.toggle('dev-changed', !err && value !== fileValue);
    if (!err) this.recast();
    this.o.changed();
  }

  private drawRow(r: CastRow, available: readonly string[]): HTMLElement {
    const wrap = el('div', { class: `dev-row dev-castrow${r.changed ? ' dev-changed' : ''}`, 'data-path': r.path, title: r.hint ?? '' });
    const msg = el('span', { class: 'dev-rowmsg' }, this.o.state.staged.some((p) => p.path === r.path) ? 'not tried yet' : '');
    let control: HTMLElement;
    if (r.kind === 'number') {
      const num = el('input', { type: 'number', min: String(r.min), max: String(r.max), step: String(r.step), value: String(r.value) });
      const range = el('input', { type: 'range', min: String(r.min), max: String(r.max), step: String(r.step), value: String(r.value) });
      const apply = (raw: string, from: HTMLInputElement) => {
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        (from === num ? range : num).value = String(v);
        this.stage1(r.path, v, msg, wrap, r.fileValue);
      };
      num.addEventListener('change', () => apply(num.value, num));
      range.addEventListener('input', () => apply(range.value, range));
      const box = el('span', { class: 'dev-castnum' });
      box.append(num, range);
      control = box;
    } else {
      const select = el('select');
      if (r.kind === 'clip') {
        select.append(el('option', { value: '' }, '(archetype\'s clip)'));
        for (const c of clipChoices(available, String(r.value))) if (c.value) select.append(el('option', { value: c.value }, c.label));
      } else {
        for (const a of CAST_ARCHETYPES) select.append(el('option', { value: a }, a));
      }
      select.value = String(r.value);
      select.addEventListener('change', () => this.stage1(r.path, select.value, msg, wrap, r.fileValue));
      control = select;
    }
    const unit = el('span', { class: 'dev-unit' }, r.unit ?? '');
    const file = el('span', { class: 'dev-file' }, `file: ${r.fileValue === '' ? '(none)' : String(r.fileValue)}`);
    const reset = el('button', { class: 'dev-reset', title: 'Put this value back to the file\'s' }, '↺');
    reset.addEventListener('click', () => {
      this.o.state.revertPath(r.path);
      this.o.changed();
      this.drawForm();
      this.recast();
    });
    wrap.append(el('label', { title: r.path }, r.label), control, unit, file, reset, msg);
    return wrap;
  }

  private async copyPatch(): Promise<void> {
    const text = patchesText(`skills.${this.skillId}.cast`, this.o.state.layers.patches(), this.o.state.staged);
    if (this.patchBox) {
      this.patchBox.hidden = false;
      this.patchBox.textContent = text;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the patch is shown in the box instead */
    }
  }

  dispose(): void {
    this.token++;
    this.endEffects();
    this.rig = null;
    this.dummy = null;
    this.fx = null;
    this.stage?.dispose();
    this.stage = null;
    this.formHost = null;
    this.info = null;
    this.patchBox = null;
  }
}
