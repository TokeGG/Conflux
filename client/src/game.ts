// The playable game in the page: reads the player's controls, sends them to the sim worker, and draws what comes back
// (the player and enemies, effects, the HUD). The sim decides everything; this only shows it.
import { FxKeeper, statusFxLayers, zoneFxFor, type KeptFx } from './fx/keeper.ts';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildWorld, hurtboxesFor, idleInput, resolveAim, type GameData, type Input, type RoomDef, type SimEvent, type SimBridge, type Snapshot, type Vec3, type World } from '@conflux/shared';
import { pickLocomotion, type LocoState } from './anim/locomotion.ts';
import { castClipChoice, castSpeed } from './anim/castTiming.ts';
import type { CharacterRig } from './anim/rig.ts';
import type { AssetLoader } from './assets/loader.ts';
import { effectiveFov, NEUTRAL_FOV, ThirdPersonCamera } from './camera.ts';
import { fxForEvent } from './fx/events.ts';
import { castExtras, keptCastFx } from './fx/castFx.ts';
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

/** The width in metres of an effect frame at scale 1 (192 px at 64 px a metre), so a zone effect can be sized to its radius. */
/** A zone's ground effect is drawn so that its art (about this many metres of a 3 m frame) spans the zone, so the effect reads. */
const ZONE_FX_METRES = 1.8;

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
  /** The player's own settings: mouse sensitivity (a multiplier) and field of view. The camera data (camera.json) is what they are applied to. */
  sensitivityScale = 1;
  fovSetting = NEUTRAL_FOV;

  private room: RoomDef;
  private cam: ThirdPersonCamera;
  private holder = new THREE.Group();
  private enemies = new Map<number, EnemyView>();
  private souls = new Map<number, THREE.Mesh>();
  private soulGeo = new THREE.IcosahedronGeometry(0.16);
  private soulMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
  private enemyLoads = new Set<number>();
  private dying: EnemyView[] = [];
  private projectiles = new Map<number, { handle: FxHandle | null; stopped: boolean; pos: Vec3 }>();
  private prevPos: Vec3 | null = null;
  private vel: Vec3 = { x: 0, y: 0, z: 0 };
  private castW = 0;
  private lastEnemies = new Map<number, Snapshot['enemies'][number]>();
  private lastYaw = 0;
  private lastCamOrigin: Vec3 = { x: 0, y: 1.6, z: 0 };

  private keeper: FxKeeper;

  constructor(private d: GameDeps) {
    this.keeper = new FxKeeper((id, pos, opts) => d.fx.spawn(id, pos, opts));
    this.room = d.room;
    this.world = buildWorld(d.room);
    this.cam = new ThirdPersonCamera(this.world, () => this.d.data().camera);
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
    this.cam = new ThirdPersonCamera(this.world, () => this.d.data().camera);
    for (const view of [...this.enemies.values(), ...this.dying]) this.d.scene.remove(view.root);
    this.enemies.clear();
    for (const m of this.souls.values()) this.d.scene.remove(m);
    this.souls.clear();
    this.dying = [];
    this.enemyLoads.clear();
    this.lastEnemies.clear();
    this.clearFx();
    this.latest = null;
    this.prevPos = null;
    this.holder.position.set(room.spawns.player.x, 0, room.spawns.player.z);
    // a new room opens with the player looking toward its middle (the stalls, the enemies) instead of at whatever wall the last yaw met
    const { x, z } = room.spawns.player;
    if (Math.hypot(x, z) > 3) {
      this.input.yaw = Math.atan2(-x, -z);
      this.input.pitch = 0;
    }
  }

  /** Ends every effect of the room that is going away: event effects, kept status and zone effects, projectile effects. */
  clearFx(): void {
    for (const rec of this.projectiles.values()) {
      rec.stopped = true;
      rec.handle?.stop();
    }
    this.projectiles.clear();
    this.keeper.reset();
    this.d.fx.clear();
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
      if (e.type === 'cast_fire') for (const piece of castExtras(e, skills, p.pos)) void this.d.fx.spawn(piece.id, piece.pos, { scale: piece.scale, dir: piece.dir }).catch(() => undefined);
      const at = fxForEvent(e, skills);
      if (!at) continue;
      const pos = this.where(e, at.at, s);
      if (pos) void this.d.fx.spawn(at.id, pos, at.scale ? { scale: at.scale } : {}).catch(() => undefined);
    }
    this.syncProjectiles(s);
    this.syncPersistentFx(s);
    this.syncSouls(s);
  }

  /** Souls on the floor: a small bobbing light for each, bigger the more it is worth. */
  private syncSouls(s: Snapshot): void {
    const seen = new Set<number>();
    for (const k of s.pickups) {
      seen.add(k.id);
      let m = this.souls.get(k.id);
      if (!m) {
        m = new THREE.Mesh(this.soulGeo, this.soulMat);
        m.scale.setScalar(Math.min(2.2, 0.8 + Math.sqrt(k.value) * 0.18));
        this.souls.set(k.id, m);
        this.d.scene.add(m);
      }
      m.position.set(k.pos.x, k.pos.y + 0.5 + Math.sin(s.time * 3 + k.id) * 0.1, k.pos.z);
    }
    for (const [id, m] of this.souls) {
      if (seen.has(id)) continue;
      this.d.scene.remove(m);
      this.souls.delete(id);
    }
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

  /** Ground fire, cyclones and tornadoes while their zones last, and a swirl, flames or drops round enemies carrying a status. */
  private syncPersistentFx(s: Snapshot): void {
    const skills = this.d.data().skills;
    const active = new Map<string, KeptFx>();
    for (const z of s.zones) {
      const fx = zoneFxFor(z.kind, skills);
      if (fx) active.set(`z${z.id}`, { id: fx.id, pos: { x: z.pos.x, y: z.pos.y + 0.05, z: z.pos.z }, scale: Math.max(0.9, (z.radius * 2) / ZONE_FX_METRES) });
    }
    const enemies = this.d.data().enemies;
    for (const e of s.enemies) {
      const def = enemies[e.defId];
      const height = def ? Math.max(...def.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r)) * def.scale : 2;
      for (const st of [...e.statuses, ...(e.marks ?? [])]) {
        statusFxLayers(st.id, height).forEach((fx, i) => active.set(`s${e.id}.${st.id}.${i}`, { id: fx.id, pos: { x: e.pos.x, y: e.pos.y + fx.y, z: e.pos.z }, scale: fx.scale }));
      }
    }
    for (const [key, fx] of keptCastFx(s.players[0], skills, this.d.data().player.castOrigin)) active.set(`p${key}`, fx);
    void this.keeper.sync(active);
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
    const feel = this.d.data().camera;
    this.input.sensitivity = feel.mouseSensitivity * this.sensitivityScale;
    this.input.pitchMin = feel.pitchMin;
    this.input.pitchMax = feel.pitchMax;
    const fov = effectiveFov(this.fovSetting, feel.fov);
    if (this.d.camera.fov !== fov) {
      this.d.camera.fov = fov;
      this.d.camera.updateProjectionMatrix();
    }
    const cam = this.cam.update(feet, base.aimYaw, base.aimPitch, dt);
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
    const anim = this.d.data().animation.rigs[this.d.rig.name];
    this.d.rig.setMapping(anim ?? null);
    const clip = skill ? castClipChoice(skill.cast, (n) => this.d.rig.hasClip(n), anim?.cast) : null;
    this.d.rig.setCastSpeed(skill && clip ? castSpeed(skill.cast.fireAt, this.d.rig.clipDuration(clip), skill.cast.windup) : 1);
    this.castW += ((clip ? (skill?.cast.blend ?? 1) : 0) - this.castW) * Math.min(1, dt * (anim?.castBlendRate ?? 15));
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

  /** The light of the first boss on screen, for the room's reserved aura slot. */
  bossAura(): ReturnType<EnemyView['auraLight']> {
    for (const v of this.enemies.values()) {
      const a = v.auraLight();
      if (a) return a;
    }
    return null;
  }

  /** The body pose of every enemy on screen (test hook). */
  enemyPoses(): (ReturnType<EnemyView['debugPose']> & { sim: number })[] {
    return [...this.enemies].map(([sim, v]) => ({ sim, ...v.debugPose() }));
  }

  /** Where a named bone of the player's model is, as metres forward, right and up of the player's feet along the facing (test hook for measuring the casting hand). */
  boneLocal(name: string): { forward: number; right: number; up: number; t: number } | null {
    const node = this.d.playerModel.getObjectByName(name);
    const p = this.latest?.players[0];
    if (!node || !p) return null;
    this.d.scene.updateMatrixWorld(true);
    const w = node.getWorldPosition(new THREE.Vector3());
    const dx = w.x - p.pos.x;
    const dz = w.z - p.pos.z;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    return { forward: dx * fx + dz * fz, right: dz * fx - dx * fz, up: w.y - p.pos.y, t: this.d.rig.castClipTime() };
  }

  /** boneLocal with the legs pinned to one moment of a clip (test hook: the hand at the release frame of a cast clip). */
  boneAtClip(name: string, clip: string, time: number): ReturnType<Game['boneLocal']> {
    this.d.rig.showClip(clip, time);
    this.d.rig.update(0);
    const out = this.boneLocal(name);
    this.d.rig.showClip(null);
    return out;
  }

  /** How many enemies have a model on screen (test hook). */
  get enemyViews(): number {
    return this.enemies.size;
  }
}
