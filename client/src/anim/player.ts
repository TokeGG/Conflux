// Builds the player's animated body: the model, its rig and the baked clips it needs.
import type * as THREE from 'three';
import { decodeClip, type ClipFile } from './clips.ts';
import { castClipFor, LOCO_STATES, locoClipName } from './locomotion.ts';
import { CharacterRig } from './rig.ts';
import type { AssetLoader } from '../assets/loader.ts';
import type { GameData } from '@conflux/shared';
import { clipsForRig } from '../dev/tools.ts';

export const PLAYER_RIGS = [
  { model: 'model.wizardpack', clips: 'wizardpack' },
  { model: 'model.oldwizard', clips: 'oldwizard' },
] as const;

/** The pack wizard, or the old wizard when the pack's model is not in the manifest. */
export async function loadPlayer(loader: AssetLoader, data: GameData, opts: { allClips?: boolean } = {}): Promise<{ scene: THREE.Object3D; rig: CharacterRig; rigName: string }> {
  const pick = PLAYER_RIGS.find((r) => loader.has(r.model)) ?? PLAYER_RIGS[1];
  const gltf = await loader.loadModel(pick.model);
  const mapped = data.animation.rigs[pick.clips];
  const names = new Set<string>(LOCO_STATES.map((s) => locoClipName(s, mapped?.states)));
  for (const a of ['throw', 'sweep', 'push', 'slam', 'channel', 'self']) names.add(castClipFor(a, mapped?.cast));
  // the dev panel can point any state or skill at any clip, so it loads them all (about 700 KB); a normal visit loads what the data names
  if (opts.allClips) for (const n of clipsForRig(loader.manifest, pick.clips)) names.add(n);
  for (const n of [...Object.values(mapped?.states ?? {}), ...Object.values(mapped?.cast ?? {})]) names.add(n);
  for (const s of Object.values(data.skills)) names.add(s.cast.clip);
  const files = await Promise.all([...names].map((n) => (loader.has(`clip.${pick.clips}.${n}`) ? loader.loadJson<ClipFile>(`clip.${pick.clips}.${n}`) : null)));
  const decoded = files.filter((f): f is ClipFile => !!f).map(decodeClip);
  if (decoded.length === 0) throw new Error(`no animation clips for ${pick.clips}`);
  const rig = new CharacterRig(gltf.scene, decoded[0].bones);
  for (const c of decoded) rig.addClip(c);
  rig.name = pick.clips;
  return { scene: gltf.scene, rig, rigName: pick.clips };
}
