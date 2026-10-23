// How one enemy looks and moves: its model fitted to its hurtboxes, tinted, and animated by its own clips, baked clips or procedural motion.
import * as THREE from 'three';
import type { EnemyDef, EnemySnap } from '@conflux/shared';
import { defaultParams, PRESETS, type PresetParams } from '../anim/procedural.ts';
import { dampAngle, dampTo, mobMotion, MOTION } from '../anim/mobMotion.ts';
import { ATTACK_TIMING, AttackTracker, attackClip, CLIPPED_BODY_WEIGHT, CLIP_HIT_FRACTION, REST_FRAME, attackPose, type AttackNow, type AttackPose } from '../anim/attackAnim.ts';
import { AURA_PULSE, auraOf, pulseHz, pulseLevel } from '../anim/bossAura.ts';
import type { AuraDef } from '@conflux/shared';
import { REAPER_RIG, findRigParts, makeScythePivot, poseRig, type RigParts } from '../anim/mobParts.ts';
import { statusLook, type StatusIn } from '../anim/statusLook.ts';
import { fitHeight } from './scene.ts';

const FADE = 0.2;
const ZERO = new THREE.Color(0, 0, 0);
const MOVING = 0.4;
/** Every enemy's colours are multiplied by this, so models from different sources sit in one cool, gloomy palette. */
const GRADE = new THREE.Color('#9fb0d6').multiplyScalar(0.9);
const DEATH_SECONDS = 0.55;

type PresetName = keyof typeof PRESETS;

