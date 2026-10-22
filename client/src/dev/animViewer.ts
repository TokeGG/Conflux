// The animation and model viewer: any model, any baked clip, a scrubber, the upper-body mask test, the cast clip per archetype
// and a tint preview. It has its own small canvas, made when the page opens and thrown away when it closes. The camera frames the
// whole model (fitted from its real bounds) and can be orbited, zoomed and panned to look at any part.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { decodeClip, type ClipFile } from '../anim/clips.ts';
import { CharacterRig } from '../anim/rig.ts';
import { fitHeight } from '../renderer/scene.ts';
import { Stage } from './stage.ts';
import castMap from '../anim/castMap.json' with { type: 'json' };
import type { AssetLoader } from '../assets/loader.ts';
import { el } from './dom.ts';
import type { DevPage } from './page.ts';
import { clipsForRig, scrubTime } from './tools.ts';

export class AnimViewerPage implements DevPage {
  readonly id = 'anim';
  readonly title = 'Animation viewer';
  private stage: Stage | null = null;
  private get holder(): THREE.Group {
    return this.stage!.subject;
  }
  private rig: CharacterRig | null = null;
  private clipDuration = 1;
  private playing = true;
  private scrub: number | null = null;
  private tint = '';
  private status: HTMLElement | null = null;
  private modelToken = 0;

  constructor(private loader: AssetLoader) {}

  private modelIds(): string[] {
    return this.loader.manifest.filter((a) => a.id.startsWith('model.')).map((a) => a.id).sort();
  }

  private rigNameFor(modelId: string): string | null {
    const rig = modelId.slice('model.'.length);
    return clipsForRig(this.loader.manifest, rig).length ? rig : null;
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const stage = new Stage();
    this.stage = stage;
    stage.canvas.id = 'viewer-canvas';
    const controls = el('div', { class: 'dev-viewer-controls' });
    const select = (label: string, options: string[], id: string) => {
      const s = el('select', { id });
      for (const o of options) s.append(el('option', { value: o }, o));
      const l = el('label', {}, `${label} `);
      l.append(s);
      controls.append(l);
      return s;
    };
    const model = select('Model', this.modelIds(), 'viewer-model');
    const clip = select('Clip', [], 'viewer-clip');
    const cast = select('Cast clip', [], 'viewer-cast');
    const archetype = select('Archetype', Object.keys(castMap), 'viewer-archetype');
    const mask = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0', id: 'viewer-mask' });
    const maskLabel = el('label', {}, 'Cast on upper body ');
    maskLabel.append(mask);
    const seek = el('input', { type: 'range', min: '0', max: '1', step: '0.001', value: '0', id: 'viewer-seek' });
    const seekLabel = el('label', {}, 'Scrub ');
    seekLabel.append(seek);
    const play = el('button', { id: 'viewer-play' }, 'Pause');
    const tint = el('input', { type: 'color', value: '#ffffff', id: 'viewer-tint' });
    const tintLabel = el('label', {}, 'Tint ');
    tintLabel.append(tint);
    this.status = el('div', { class: 'dev-msg', id: 'viewer-status' }, 'Pick a model.');
    controls.append(maskLabel, seekLabel, play, tintLabel);
    const views = el('div', { class: 'dev-viewer-controls' });
    views.append(el('span', { class: 'dev-unit' }, 'View (drag to orbit, wheel to zoom, right-drag to pan):'), ...stage.viewButtons());
    host.append(stage.root, views, controls, this.status);

    const fillClips = (rigName: string | null) => {
      const names = rigName ? clipsForRig(this.loader.manifest, rigName) : [];
      for (const s of [clip, cast]) {
        s.replaceChildren(el('option', { value: '' }, names.length ? '(none)' : '(this model has no baked clips)'));
        for (const n of names) s.append(el('option', { value: n }, n));
      }
    };
    const apply = () => {
      const rig = this.rig;
      if (!rig) return;
      rig.showClip(clip.value || null, this.scrub === null ? null : scrubTime(this.scrub, this.clipDuration));
      rig.play('idle', cast.value || null, Number(mask.value), 0);
    };
    const load = async () => {
      const token = ++this.modelToken;
      const id = model.value;
      const rigName = this.rigNameFor(id);
      fillClips(rigName);
      this.holder.clear();
      this.rig = null;
      try {
        const gltf = await this.loader.loadModel(id);
        if (token !== this.modelToken) return;
        const root = cloneSkinned(gltf.scene);
        fitHeight(root, 1.8); // exact bounds from the vertices, as the game fits its own models
        this.holder.add(root);
        stage.frame('side');
        this.applyTint(root);
        if (rigName) {
          const names = clipsForRig(this.loader.manifest, rigName);
          const files = await Promise.all(names.map((n) => this.loader.loadJson<ClipFile>(`clip.${rigName}.${n}`)));
          if (token !== this.modelToken) return;
          const decoded = files.map(decodeClip);
          const rig = new CharacterRig(root, decoded[0].bones);
          for (const c of decoded) rig.addClip(c);
          this.rig = rig;
          this.durations = new Map(decoded.map((c) => [c.name, c.duration]));
          this.status!.textContent = `${id}: ${names.length} clips`;
        } else {
          this.status!.textContent = `${id}: no baked clips, shown standing`;
        }
        apply();
      } catch (e) {
        this.status!.textContent = `Could not load ${id}: ${e instanceof Error ? e.message : String(e)}`;
      }
    };
    model.addEventListener('change', () => void load());
    clip.addEventListener('change', () => {
      this.clipDuration = this.durations.get(clip.value) ?? 1;
      apply();
    });
    cast.addEventListener('change', apply);
    mask.addEventListener('input', apply);
    archetype.addEventListener('change', () => {
      const name = (castMap as Record<string, string>)[archetype.value];
      cast.value = [...cast.options].some((o) => o.value === name) ? name : '';
      if (Number(mask.value) === 0) mask.value = '1';
      apply();
    });
    seek.addEventListener('input', () => {
      this.scrub = Number(seek.value);
      this.playing = false;
      play.textContent = 'Play';
      apply();
    });
    play.addEventListener('click', () => {
      this.playing = !this.playing;
      play.textContent = this.playing ? 'Pause' : 'Play';
      if (this.playing) this.scrub = null;
      apply();
    });
    tint.addEventListener('input', () => {
      this.tint = tint.value;
      this.holder.children.forEach((c) => this.applyTint(c));
    });
    if (model.options.length) {
      const pick = [...model.options].find((o) => o.value === 'model.wizardpack') ?? model.options[0];
      model.value = pick.value;
      void load();
    }
    stage.onFrame((dt) => {
      if (this.rig) this.rig.update(this.playing ? dt : 0);
    });
    stage.start();
  }

  private durations = new Map<string, number>();

  /** Multiplies the model's colours by the tint. Materials are cloned once so the shared model is never touched. */
  private applyTint(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      if (!mesh.userData.viewerCloned) {
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
        mesh.userData.viewerCloned = true;
      }
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshStandardMaterial).color?.set(this.tint || '#ffffff');
    });
  }

  dispose(): void {
    this.modelToken++;
    this.rig = null;
    this.stage?.dispose();
    this.stage = null;
    this.status = null;
  }
}
