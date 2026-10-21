// Drives a skinned character from baked clips: legs follow the locomotion clip, the upper body can take a cast clip on top,
// and the aim pitch is added on the spine and neck. Rotations are written straight onto the named bones.
import * as THREE from 'three';
import { composePose, sampleClip, sampleHips, slerpInto, UPPER_BODY, type DecodedClip } from './clips.ts';
import { locoClipName, type LocoState } from './locomotion.ts';

/** Bones that share the aim pitch, top to bottom, with how much of it each takes (the shares add up to 1). */
const PITCH_SHARE: Record<string, number> = {
  Abdomen: 0.35,
  Torso: 0.35,
  Neck: 0.3,
  Bip01_Spine_03: 0.35,
  Bip01_Spine1_05: 0.35,
  Bip01_Neck_055: 0.3,
};
const MAX_PITCH = (35 * Math.PI) / 180;
const BLEND_SECONDS = 0.15;

export class CharacterRig {
  private nodes: (THREE.Object3D | undefined)[];
  private clips = new Map<string, DecodedClip>();
  private pitchBones: { node: THREE.Object3D; share: number }[] = [];
  private state: LocoState = 'idle';
  private locoTime = 0;
  private castClip: string | null = null;
  private castW = 0;
  private castTime = 0;
  private pitch = 0;
  private blendLeft = 0;
  private readonly n: number;
  private readonly loco: Float32Array;
  private readonly fromPose: Float32Array;
  private readonly cast: Float32Array;
  private readonly out: Float32Array;
  private readonly hips = new Float32Array(3);
  private fromHips = new Float32Array(3);
  private haveFrom = false;
  private preview: { clip: string; time: number | null } | null = null;

  constructor(
    readonly root: THREE.Object3D,
    readonly bones: string[],
  ) {
    this.n = bones.length;
    this.nodes = bones.map((b) => root.getObjectByName(b));
    this.loco = new Float32Array(this.n * 4);
    this.fromPose = new Float32Array(this.n * 4);
    this.cast = new Float32Array(this.n * 4);
    this.out = new Float32Array(this.n * 4);
    bones.forEach((b, i) => {
      const node = this.nodes[i];
      if (node && PITCH_SHARE[b] !== undefined) this.pitchBones.push({ node, share: PITCH_SHARE[b] });
    });
  }

  addClip(c: DecodedClip): void {
    this.clips.set(c.name, c);
  }

  hasClip(name: string): boolean {
    return this.clips.has(name);
  }

  /** Plays any named clip on the legs instead of the locomotion state (the model viewer). A time pins the pose to that moment; null goes back to the state. */
  showClip(clip: string | null, time: number | null = null): void {
    this.preview = clip ? { clip, time } : null;
    if (clip) this.blendLeft = 0;
  }

  /** What the character should be doing now. castW is 0 for no cast up to 1 for the cast clip fully on the upper body. */
  play(state: LocoState, castClip: string | null, castW: number, aimPitch: number): void {
    if (state !== this.state) {
      this.fromPose.set(this.out);
      this.fromHips.set(this.hips);
      this.haveFrom = true;
      this.blendLeft = BLEND_SECONDS;
      this.state = state;
      this.locoTime = 0;
    }
    if (castClip !== this.castClip) {
      this.castClip = castClip;
      this.castTime = 0;
    }
    this.castW = Math.max(0, Math.min(1, castW));
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, aimPitch));
  }

  update(dt: number): void {
    const locoClip = this.clips.get(this.preview?.clip ?? locoClipName(this.state));
    if (locoClip) {
      if (this.preview?.time != null) this.locoTime = this.preview.time;
      else this.locoTime += dt;
      sampleClip(locoClip, this.locoTime, this.loco);
      sampleHips(locoClip, this.locoTime, this.hips);
    } else if (!this.haveFrom) {
      this.loco.set(this.out);
    }
    if (this.blendLeft > 0 && this.haveFrom) {
      this.blendLeft = Math.max(0, this.blendLeft - dt);
      const t = 1 - this.blendLeft / BLEND_SECONDS;
      for (let b = 0; b < this.n; b++) slerpInto(this.fromPose, b * 4, this.loco, b * 4, t, this.loco, b * 4);
      for (let k = 0; k < 3; k++) this.hips[k] = this.fromHips[k] * (1 - t) + this.hips[k] * t;
    }
    const castClip = this.castClip ? this.clips.get(this.castClip) : undefined;
    let weight = this.castW;
    if (castClip && weight > 0) {
      this.castTime += dt;
      sampleClip(castClip, this.castTime, this.cast);
    } else {
      weight = 0;
    }
    composePose(this.bones, this.loco, this.cast, weight, UPPER_BODY, this.out);
    for (let b = 0; b < this.n; b++) this.nodes[b]?.quaternion.set(this.out[b * 4], this.out[b * 4 + 1], this.out[b * 4 + 2], this.out[b * 4 + 3]);
    if (locoClip) this.nodes[0]?.position.set(this.hips[0], this.hips[1], this.hips[2]);
    this.applyPitch();
  }

  /** Tilts the spine and neck about the character's right axis. Done in world space so it does not depend on each rig's bone axes. */
  private applyPitch(): void {
    if (this.pitch === 0 || this.pitchBones.length === 0) return;
    this.root.updateMatrixWorld(true);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const parentQ = new THREE.Quaternion();
    const r = new THREE.Quaternion();
    for (const { node, share } of this.pitchBones) {
      if (!node.parent) continue;
      node.parent.getWorldQuaternion(parentQ);
      r.setFromAxisAngle(right, -this.pitch * share); // a positive pitch looks up, which turns +Z toward +Y, a negative turn about +X
      node.quaternion.premultiply(parentQ.clone().invert().multiply(r).multiply(parentQ));
      node.updateMatrixWorld(true);
    }
  }
}
