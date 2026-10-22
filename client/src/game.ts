// The playable game in the page: reads the player's controls, sends them to the sim worker, and draws what comes back
// (the player and enemies, effects, the HUD). The sim decides everything; this only shows it.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildWorld, hurtboxesFor, idleInput, resolveAim, type GameData, type Input, type RoomDef, type SimEvent, type SimBridge, type Snapshot, type Vec3, type World } from '@conflux/shared';
import { castClipFor, pickLocomotion, type LocoState } from './anim/locomotion.ts';
import type { CharacterRig } from './anim/rig.ts';
import type { AssetLoader } from './assets/loader.ts';
import { ThirdPersonCamera } from './camera.ts';
import { fxForEvent } from './fx/events.ts';
import type { FxHandle, FxSystem } from './fx/sprites.ts';
import type { Hud } from './hud/hud.ts';
import { InputController } from './input.ts';
import { applyTextureFilters, type RenderProfile } from './renderer/profile.ts';
import { fitHeight } from './renderer/scene.ts';
import { EnemyView } from './renderer/enemyView.ts';
import type { DebugFlags } from './dev/tools.ts';

export interface GameDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  loader: AssetLoader;
  bridge: SimBridge;
  data: () => GameData;
  room: RoomDef;
  playerModel: THREE.Object3D;
  rig: CharacterRig;
  fx: FxSystem;
  hud: Hud;
  profile: RenderProfile;
  flags: DebugFlags;
}

const LOG_LIMIT = 300;

export class Game {
  readonly input: InputController;
  world: World;
  /** False while a run screen is up: the controls are not read, so a click on a card is not a cast. */
  inputEnabled = true;
  /** The input to send instead of the controls (the browser smoke tests script the player with this). */
  scripted: Input | null = null;
  latest: Snapshot | null = null;
  readonly log: SimEvent[] = [];
  aimTarget: number | null = null;
  /** Test hooks: hold the player in a pose, or put the camera somewhere else. */
  poseOverride: { state: LocoState; castClip: string | null; castW: number; pitch: number } | null = null;
  cameraOverride: ((camera: THREE.PerspectiveCamera) => void) | null = null;

  private room: RoomDef;
  private cam: ThirdPersonCamera;
  private holder = new THREE.Group();
  private enemies = new Map<number, EnemyView>();
  private enemyLoads = new Set<number>();
  private dying: EnemyView[] = [];
  private projectiles = new Map<number, { handle: FxHandle | null; stopped: boolean; pos: Vec3 }>();
  private prevPos: Vec3 | null = null;
  private vel: Vec3 = { x: 0, y: 0, z: 0 };
  private castW = 0;
  private lastEnemies = new Map<number, Snapshot['enemies'][number]>();
  private lastYaw = 0;
  private lastCamOrigin: Vec3 = { x: 0, y: 1.6, z: 0 };

  constructor(private d: GameDeps) {
    this.room = d.room;
    this.world = buildWorld(d.room);
    this.cam = new ThirdPersonCamera(this.world);
    this.input = new InputController(d.canvas);
    fitHeight(d.playerModel, 1.8);
    applyTextureFilters(d.playerModel, d.profile);
    this.holder.add(d.playerModel);
    this.holder.position.set(d.room.spawns.player.x, 0, d.room.spawns.player.z);
    d.scene.add(this.holder);
    d.hud.setCamera(d.camera);
    d.bridge.onFrame((s, events) => this.onFrame(s, events));
  }

  /** Moves the game into another room: a new world and camera, the old room's enemies and effects cleared. */
  loadRoom(room: RoomDef): void {
    this.room = room;
    this.world = buildWorld(room);
    this.cam = new ThirdPersonCamera(this.world);
    for (const view of [...this.enemies.values(), ...this.dying]) this.d.scene.remove(view.root);
    this.enemies.clear();
    this.dying = [];
    this.enemyLoads.clear();
    this.lastEnemies.clear();
    for (const rec of this.projectiles.values()) rec.handle?.stop();
    this.projectiles.clear();
    this.latest = null;
    this.prevPos = null;
    this.holder.position.set(room.spawns.player.x, 0, room.spawns.player.z);
  }

