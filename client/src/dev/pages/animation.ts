// The Animations page: which clip plays for each state. Pick a rig, pick a state (idle, walk, run, jump, dodge, each cast archetype), pick any
// clip of that rig from a list, watch it on the whole model, and write the choice into animation.json as a staged patch ("Try now" in the
// toolbar puts it in the run at once; the next frame already plays it). Mobs with their own clips (enemies.json rig.clips) work the same way.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GameData } from '@conflux/shared';
import type { AssetLoader } from '../../assets/loader.ts';
import { fitHeight } from '../../renderer/scene.ts';
import { archetypeRows, clipChoices, mobClipRows, mobsWithClips, stateRows, type ClipRow } from '../animRows.ts';
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';
import type { DevState } from '../devstate.ts';
import { loadStagePlayer, playerRigs, Stage } from '../stage.ts';
import type { CharacterRig } from '../../anim/rig.ts';
import { clipsForRig } from '../tools.ts';

type Mode = 'player' | 'mobs';

export interface AnimationPageOptions {
  loader: AssetLoader;
  state: DevState;
  base: () => GameData;
  changed(): void;
}

export class AnimationPage implements DevPage {
  readonly id = 'animation';
  readonly title = 'Animations';
  readonly pausesSim = true;
  private mode: Mode = 'player';
  private rigName = '';
  private enemyId = '';
  private stage: Stage | null = null;
  private rig: CharacterRig | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private mobClips: string[] = [];
  private token = 0;
  private table: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  /** What the preview is showing: a leg clip, an upper-body cast clip, or a mob clip. */
  private showing: { kind: 'state' | 'cast' | 'mob'; clip: string } | null = null;
  private castLoop = 0;

  constructor(private o: AnimationPageOptions) {}

  private live(): GameData {
    return this.o.state.layers.current();
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const rigs = playerRigs(this.o.loader);
    const mobs = mobsWithClips(this.live());
    if (!rigs.includes(this.rigName)) this.rigName = rigs[0] ?? '';
    if (!mobs.includes(this.enemyId)) this.enemyId = mobs[0] ?? '';
    const stage = new Stage();
    this.stage = stage;
    stage.canvas.id = 'anims-canvas';

    const head = el('div', { class: 'dev-pagehead' });
    const modeSel = el('select', { id: 'anims-mode', title: 'Whose animations' });
    modeSel.append(el('option', { value: 'player' }, 'Player rig'), el('option', { value: 'mobs' }, 'Mobs'));
    modeSel.value = this.mode;
    const pick = el('select', { id: 'anims-pick', title: 'Which rig or mob' });
    const fillPick = () => {
      pick.replaceChildren(...(this.mode === 'player' ? rigs : mobs).map((n) => el('option', { value: n }, n)));
      pick.value = this.mode === 'player' ? this.rigName : this.enemyId;
    };
    fillPick();
    const resetPage = el('button', { title: 'Put every clip choice on this page back to the file\'s' }, 'Reset page');
    resetPage.addEventListener('click', () => {
      for (const r of this.rows()) this.o.state.revertPath(r.path);
      this.o.changed();
      this.drawTable();
    });
    head.append(el('label', {}, 'Show '), modeSel, pick, resetPage);

    const stageBox = el('div', { class: 'dev-stagebox' });
    stageBox.append(stage.root, el('div', { class: 'dev-viewer-controls' }, ''));
    stageBox.lastElementChild!.append(...stage.viewButtons());
    this.note = el('div', { class: 'dev-msg', id: 'anims-note' }, 'Pick a state to see its clip.');
    this.table = el('div', { class: 'dev-rows', id: 'anims-rows' });
    const layout = el('div', { class: 'dev-two' });
    const right = el('div', {});
    right.append(this.note, this.table);
    layout.append(stageBox, right);
    host.append(head, layout);

    modeSel.addEventListener('change', () => {
      this.mode = modeSel.value as Mode;
      fillPick();
      void this.loadSubject();
    });
    pick.addEventListener('change', () => {
      if (this.mode === 'player') this.rigName = pick.value;
      else this.enemyId = pick.value;
      void this.loadSubject();
    });

    stage.onFrame((dt) => {
      this.rig?.update(dt);
      this.mixer?.update(dt);
      if (this.showing?.kind === 'cast' && this.rig) {
        // the cast clip holds its last frame; play it again after a short rest
        this.castLoop += dt;
        const len = this.rig.clipDuration(this.showing.clip);
        if (this.castLoop > len + 0.9) {
          this.castLoop = 0;
          this.rig.restartCast();
        }
      }
    });
    stage.start();
    void this.loadSubject();
  }

  private rows(): ClipRow[] {
    const live = this.live();
    const base = this.o.base();
    const staged = this.o.state.staged;
    return this.mode === 'player' ? [...stateRows(live, base, this.rigName, staged), ...archetypeRows(live, base, this.rigName, staged)] : mobClipRows(live, base, this.enemyId, staged);
  }