export class EnemyView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private parts: { obj: THREE.Object3D; pos: THREE.Vector3; rotY: number; phase: number }[] = [];
  private clock = 0;
  private prev: { x: number; z: number } | null = null;
  private moving = false;
  private attackSince = -1;
  /** Where the view is drawn: it follows the simulation's position and turn smoothly instead of snapping to each tick. */
  private shown: { x: number; y: number; z: number; yaw: number } | null = null;
  private speed = 0;
  private hurtT = -1;
  private spawnT = 0;
  private phase = 0;
  private lifeScale = new THREE.Vector3();
  private lastAttack: string | null = null;
  private tracker = new AttackTracker();
  private attackNow: AttackNow | null = null;
  private pose: AttackPose = { ...REST_FRAME, energy: 0 };
  private rigParts: RigParts | null = null;
  private ring: THREE.Mesh | null = null;
  private aura: AuraDef | null = null;
  private auraPhase = 0;
  private auraLevel = 1;
  private clipAttack = false;
  private lastStage: string | null = null;

  constructor(
    readonly def: EnemyDef,
    model: THREE.Object3D,
    animations: THREE.AnimationClip[] = model.animations ?? [],
  ) {
    const top = Math.max(...def.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r));
    fitHeight(model, top * def.scale);
    this.ownMaterials(model);
    for (const m of this.materials) {
      m.color?.multiply(GRADE);
      m.metalness = Math.min(m.metalness ?? 0, 0.1); // nothing to reflect in this scene, so metal would draw black
    }
    if (def.tint) this.tint(model, def.tint);
    for (const m of this.materials) this.baseColor.set(m, m.color.clone());
    this.body.add(model);
    this.root.add(this.body);
    if (def.rig.type !== 'procedural' && animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    const pivot = def.model === REAPER_RIG.model ? makeScythePivot(model) : null;
    this.rigParts = findRigParts(model, def.model, pivot, animations);
    if (!this.rigParts.weapon && !this.rigParts.book && !this.rigParts.bones.length) this.rigParts = null;
    this.clipAttack = !!def.rig.clips?.attack && animations.length > 0;
    this.aura = auraOf(def);
    if (this.aura) this.bossPresence(this.aura);
    if (def.rig.type === 'procedural' && def.rig.preset === 'part_sway') {
      // a model made of separate parts: each one sways on its own beat
      let i = 0;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) this.parts.push({ obj: o, pos: o.position.clone(), rotY: o.rotation.y, phase: i++ * 0.13 });
      });
    }
  }

  private materials: THREE.MeshStandardMaterial[] = [];
  /** The resting glow of each material (the tint's), which the hurt flash returns to. */
  private glow = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  /** Each material's colour without any status on it, which the status look pulls away from and back to. */
  private baseColor = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  private lookTo = new THREE.Color();
  private flashLeft = 0;
  private dyingFor = -1;

  /** Gives this enemy its own copies of the materials, so a flash on one does not light up every enemy of its kind. */
  private ownMaterials(model: THREE.Object3D): void {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      for (const m of mats) if ((m as THREE.MeshStandardMaterial).emissive) this.materials.push(m as THREE.MeshStandardMaterial);
    });
  }

  /** A boss's own aura: a faint rim glow of its colour on the materials and a ring on the floor (the point light is lent by the room's lights, see `auraLight`). */
  private bossPresence(a: AuraDef): void {
    const add = new THREE.Color(a.color).multiplyScalar(AURA_PULSE.glowShare);
    for (const m of this.materials) {
      const g = (this.glow.get(m) ?? new THREE.Color(0, 0, 0)).clone().add(add);
      this.glow.set(m, g);
      m.emissive.copy(g);
    }
    const r = Math.max(...this.def.hurtboxes.map((h) => h.r)) * 1.7;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(a.color), transparent: true, opacity: AURA_PULSE.ringOpacity, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.84, r, 56), mat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.ring.name = 'boss_ring';
    this.root.add(this.ring);
  }

  /** What the body looks like right now (test hook): its offsets, lean, squash and the attack's stage. */
  debugPose(): { id: string; stage: string | null; energy: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; scaleY: number; weapon: number } {
    const b = this.body;
    return { id: this.def.id, stage: this.attackNow?.stage ?? null, energy: this.pose.energy, y: b.position.y, z: b.position.z, rotX: b.rotation.x, rotY: b.rotation.y, rotZ: b.rotation.z, scaleY: b.scale.y, weapon: this.rigParts?.weapon?.rotation.x ?? 0 };
  }

  /** Where the boss's point light goes and how bright it is right now (null for a mob), for the room's reserved slot. */
  auraLight(): { x: number; y: number; z: number; color: string; intensity: number; radius: number } | null {
    if (!this.aura || this.dyingFor >= 0) return null;
    return { x: this.root.position.x, y: this.root.position.y + 2, z: this.root.position.z, color: this.aura.color, intensity: this.aura.intensity * this.auraLevel, radius: this.aura.radius };
  }

  /** A short red flash when hit. */
  hurt(): void {
    this.flashLeft = 0.14;
    this.hurtT = 0;
  }

  /** Starts the death animation (shrink and sink); `finished` says when it is over and the view can be removed. */
  die(): void {
    if (this.dyingFor < 0) this.dyingFor = 0;
  }

  /** Plays the death: the enemy shrinks and sinks into the ground. */
  advanceDeath(dt: number): void {
    if (this.dyingFor < 0) return;
    this.dyingFor += dt;
    const k = Math.min(1, this.dyingFor / DEATH_SECONDS);
    this.root.scale.setScalar(Math.max(0.001, 1 - k));
    this.root.position.y -= dt * 0.8;
  }

  get finished(): boolean {
    return this.dyingFor >= DEATH_SECONDS;
  }

  /** Multiplies the model's colours by the tint and adds a faint glow of it, on copies so the shared model is untouched. */
  private tint(model: THREE.Object3D, hex: string): void {
    const c = new THREE.Color(hex);
    for (const m of this.materials) {
      m.color?.multiply(c);
      this.glow.set(m, c.clone().multiplyScalar(0.08));
      m.emissive.copy(this.glow.get(m)!);
    }
  }

  /** The colour and glow of a mob that carries statuses or marks, on top of its tint; the hurt flash still wins. */
  private applyLook(snap: EnemySnap): void {
    const on: StatusIn[] = [...snap.statuses, ...(snap.marks ?? [])];
    const look = statusLook(on, this.clock + (snap.id % 5) * 0.37);
    this.lookTo.setRGB(look.colorTo[0], look.colorTo[1], look.colorTo[2]);
    for (const m of this.materials) {
      const base = this.baseColor.get(m);
      if (base) m.color.copy(base).lerp(this.lookTo, look.colorAmount);
      if (this.flashLeft > 0) m.emissive.setRGB(0.9, 0.1, 0.05);
      else {
        m.emissive.copy(this.glow.get(m) ?? ZERO);
        m.emissive.r += look.emissive[0];
        m.emissive.g += look.emissive[1];
        m.emissive.b += look.emissive[2];
      }
    }
  }

  private pick(snap: EnemySnap): string | null {
    const clips = this.def.rig.clips;
    if (!clips) return null;
    const one = (v: string | string[] | undefined, key = 0) => (Array.isArray(v) ? v[key % v.length] : v);
    const id = this.attackNow?.id ?? snap.attack;
    if (id) return attackClip(this.def.rig, id);
    if (snap.guardOn) return one(clips.guard) ?? null;
    if (this.moving) return one(clips.walk) ?? one(clips.idle) ?? null;
    return one(clips.idle) ?? null;
  }

  private play(name: string | null): void {
    const next = name ? this.actions.get(name) : undefined;
    if (!next || next === this.current) return;
    next.reset().fadeIn(this.attackNow ? 0.08 : FADE).play();
    next.setLoop(this.attackNow ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!this.attackNow;
    this.current?.fadeOut(FADE);
    this.current = next;
  }

  update(snap: EnemySnap, dt: number): void {
    this.clock += dt;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.applyLook(snap);
    const step = this.prev ? Math.hypot(snap.pos.x - this.prev.x, snap.pos.z - this.prev.z) / Math.max(dt, 1e-3) : 0;
    this.speed = dampTo(this.speed, step, 10, dt);
    this.moving = this.prev ? step > MOVING : false;
    this.prev = { x: snap.pos.x, z: snap.pos.z };
    // follow the simulation smoothly (it ticks at 60 Hz whatever the screen does) and turn the short way round
    if (!this.shown) this.shown = { x: snap.pos.x, y: snap.pos.y, z: snap.pos.z, yaw: snap.facing };
    const s = this.shown;
    s.x = dampTo(s.x, snap.pos.x, MOTION.followRate, dt);
    s.y = dampTo(s.y, snap.pos.y, MOTION.followRate, dt);
    s.z = dampTo(s.z, snap.pos.z, MOTION.followRate, dt);
    s.yaw = dampAngle(s.yaw, snap.facing, MOTION.turnRate, dt);
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    this.spawnT += dt;
    if (this.hurtT >= 0) this.hurtT += dt;
    this.phase = (snap.id % 7) * 0.9;
    if (snap.attack && snap.attack !== this.lastAttack) this.attackSince = this.clock;
    if (!snap.attack) this.attackSince = -1;
    this.lastAttack = snap.attack;
    // the attack's stage and progress come from the simulation: the wind-up follows its own clock, so the strike lands on the hit moment
    this.attackNow = this.tracker.update(snap.attack, snap.attackPhase, snap.attackProgress, dt);
    this.pose = this.attackNow ? attackPose(this.attackNow.id, this.attackNow.stage, this.attackNow.u, this.clock, this.attackNow.from) : { ...REST_FRAME, energy: 0 };
    if (this.aura) {
      const windup = this.attackNow?.stage === 'windup' ? this.attackNow.u : 0;
      this.auraPhase = (this.auraPhase + dt * pulseHz(snap.maxHp > 0 ? snap.hp / snap.maxHp : 1, windup)) % 1;
      this.auraLevel = pulseLevel(this.auraPhase, this.pose.energy);
      if (this.ring) (this.ring.material as THREE.MeshBasicMaterial).opacity = AURA_PULSE.ringOpacity * this.auraLevel;
    }

    // the body starts each frame at rest; the animation and the extra life are laid on it
    this.body.position.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    if (this.mixer) {
      this.play(this.pick(snap));
      // a walk cycle plays at the pace the mob actually moves, so its feet do not skate
      if (this.current && this.moving && !snap.attack) this.current.timeScale = Math.max(0.6, Math.min(1.7, this.speed / Math.max(this.def.speed, 0.5)));
      else if (this.current) this.current.timeScale = 1;
      this.driveAttackClip();
      this.mixer.update(dt);
    }
    // bones are added to after the mixer has written them; the scythe and the book's parts are set from rest
    if (this.rigParts) poseRig(this.rigParts, this.pose, this.bodyWeight());
    if (this.def.rig.type === 'procedural') this.proceduralPose(snap);
    this.addLife();
  }

  /** How much of the whole-body pose to lay on: all of it for a mob with no attack clip, less for one whose clip already moves its limbs. */
  private bodyWeight(): number {
    return this.clipAttack ? CLIPPED_BODY_WEIGHT : 1;
  }

  /** A rigged mob's attack clip is scrubbed through the wind-up by the sim's progress, so its blow falls on the hit moment, and plays on freely after. */
  private driveAttackClip(): void {
    const act = this.current;
    const now = this.attackNow;
    if (!act || !now || !this.clipAttack || !this.def.rig.clips?.attack) {
      if (act) act.timeScale = this.moving && !now ? act.timeScale : 1;
      return;
    }
    const dur = act.getClip().duration;
    const hit = (CLIP_HIT_FRACTION[act.getClip().name] ?? ATTACK_TIMING.clipHitFraction) * dur;
    if (now.stage === 'windup') {
      act.timeScale = 0;
      act.time = Math.min(hit, now.u * hit);
    } else {
      if (this.lastStage === 'windup') act.time = hit;
      act.timeScale = 1;
    }
    this.lastStage = now.stage;
  }

  /** The motion every mob gets on top of its own animation: breathing, lean, bob, attack draw-back and thrust, hit kick and spawn pop. */
  private addLife(): void {
    const m = mobMotion({ t: this.clock, speed: this.speed, attackT: -1, hurtT: this.hurtT, spawnT: this.spawnT, phase: this.phase });
    const procedural = this.def.rig.type === 'procedural';
    // a procedural mob already breathes and bobs through its preset; the lean, the attack, the hit and the spawn pop still apply
    this.body.position.x += m.pos.x;
    this.body.position.y += procedural ? 0 : m.pos.y;
    this.body.position.z += m.pos.z;
    // the attack's own pose: the whole body leans, rises, twists and squashes through the wind-up, the strike and the recovery
    const w = this.bodyWeight();
    const p = this.pose;
    this.body.position.x += 0;
    this.body.position.y += p.y * w;
    this.body.position.z += p.z * w;
    this.body.rotation.x = m.tilt + p.tilt * w;
    this.body.rotation.y += p.yaw * w + (this.rigParts?.book ? 0 : p.spin * w);
    this.body.rotation.z = p.roll * w;
    this.body.scale.multiply(this.lifeScale.set(m.scale.x * (1 + p.sxz * w), m.scale.y * (1 + p.sy * w), m.scale.z * (1 + p.sxz * w)));
  }

  private proceduralPose(snap: EnemySnap): void {
    const preset = (this.def.rig.preset ?? 'hover') as PresetName;
    const fn = PRESETS[preset] ?? PRESETS.hover;
    const base = defaultParams();
    const p: PresetParams = { amplitude: preset === 'hop' ? 0.3 : base.amplitude, speed: base.speed * (this.moving ? 1.6 : 0.8), phase: (snap.id % 7) * 0.17 };
    if (this.parts.length) {
      for (const part of this.parts) {
        const t = fn(this.clock, { ...p, phase: part.phase });
        part.obj.position.set(part.pos.x + t.pos.x, part.pos.y + t.pos.y, part.pos.z + t.pos.z);
        part.obj.rotation.y = part.rotY + t.rotY;
      }
      return;
    }
    const t = fn(this.clock, p);
    this.body.position.set(t.pos.x, t.pos.y, t.pos.z);
    this.body.rotation.y = t.rotY;
    this.body.scale.set(t.scale.x, t.scale.y, t.scale.z);
  }
}
