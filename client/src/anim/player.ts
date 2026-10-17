// Builds the player's animated body: the model, its rig and the baked clips it needs.
import type * as THREE from 'three';
import { decodeClip, type ClipFile } from './clips.ts';
import { castClipFor, LOCO_STATES, locoClipName } from './locomotion.ts';
import { CharacterRig } from './rig.ts';
import type { AssetLoader } from '../assets/loader.ts';
import type { GameData } from '@conflux/shared';

export const PLAYER_RIGS = [
  { model: 'model.wizardpack', clips: 'wizardpack' },
  { model: 'model.oldwizard', clips: 'oldwizard' },
] as const;

/** The pack wizard, or the old wizard when the pack's model is not in the manifest. */
export async function loadPlayer(loader: AssetLoader, data: GameData): Promise<{ scene: THREE.Object3D; rig: CharacterRig; rigName: string }> {
  const pick = PLAYER_RIGS.find((r) => loader.has(r.model)) ?? PLAYER_RIGS[1];
  const gltf = await loader.loadModel(pick.model);
  const names = new Set<string>(LOCO_STATES.map(locoClipName));
  for (const a of ['throw', 'sweep', 'push', 'slam', 'channel', 'self']) names.add(castClipFor(a));
  for (const s of Object.values(data.skills)) names.add(s.cast.clip);
  const files = await Promise.all([...names].map((n) => (loader.has(`clip.${pick.clips}.${n}`) ? loader.loadJson<ClipFile>(`clip.${pick.clips}.${n}`) : null)));
  const decoded = files.filter((f): f is ClipFile => !!f).map(decodeClip);
  if (decoded.length === 0) throw new Error(`no animation clips for ${pick.clips}`);
  const rig = new CharacterRig(gltf.scene, decoded[0].bones);
  for (const c of decoded) rig.addClip(c);
  return { scene: gltf.scene, rig, rigName: pick.clips };
}
