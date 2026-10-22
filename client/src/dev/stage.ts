// A small 3D stage for the dev panel's animation pages: its own canvas and renderer, a floor, light, orbit and zoom, and a camera that
// frames whatever is on it. Made when a page opens and thrown away when it closes (nothing here touches the game's renderer).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetLoader } from '../assets/loader.ts';
import { decodeClip, type ClipFile } from '../anim/clips.ts';
import { CharacterRig } from '../anim/rig.ts';
import { fitHeight } from '../renderer/scene.ts';
import { frameBox } from './framing.ts';
import { clipsForRig } from './tools.ts';
import { el } from './dom.ts';

export type ViewName = 'side' | 'front' | 'behind' | 'above';

/** Camera directions from the subject (the subject faces +Z): the unit offset and the look-from height share. */
export const VIEWS: Record<ViewName, [number, number]> = {
  side: [-1.2, 0.2],
  front: [0, 0.25],
  behind: [Math.PI, 0.25],
  above: [-1.2, 1.2],
};

export class Stage {
  readonly root = el('div', { class: 'dev-stage' });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.05, 400);
  readonly canvas = el('canvas', { class: 'dev-canvas dev-stage-canvas' }) as HTMLCanvasElement;
  readonly subject = new THREE.Group();
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raf = 0;
  private last = 0;
  private watch: ResizeObserver | null = null;
  private tick: ((dt: number) => void) | null = null;
  private floor: THREE.Mesh;

  constructor() {
    this.root.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.scene.background = new THREE.Color(0x20242c);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.4);
    sun.position.set(3, 6, 4);
    this.scene.add(sun, this.subject);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x30363f }));
    this.scene.add(this.floor);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.camera.position.set(-2, 1.4, 3);
    this.watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.watch?.observe(this.root);
    this.resize();
  }

  /** Runs `fn` every frame before drawing (the page moves its model and effects here). */
  onFrame(fn: (dt: number) => void): void {
    this.tick = fn;
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick?.(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = Math.max(160, this.root.clientWidth || 560);
    const h = Math.max(120, this.root.clientHeight || Math.round(w * 0.72));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Looks at everything on the stage (the subject and any extra objects) from a direction, at a distance that shows all of it. */
  frame(view: ViewName = 'side', extra: THREE.Object3D[] = []): void {
    const box = new THREE.Box3();
    for (const o of [this.subject, ...extra]) {
      o.updateMatrixWorld(true);
      box.union(new THREE.Box3().setFromObject(o, true));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5));
    const f = frameBox(box, this.camera.fov, this.camera.aspect);
    const [yaw, lift] = VIEWS[view];
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(lift), Math.sin(lift), Math.cos(yaw) * Math.cos(lift)).normalize();
    this.controls.target.set(f.target.x, f.target.y, f.target.z);
    this.camera.position.set(f.target.x + dir.x * f.distance, f.target.y + dir.y * f.distance, f.target.z + dir.z * f.distance);
    this.camera.near = Math.max(0.02, f.distance / 200);
    this.camera.far = f.distance * 60;
    this.camera.updateProjectionMatrix();
    const reach = Math.max(1.2, box.max.x - box.min.x, box.max.z - box.min.z) * 0.8;
    this.floor.scale.setScalar(reach);
    this.floor.position.y = box.min.y - 0.01;
    this.controls.minDistance = f.distance * 0.15;
    this.controls.maxDistance = f.distance * 6;
    this.controls.update();
  }

  /** A row of view buttons for a toolbar. */
  viewButtons(extra: () => THREE.Object3D[] = () => []): HTMLElement[] {
    return (Object.keys(VIEWS) as ViewName[]).map((v) => {
      const b = el('button', { class: 'dev-viewbtn', title: `View from the ${v}` }, v[0].toUpperCase() + v.slice(1));
      b.addEventListener('click', () => this.frame(v, extra()));
      return b;
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.watch?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.subject.clear();
  }
}

/** The player's model with every baked clip of its rig, fitted to 1.8 m and standing on the floor, ready for a stage. */
export async function loadStagePlayer(loader: AssetLoader, rigName: string): Promise<{ root: THREE.Object3D; rig: CharacterRig }> {
  const gltf = await loader.loadModel(`model.${rigName}`);
  const root = cloneSkinned(gltf.scene);
  fitHeight(root, 1.8);
  const names = clipsForRig(loader.manifest, rigName);
  const files = await Promise.all(names.map((n) => loader.loadJson<ClipFile>(`clip.${rigName}.${n}`)));
  const decoded = files.map(decodeClip);
  if (!decoded.length) throw new Error(`no animation clips for ${rigName}`);
  const rig = new CharacterRig(root, decoded[0].bones);
  for (const c of decoded) rig.addClip(c);
  rig.name = rigName;
  return { root, rig };
}

/** The rigs the player can be, from the asset manifest (those that have both a model and baked clips). */
export function playerRigs(loader: AssetLoader): string[] {
  return ['wizardpack', 'oldwizard'].filter((r) => loader.has(`model.${r}`) && clipsForRig(loader.manifest, r).length > 0);
}