  private onFrame(s: Snapshot, events: SimEvent[]): void {
    const p = s.players[0];
    if (this.prevPos && this.latest) {
      const dt = Math.max(1e-3, s.time - this.latest.time);
      this.vel = { x: (p.pos.x - this.prevPos.x) / dt, y: 0, z: (p.pos.z - this.prevPos.z) / dt };
    }
    this.prevPos = { ...p.pos };
    this.latest = s;
    for (const en of s.enemies) this.lastEnemies.set(en.id, en);
    const skills = this.d.data().skills;
    for (const e of events) {
      if (e.type === 'reaction' || e.type === 'hit') {
        this.log.push(e);
        if (this.log.length > LOG_LIMIT) this.log.shift();
      }
      if (e.type === 'hit' && e.target === 'enemy') this.onEnemyHit(e, s);
      const at = fxForEvent(e, skills);
      if (!at) continue;
      const pos = this.where(e, at.at, s);
      if (pos) void this.d.fx.spawn(at.id, pos).catch(() => undefined);
    }
    this.syncProjectiles(s);
  }

  /** A hit on an enemy: flash it and float the number up. A weakness hit shows bigger. */
  private onEnemyHit(e: SimEvent, s: Snapshot): void {
    const snap = s.enemies.find((x) => x.id === e.id) ?? this.lastEnemies.get(e.id as number);
    this.enemies.get(e.id as number)?.hurt();
    const element = this.d.data().skills[String(e.skillId)]?.element;
    const def = snap ? this.d.data().enemies[snap.defId] : undefined;
    const weak = !!(element && def?.weak.includes(element));
    this.d.hud.addDamage({ x: e.x as number, y: e.y as number, z: e.z as number }, e.amount as number, weak);
  }

  private where(e: SimEvent, at: 'pos' | 'target', s: Snapshot): Vec3 | null {
    if (at === 'pos') {
      const pos = e.pos as Vec3 | undefined;
      if (pos) return pos;
      if (typeof e.x === 'number') return { x: e.x as number, y: e.y as number, z: e.z as number };
      return null;
    }
    const enemy = s.enemies.find((x) => x.id === (e.enemyId ?? e.id));
    return enemy ? enemy.pos : s.players[0].pos;
  }

  private syncProjectiles(s: Snapshot): void {
    const skills = this.d.data().skills;
    const seen = new Set<number>();
    for (const q of s.projectiles) {
      seen.add(q.id);
      let rec = this.projectiles.get(q.id);
      if (!rec) {
        rec = { handle: null, stopped: false, pos: { ...q.pos } };
        this.projectiles.set(q.id, rec);
        const id = skills[q.skillId]?.fx?.travel;
        const r = rec;
        if (id) {
          void this.d.fx
            .spawn(id, q.pos, { scale: 0.6, follow: () => r.pos })
            .then((h) => {
              r.handle = h;
              if (r.stopped) h.stop();
            })
            .catch(() => undefined);
        }
      }
      rec.pos = { ...q.pos };
    }
    for (const [id, rec] of this.projectiles) {
      if (seen.has(id)) continue;
      rec.stopped = true;
      rec.handle?.stop();
      this.projectiles.delete(id);
    }
  }

  /** The yaw and pitch that put the crosshair on a point, allowing for the camera sitting behind the shoulder (test and tool helper). */
  aimAt(target: Vec3): { aimYaw: number; aimPitch: number } {
    const feet = this.latest?.players[0].pos ?? this.room.spawns.player;
    let yaw = 0;
    let pitch = 0;
    for (let i = 0; i < 5; i++) {
      const o = this.cam.update(feet, yaw, pitch).origin;
      const dx = target.x - o.x;
      const dz = target.z - o.z;
      yaw = Math.atan2(dx, dz);
      pitch = Math.atan2(target.y - o.y, Math.hypot(dx, dz));
    }
    return { aimYaw: yaw, aimPitch: pitch };
  }

