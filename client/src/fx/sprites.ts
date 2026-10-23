// Spellwoven effects as billboards: a sheet of frames played on a quad that always faces the camera.
import * as THREE from 'three';
import type { Vec3 } from '@conflux/shared';
import type { AssetLoader, FxDef } from '../assets/loader.ts';

/** Pixels of an effect frame per metre of world, before the effect's own scale. */
const PIXELS_PER_METRE = 64;
/** The longest a looping sheet lives when it is spawned for an event (no `follow`): nothing owns it, so nothing would ever stop it. */
export const EVENT_LOOP_LIFE_MS = 1500;

export class SpriteFlipbook {
  constructor(
    readonly def: FxDef,
    readonly texture: THREE.Texture,
    filter: 'nearest' | 'linear',
  ) {
    const f = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    texture.magFilter = texture.minFilter = f;
    texture.generateMipmaps = false;
    texture.repeat.set(def.frame[0] / def.sheet[0], def.frame[1] / def.sheet[1]);
  }

  /** The frame showing t milliseconds after the start: a loop wraps, a one-shot holds its last frame. */
  frameAt(ms: number): number {
    const f = Math.floor(Math.max(0, ms) / this.def.ms);
    return this.def.loop ? f % this.def.frames : Math.min(f, this.def.frames - 1);
  }

  done(ms: number): boolean {
    return !this.def.loop && ms >= this.def.ms * this.def.frames;
  }

  /** Points the texture at a frame's cell; the rows count from the top of the sheet. */
  setFrame(frame: number): void {
    const { cols, frame: size, sheet } = this.def;
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    this.texture.offset.set((col * size[0]) / sheet[0], 1 - ((row + 1) * size[1]) / sheet[1]);
  }
}

export interface FxHandle {
  readonly done: boolean;
  /** Ends a looping effect (a one-shot ends itself). */
  stop(): void;
}

interface Instance {
  id: string;
  mesh: THREE.Mesh;
  book: SpriteFlipbook;
  start: number;
  scale: number;
  /** Milliseconds after which the effect ends whatever its sheet does, or null. */
  life: number | null;
  anchor: Vec3;
  follow: (() => Vec3 | null) | null;
  stopped: boolean;
  handle: FxHandle & { finish(): void };
}

/** Plays effects in a scene. Meshes are pooled per effect, so a busy fight allocates nothing after the first few seconds. */
export class FxSystem {
  private sheets = new Map<string, Promise<{ texture: THREE.Texture; def: FxDef }>>();
  private idle = new Map<string, Instance[]>();
  private live: Instance[] = [];
  private geometry = new THREE.PlaneGeometry(1, 1);
  private now = 0;
  /** Counts clears, so a spawn that was still loading its sheet when the room changed can tell and drop itself. */
  private epoch = 0;

  constructor(
    private scene: THREE.Scene,
    private loader: AssetLoader,
    private filter: 'nearest' | 'linear',
  ) {}

  get active(): number {
    return this.live.length;
  }

  /** The ids of the effects drawn right now (test hook). */
  liveIds(): string[] {
    return this.live.map((i) => i.id);
  }

  private sheet(id: string) {
    let p = this.sheets.get(id);
    if (!p) this.sheets.set(id, (p = this.loader.loadFxSheet(id, this.filter)));
    return p;
  }

  /** Starts an effect at a position (or following something). Resolves once its sheet is loaded; unknown ids reject. */
  async spawn(id: string, pos: Vec3, opts: { scale?: number; follow?: () => Vec3 | null; life?: number } = {}): Promise<FxHandle> {
    const epoch = this.epoch;
    const { texture, def } = await this.sheet(id);
    if (epoch !== this.epoch) return { done: true, stop: () => undefined };
    const inst = this.idle.get(id)?.pop() ?? this.make(id, texture, def);
    inst.start = this.now;
    inst.scale = opts.scale ?? 1;
    inst.life = opts.life ?? (def.loop && !opts.follow ? EVENT_LOOP_LIFE_MS : null);
    inst.anchor = { ...pos };
    inst.follow = opts.follow ?? null;
    inst.stopped = false;
    inst.mesh.visible = true;
    inst.handle = this.handleFor(inst);
    this.scene.add(inst.mesh);
    this.live.push(inst);
    return inst.handle;
  }

  private retire(inst: Instance): void {
    inst.mesh.visible = false;
    this.scene.remove(inst.mesh);
    inst.handle.finish();
    (this.idle.get(inst.id) ?? this.idle.set(inst.id, []).get(inst.id)!).push(inst);
  }

  /** Ends every live effect at once (a room change): followed ones too, and spawns still loading their sheet. */
  clear(): void {
    this.epoch++;
    for (const inst of this.live) this.retire(inst);
    this.live = [];
  }

  private handleFor(inst: Instance): FxHandle & { finish(): void } {
    let finished = false;
    return {
      get done() {
        return finished;
      },
      stop: () => {
        inst.stopped = true;
      },
      finish: () => {
        finished = true;
      },
    };
  }

  private make(id: string, shared: THREE.Texture, def: FxDef): Instance {
    const texture = shared.clone();
    texture.needsUpdate = true;
    const book = new SpriteFlipbook(def, texture, this.filter);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: def.blend === 'additive' || def.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    const inst: Instance = { id, mesh, book, start: 0, scale: 1, life: null, anchor: { x: 0, y: 0, z: 0 }, follow: null, stopped: false, handle: null as never };
    return inst;
  }

  /** Advances every effect and turns it to face the camera. */
  update(dt: number, camera: THREE.Camera): void {
    this.now += dt * 1000;
    const keep: Instance[] = [];
    for (const inst of this.live) {
      const ms = this.now - inst.start;
      if (inst.stopped || inst.book.done(ms) || (inst.life !== null && ms >= inst.life)) {
        this.retire(inst);
        continue;
      }
      inst.book.setFrame(inst.book.frameAt(ms));
      const d = inst.book.def;
      const w = (d.frame[0] / PIXELS_PER_METRE) * inst.scale;
      const h = (d.frame[1] / PIXELS_PER_METRE) * inst.scale;
      const at = inst.follow?.() ?? inst.anchor;
      inst.mesh.quaternion.copy(camera.quaternion);
      inst.mesh.scale.set(w, h, 1);
      // the sheet's anchor pixel sits on the position: move the quad's centre up by how far the anchor is below it
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const dy = ((d.anchor[1] - d.frame[1] / 2) / PIXELS_PER_METRE) * inst.scale;
      const dx = ((d.frame[0] / 2 - d.anchor[0]) / PIXELS_PER_METRE) * inst.scale;
      inst.mesh.position.set(at.x, at.y, at.z).addScaledVector(up, dy).addScaledVector(right, dx);
      keep.push(inst);
    }
    this.live = keep;
  }
}
