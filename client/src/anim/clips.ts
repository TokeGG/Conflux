// Baked animation clips: 30 fps Int16 quaternions per bone. Pure functions, no Three.js, so they can be tested and reused by the model viewer.

export interface ClipFile {
  v: number;
  rig: string;
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  duration: number;
  rootSpeed: number;
  bones: string[];
  /** Base64 of little-endian Int16, frames x bones x 4 (x y z w), each divided by 32767. */
  q: string;
  /** Base64 of little-endian Float32, frames x 3: the hips position. */
  hips: string;
}

export interface DecodedClip {
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  duration: number;
  rootSpeed: number;
  bones: string[];
  q: Float32Array;
  hips: Float32Array;
}

/** Spine, chest, neck, head, shoulders, arms and hands, in both rigs' bone names. Everything else (hips, legs, feet) is lower body. */
export const UPPER_BODY: Set<string> = new Set([
  // wizard pack
  'Abdomen', 'Torso', 'Neck', 'Head', 'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'FistL', 'FistR',
  // old wizard
  'Bip01_Spine_03', 'Bip01_Spine1_05', 'Bip01_Neck_055', 'Bip01_Head_056', 'Bip01_L_Clavicle_028', 'Bip01_R_Clavicle_06', 'Bip01_L_UpperArm_029', 'Bip01_R_UpperArm_07', 'Bip01_L_Forearm_030', 'Bip01_R_Forearm_08', 'Bip01_L_Hand_031', 'Bip01_R_Hand_09',
]);

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function decodeClip(f: ClipFile): DecodedClip {
  const raw = bytes(f.q);
  const ints = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
  const q = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i += 4) {
    const x = ints[i] / 32767;
    const y = ints[i + 1] / 32767;
    const z = ints[i + 2] / 32767;
    const w = ints[i + 3] / 32767;
    const n = Math.hypot(x, y, z, w) || 1;
    q[i] = x / n;
    q[i + 1] = y / n;
    q[i + 2] = z / n;
    q[i + 3] = w / n;
  }
  const hb = bytes(f.hips);
  const hips = new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength >> 2);
  return { name: f.name, fps: f.fps, frames: f.frames, loop: f.loop, duration: f.duration, rootSpeed: f.rootSpeed, bones: f.bones, q, hips };
}

/** Spherical interpolation of the quaternion at offset a in A and offset b in B, written to out at offset o. */
export function slerpInto(A: Float32Array, a: number, B: Float32Array, b: number, t: number, out: Float32Array, o: number): void {
  let bx = B[b];
  let by = B[b + 1];
  let bz = B[b + 2];
  let bw = B[b + 3];
  let dot = A[a] * bx + A[a + 1] * by + A[a + 2] * bz + A[a + 3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0: number;
  let s1: number;
  if (dot > 0.9995) {
    s0 = 1 - t;
    s1 = t;
  } else {
    const th = Math.acos(dot);
    const sin = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sin;
    s1 = Math.sin(t * th) / sin;
  }
  const x = A[a] * s0 + bx * s1;
  const y = A[a + 1] * s0 + by * s1;
  const z = A[a + 2] * s0 + bz * s1;
  const w = A[a + 3] * s0 + bw * s1;
  const n = Math.hypot(x, y, z, w) || 1;
  out[o] = x / n;
  out[o + 1] = y / n;
  out[o + 2] = z / n;
  out[o + 3] = w / n;
}

/** Which two frames surround time t and how far between them (a looping clip wraps, a one-shot holds its last frame). */
function locate(c: DecodedClip, t: number): { i0: number; i1: number; f: number } {
  const last = c.frames - 1;
  if (c.loop) {
    const tt = ((t % c.duration) + c.duration) % c.duration;
    const pos = tt * c.fps;
    const i0 = Math.min(Math.floor(pos), last);
    return { i0, i1: Math.min(i0 + 1, last), f: pos - i0 };
  }
  const pos = Math.max(0, Math.min(last, t * c.fps));
  const i0 = Math.min(Math.floor(pos), last);
  return { i0, i1: Math.min(i0 + 1, last), f: pos - i0 };
}

/** Writes every bone's rotation at time t (seconds) into out (bones x 4). */
export function sampleClip(c: DecodedClip, t: number, out: Float32Array): void {
  const { i0, i1, f } = locate(c, t);
  const stride = c.bones.length * 4;
  for (let b = 0; b < c.bones.length; b++) slerpInto(c.q, i0 * stride + b * 4, c.q, i1 * stride + b * 4, f, out, b * 4);
}

export function sampleHips(c: DecodedClip, t: number, out: Float32Array): void {
  const { i0, i1, f } = locate(c, t);
  for (let k = 0; k < 3; k++) out[k] = c.hips[i0 * 3 + k] * (1 - f) + c.hips[i1 * 3 + k] * f;
}

/** Upper-body bones take the cast pose (by weight); everything else keeps the locomotion pose exactly. */
export function composePose(bones: string[], loco: Float32Array, cast: Float32Array, castW: number, upper: Set<string>, out: Float32Array): void {
  for (let b = 0; b < bones.length; b++) {
    const o = b * 4;
    if (!upper.has(bones[b]) || castW <= 0) {
      out.set(loco.subarray(o, o + 4), o);
    } else if (castW >= 1) {
      out.set(cast.subarray(o, o + 4), o);
    } else {
      slerpInto(loco, o, cast, o, castW, out, o);
    }
  }
}