  /** Runs one frame: controls out, camera, models and HUD in. Call before rendering. */
  update(dt: number): void {
    const snap = this.latest;
    const player = snap?.players[0];
    const base = this.scripted ?? (this.inputEnabled ? this.input.poll(this.lastCamOrigin) : { ...idleInput(), aimYaw: this.lastYaw, aimPitch: 0 });
    this.lastYaw = base.aimYaw;
    const feet = player?.pos ?? this.room.spawns.player;
    const cam = this.cam.update(feet, base.aimYaw, base.aimPitch);
    this.lastCamOrigin = cam.origin;
    this.d.camera.position.set(cam.origin.x, cam.origin.y, cam.origin.z);
    this.d.camera.lookAt(cam.origin.x + Math.sin(cam.yaw) * Math.cos(cam.pitch), cam.origin.y + Math.sin(cam.pitch), cam.origin.z + Math.cos(cam.yaw) * Math.cos(cam.pitch));
    this.cameraOverride?.(this.d.camera);
    this.d.bridge.send({ ...base, camOrigin: cam.origin });
    this.d.bridge.advance(Math.min(dt, 0.25));
    if (!snap || !player) return;
    this.input.setElement(Math.max(0, player.equipped.indexOf(player.element as never)));

    this.holder.position.set(player.pos.x, player.pos.y, player.pos.z);
    this.holder.rotation.y = player.facing;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const state = pickLocomotion(this.vel, player.facing, speed, player.dodging);
    const skill = player.casting ? this.d.data().skills[player.casting] : undefined;
    const clip = skill ? (this.d.rig.hasClip(skill.cast.clip) ? skill.cast.clip : castClipFor(skill.cast.archetype)) : null;
    this.castW += ((clip ? 1 : 0) - this.castW) * Math.min(1, dt * 15);
    const o = this.poseOverride;
    if (o) this.d.rig.play(o.state, o.castClip, o.castW, o.pitch);
    else this.d.rig.play(state, clip, this.castW, base.aimPitch);
    this.d.rig.update(Math.min(dt, 0.1));
    this.syncEnemies(snap, dt);

    const boxes = snap.enemies.flatMap((e) => {
      const def = this.d.data().enemies[e.defId];
      return def ? hurtboxesFor(def, e.pos, e.facing, e.id) : [];
    });
    this.aimTarget = resolveAim(this.world, boxes, cam.origin, cam.yaw, cam.pitch, this.d.data().player.maxAimRange).hitEnemy;
    this.d.hud.update(snap, this.aimTarget, this.d.flags.aiState);
  }

  private syncEnemies(s: Snapshot, dt: number): void {
    const seen = new Set<number>();
    for (const e of s.enemies) {
      seen.add(e.id);
      const view = this.enemies.get(e.id);
      if (view) {
        view.update(e, dt);
      } else if (!this.enemyLoads.has(e.id)) {
        this.enemyLoads.add(e.id);
        void this.loadEnemy(e.id, e.defId, e.pos);
      }
    }
    for (const [id, view] of this.enemies) {
      if (seen.has(id)) continue;
      view.die(); // it plays its death and is removed when that is over
      this.dying.push(view);
      this.enemies.delete(id);
      this.enemyLoads.delete(id);
      this.lastEnemies.delete(id);
    }
    for (const view of this.dying) view.advanceDeath(dt);
    this.dying = this.dying.filter((view) => {
      if (!view.finished) return true;
      this.d.scene.remove(view.root);
      return false;
    });
  }

  private async loadEnemy(id: number, defId: string, pos: Vec3): Promise<void> {
    const def = this.d.data().enemies[defId];
    try {
      const gltf = await this.d.loader.loadModel(def.model);
      const model = cloneSkinned(gltf.scene);
      model.animations = gltf.animations; // a clone does not carry the model's own clips
      applyTextureFilters(model, this.d.profile);
      const view = new EnemyView(def, model);
      view.root.position.set(pos.x, pos.y, pos.z);
      if (!this.enemyLoads.has(id)) return; // it died while loading
      this.enemies.set(id, view);
      this.d.scene.add(view.root);
    } catch {
      this.enemyLoads.delete(id);
    }
  }

  /** How many enemies have a model on screen (test hook). */
  get enemyViews(): number {
    return this.enemies.size;
  }
}