  private async loadSubject(): Promise<void> {
    const stage = this.stage;
    if (!stage) return;
    const token = ++this.token;
    stage.subject.clear();
    this.rig = null;
    this.mixer = null;
    this.showing = null;
    this.mobClips = [];
    this.drawTable();
    try {
      if (this.mode === 'player') {
        const { root, rig } = await loadStagePlayer(this.o.loader, this.rigName);
        if (token !== this.token) return;
        stage.subject.add(root);
        this.rig = rig;
        rig.play('idle', null, 0, 0);
        stage.frame('side');
        this.note!.textContent = `${this.rigName}: ${rig.clipNames().length} clips. Pick a row to preview it.`;
      } else {
        const def = this.live().enemies[this.enemyId];
        if (!def) return;
        const gltf = await this.o.loader.loadModel(def.model);
        if (token !== this.token) return;
        const root = cloneSkinned(gltf.scene);
        fitHeight(root, 1.8);
        root.animations = gltf.animations;
        stage.subject.add(root);
        this.mixer = new THREE.AnimationMixer(root);
        this.mobClips = gltf.animations.map((a) => a.name).sort();
        stage.frame('side');
        this.note!.textContent = `${def.id}: ${this.mobClips.length} clips in its model. Pick a row to preview it.`;
        this.root3 = root;
      }
      this.drawTable();
    } catch (e) {
      if (token === this.token) this.note!.textContent = `Could not load: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private root3: THREE.Object3D | null = null;

  /** Plays a clip on the model: legs for a state, upper body for a cast archetype, the model's own animation for a mob. */
  private preview(row: ClipRow, clip: string): void {
    const kind = this.mode === 'mobs' ? 'mob' : row.path.includes('.cast.') ? 'cast' : 'state';
    this.showing = { kind, clip };
    if (kind === 'mob' && this.mixer && this.root3) {
      this.mixer.stopAllAction();
      const anim = this.root3.animations.find((a) => a.name === clip);
      if (anim) this.mixer.clipAction(anim).reset().play();
      this.note!.textContent = anim ? `${row.label}: ${clip} (${anim.duration.toFixed(2)} s)` : `${clip} is not in this model.`;
      return;
    }
    const rig = this.rig;
    if (!rig) return;
    if (!rig.hasClip(clip)) {
      this.note!.textContent = `${clip} is not a clip of ${this.rigName}.`;
      return;
    }
    if (kind === 'state') {
      rig.play('idle', null, 0, 0);
      rig.showClip(clip);
      rig.restartLoco();
    } else {
      rig.showClip(null);
      rig.play('idle', clip, 1, 0);
      rig.restartCast();
      this.castLoop = 0;
    }
    this.note!.textContent = `${row.label}: ${clip} (${rig.clipDuration(clip).toFixed(2)} s)`;
  }

  private drawTable(): void {
    const host = this.table;
    if (!host) return;
    host.replaceChildren();
    const available = this.mode === 'player' ? (this.rig ? this.rig.clipNames() : clipsForRig(this.o.loader.manifest, this.rigName)) : this.mobClips;
    const rows = this.rows();
    if (!rows.length) {
      host.append(el('div', { class: 'dev-empty' }, this.mode === 'player' ? 'No animation data for this rig.' : 'This mob has no clips table.'));
      return;
    }
    let group: HTMLElement | null = null;
    let lastTitle = '';
    for (const r of rows) {
      const title = this.mode === 'mobs' ? this.enemyId : r.path.includes('.cast.') ? 'Cast archetypes (upper body)' : 'Locomotion (legs)';
      if (title !== lastTitle || !group) {
        group = el('div', { class: 'dev-group' });
        group.append(el('h4', {}, title));
        host.append(group);
        lastTitle = title;
      }
      group.append(this.drawRow(r, available));
    }
  }

  private drawRow(r: ClipRow, available: readonly string[]): HTMLElement {
    const wrap = el('div', { class: `dev-row dev-cliprow${r.changed ? ' dev-changed' : ''}`, 'data-path': r.path });
    const select = el('select', { title: r.path });
    for (const c of clipChoices(available, r.value)) {
      const o = el('option', { value: c.value }, c.label);
      if (c.value === r.value) o.selected = true;
      select.append(o);
    }
    const play = el('button', { title: 'Play this clip on the model' }, '▶');
    const file = el('span', { class: 'dev-file', title: 'The clip in the data file' }, `file: ${r.fileValue}`);
    const reset = el('button', { class: 'dev-reset', title: 'Put this back to the file\'s' }, '↺');
    const msg = el('span', { class: 'dev-rowmsg' }, this.o.state.staged.some((p) => p.path === r.path) ? 'not tried yet' : '');
    select.addEventListener('change', () => {
      const err = this.o.state.stage({ path: r.path, value: select.value });
      msg.textContent = err ?? 'not tried yet';
      wrap.classList.toggle('dev-changed', !err && select.value !== r.fileValue);
      if (!err) this.preview(r, select.value);
      this.o.changed();
    });
    play.addEventListener('click', () => this.preview(r, select.value));
    reset.addEventListener('click', () => {
      this.o.state.revertPath(r.path);
      this.o.changed();
      this.drawTable();
      this.preview(r, r.fileValue);
    });
    wrap.append(el('label', { title: r.path }, r.label), select, play, file, reset, msg);
    return wrap;
  }

  dispose(): void {
    this.token++;
    this.rig = null;
    this.mixer = null;
    this.root3 = null;
    this.stage?.dispose();
    this.stage = null;
    this.table = null;
    this.note = null;
  }
}
