// The animation and model viewer: any model, any baked clip, a scrubber, the upper-body mask test, the cast clip per archetype
// and a tint preview. It has its own small canvas, made when the page opens and thrown away when it closes.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { decodeClip, type ClipFile } from '../anim/clips.ts';
import { CharacterRig } from '../anim/rig.ts';
import castMap from '../anim/castMap.json' with { type: 'json' };
import type { AssetLoader } from '../assets/loader.ts';
import { el } from './dom.ts';
import type { DevPage } from './page.ts';
import { clipsForRig, scrubTime } from './tools.ts';

const SIZE = { w: 420, h: 320 };

export class AnimViewerPage implements DevPage {
  readonly id = 'anim';
  readonly title = 'Animation viewer';
  private renderer: THREE.WebGLRenderer | null = null;
  private raf = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, SIZE.w / SIZE.h, 0.05, 100);
  private holder = new THREE.Group();
  private rig: CharacterRig | null = null;
  private clipDuration = 1;
  private playing = true;
  private scrub: number | null = null;
  private tint = '';
  private last = 0;
  private status: HTMLElement | null = null;
  private clock = 0;
  private modelToken = 0;

  constructor(private loader: AssetLoader) {
    this.scene.background = new THREE.Color(0x20242c);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5), this.holder);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x30363f }));
    this.scene.add(floor);
    this.camera.position.set(0.6, 1.5, 3.8);
    this.camera.lookAt(0, 0.9, 0);
  }

  private modelIds(): string[] {
    return this.loader.manifest.filter((a) => a.id.startsWith('model.')).map((a) => a.id).sort();
  }

  private rigNameFor(modelId: string): string | null {
    const rig = modelId.slice('model.'.length);
    return clipsForRig(this.loader.manifest, rig).length ? rig : null;
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const canvas = el('canvas', { id: 'viewer-canvas', width: String(SIZE.w), height: String(SIZE.h), class: 'dev-canvas' });
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(SIZE.w, SIZE.h, false);
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
    host.append(canvas, controls, this.status);

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
        this.fit(root);
        this.holder.add(root);
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
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.clock += dt;
      this.holder.rotation.y = this.rig ? 0 : this.clock * 0.6;
      if (this.rig && this.playing) this.rig.update(dt);
      else if (this.rig) this.rig.update(0);
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private durations = new Map<string, number>();

  /** Scales the model to about 1.8 m tall and stands it on the floor. */
  private fit(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y || 1;
    root.scale.multiplyScalar(1.8 / h);
    root.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(root);
    root.position.y -= b2.min.y;
  }

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
    cancelAnimationFrame(this.raf);
    this.modelToken++;
    this.holder.clear();
    this.rig = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.status = null;
  }
}
