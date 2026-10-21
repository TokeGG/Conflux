// How one enemy looks and moves: its model fitted to its hurtboxes, tinted, and animated by its own clips, baked clips or procedural motion.
import * as THREE from 'three';
import type { EnemyDef, EnemySnap } from '@conflux/shared';
import { defaultParams, PRESETS, type PresetParams } from '../anim/procedural.ts';
import { fitHeight } from './scene.ts';

const FADE = 0.2;
const MOVING = 0.4;

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
  private lastAttack: string | null = null;

  constructor(
    readonly def: EnemyDef,
    model: THREE.Object3D,
    animations: THREE.AnimationClip[] = model.animations ?? [],
  ) {
    const top = Math.max(...def.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r));
    fitHeight(model, top * def.scale);
    if (def.tint) this.tint(model, def.tint);
    this.body.add(model);
    this.root.add(this.body);
    if (def.rig.type !== 'procedural' && animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    if (def.rig.type === 'procedural' && def.rig.preset === 'part_sway') {
      // a model made of separate parts: each one sways on its own beat
      let i = 0;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) this.parts.push({ obj: o, pos: o.position.clone(), rotY: o.rotation.y, phase: i++ * 0.13 });
      });
    }
  }

  /** Multiplies the model's colours by the tint and adds a faint glow of it, on copies so the shared model is untouched. */
  private tint(model: THREE.Object3D, hex: string): void {
    const c = new THREE.Color(hex);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const copy = m.clone() as THREE.MeshStandardMaterial;
        copy.color?.multiply(c);
        if (copy.emissive) {
          copy.emissive.copy(c).multiplyScalar(0.25);
        }
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
  }

  private pick(snap: EnemySnap): string | null {
    const clips = this.def.rig.clips;
    if (!clips) return null;
    const one = (v: string | string[] | undefined, key = 0) => (Array.isArray(v) ? v[key % v.length] : v);
    if (snap.attack) return one(clips.attack, [...snap.attack].reduce((a, ch) => a + ch.charCodeAt(0), 0)) ?? null;
    if (snap.guardOn) return one(clips.guard) ?? null;
    if (this.moving) return one(clips.walk) ?? one(clips.idle) ?? null;
    return one(clips.idle) ?? null;
  }

  private play(name: string | null): void {
    const next = name ? this.actions.get(name) : undefined;
    if (!next || next === this.current) return;
    next.reset().fadeIn(FADE).play();
    this.current?.fadeOut(FADE);
    this.current = next;
  }

  update(snap: EnemySnap, dt: number): void {
    this.clock += dt;
    this.root.position.set(snap.pos.x, snap.pos.y, snap.pos.z);
    this.root.rotation.y = snap.facing;
    this.moving = this.prev ? Math.hypot(snap.pos.x - this.prev.x, snap.pos.z - this.prev.z) / Math.max(dt, 1e-3) > MOVING : false;
    this.prev = { x: snap.pos.x, z: snap.pos.z };
    if (snap.attack && snap.attack !== this.lastAttack) this.attackSince = this.clock;
    if (!snap.attack) this.attackSince = -1;
    this.lastAttack = snap.attack;

    if (this.mixer) {
      this.play(this.pick(snap));
      this.mixer.update(dt);
    }
    if (this.def.rig.type === 'procedural') this.proceduralPose(snap);
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
    if (this.attackSince >= 0) {
      const l = PRESETS.lunge(this.clock - this.attackSince, { amplitude: 0.4, speed: 0.8, phase: 0 });
      this.body.position.z += l.pos.z;
    }
  }
}
