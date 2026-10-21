import * as THREE from 'three';
import { defaultData, DEFAULT_PROFILE, DataLayers } from '@conflux/shared';
import { detectCapabilities, fatalMessage, showFatal } from './capabilities.ts';
import { applyProfile, applyTextureFilters, createRenderer } from './renderer/profile.ts';
import { createScene, fitHeight } from './renderer/scene.ts';
import { buildRoomScene } from './renderer/room.ts';
import { AssetLoader, fetchManifest } from './assets/loader.ts';
import { loadPlayer } from './anim/player.ts';
import type { LocoState } from './anim/locomotion.ts';
import { Hud } from './hud/hud.ts';
import { idleInput, type DevCommand, type Input, type SimEvent, type Snapshot } from '@conflux/shared';
import { Game } from './game.ts';
import { FxSystem } from './fx/sprites.ts';
import { WorkerBridge } from './worker/workerBridge.ts';
import { loadSettings, profileFromSettings, safeStorage, saveSettings, type Settings } from './settings.ts';
import { devEnabled } from './dev/access.ts';
import { DevState } from './dev/devstate.ts';
import { DevPanel } from './dev/panel.ts';
import { PerfPage } from './dev/perf.ts';
import { Benchmark } from './dev/benchmark.ts';
import { AnimViewerPage } from './dev/animViewer.ts';
import { DebugDraw } from './dev/debugDraw.ts';
import { noDebug, ToolsPage } from './dev/tools.ts';
import { playerPage } from './dev/pages/player.ts';
import { skillsPage } from './dev/pages/skills.ts';
import { statusesPage } from './dev/pages/statuses.ts';
import { reactionsPage } from './dev/pages/reactions.ts';
import { enemiesPage } from './dev/pages/enemies.ts';
import { ModelsPage } from './dev/pages/models.ts';
import { CustomContentStore } from './dev/import/store.ts';

declare global {
  interface Window {
    /** Read by the browser smoke tests. */
    __confluxDev?: { readonly sampling: boolean; report(): string };
    __conflux?: { ready: boolean; tick: number; room: string; pieces: number; distinctColours(): number; pose(state: LocoState, castClip: string | null, castW: number, aimPitch: number): void; frontView(): void; playFx(id: string): Promise<void>; fxActive(): number; command(cmd: DevCommand): void; aimAt(x: number, y: number, z: number): { aimYaw: number; aimPitch: number }; sendInput(i: Partial<Input> | null): void; snapshot(): Snapshot | null; events(): SimEvent[]; enemyViews(): number; damageShown(): number };
  }
}

async function boot(): Promise<void> {
  const storage = safeStorage();
  let settings: Settings = loadSettings(storage);
  const profile = profileFromSettings(settings);
  const dev = devEnabled(new URL(location.href), storage);
  const layers = new DataLayers(defaultData());
  const devState = new DevState(layers, storage);
  // mobs the owner uploaded earlier come back first, so saved numbers for them still apply
  const store = dev ? await CustomContentStore.open() : null;
  const customModels: [string, Uint8Array][] = [];
  if (store) {
    const saved = (await Promise.all((await store.list()).map((m) => store.get(m.id)))).filter((x): x is NonNullable<typeof x> => !!x);
    layers.setCustom(saved.map(({ mob }) => ({ id: mob.id, enemy: mob.enemy, pools: mob.pools })));
    for (const { mob, glb } of saved) customModels.push([mob.glbKey, glb]);
  }
  if (dev) devState.loadSession();
  const data = layers.current();
  const renderer = createRenderer(profile);
  document.body.append(renderer.domElement);
  const room = data.rooms.forest_clearing;
  const game = createScene(room.lighting);

  const loader = new AssetLoader(await fetchManifest(), DEFAULT_PROFILE);
  for (const [key, glb] of customModels) loader.addCustomModel(key, glb);
  const roomGroup = await buildRoomScene(room, loader);
  game.scene.add(roomGroup);
  const { scene: player, rig } = await loadPlayer(loader, data);

  const fx = new FxSystem(game.scene, loader, profile.spriteFilter);
  const bridge = new WorkerBridge(1, data, room.id);
  await bridge.ready;
  const state = { ready: false, tick: 0 };
  bridge.onFrame((snapshot) => {
    state.tick = snapshot.tick;
  });
  const hud = new Hud(() => layers.current());
  const debugFlags = noDebug();
  const play = new Game({ scene: game.scene, camera: game.camera, canvas: renderer.domElement, loader, bridge, data: () => layers.current(), room, playerModel: player, rig, fx, hud, profile, flags: debugFlags });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    game.resize(window.innerWidth, window.innerHeight);
  });

  const debugDraw = new DebugDraw(game.scene, () => layers.current(), room.colliders);
  let perf: PerfPage | null = null;
  if (dev) {
    // numbers tried in the panel reach the sim running in the worker
    const sendData = () => bridge.command({ op: 'setData', data: layers.current() });
    const panel = new DevPanel(devState, bridge, sendData);
    const base = () => layers.base;
    const refresh = () => panel.refresh();
    panel.registerPage(playerPage(devState, base, refresh));
    panel.registerPage(skillsPage(devState, base, refresh));
    panel.registerPage(statusesPage(devState, base, refresh));
    panel.registerPage(reactionsPage(devState, base, refresh));
    panel.registerPage(enemiesPage(devState, base, refresh));
    panel.registerPage(new ModelsPage({ store, layers, loader, bridge, data: () => layers.current(), sendData, refresh }));
    panel.registerPage(new ToolsPage(bridge, () => layers.current(), debugFlags));
    panel.registerPage(new AnimViewerPage(loader));
    perf = new PerfPage({
      renderer,
      profileId: profile.id,
      getSettings: () => settings,
      onSettings: (s) => {
        settings = s;
        saveSettings(storage, s);
        applyProfile(renderer, profileFromSettings(s));
      },
      benchmark: new Benchmark(10),
      centre: { x: 0, y: 0, z: 0 },
      radius: 9,
      height: 4,
    });
    panel.registerPage(perf);
    const p = perf;
    window.__confluxDev = {
      get sampling() {
        return p.sampling;
      },
      report: () => p.report(),
    };
  }

  window.__conflux = {
    get ready() {
      return state.ready;
    },
    get tick() {
      return state.tick;
    },
    room: room.id,
    /** Lets the browser smoke tests pose the player (the real controls arrive with the M1 integration). */
    pose: (state, castClip, castW, aimPitch) => (play.poseOverride = { state, castClip, castW, pitch: aimPitch }),
    /** Plays an effect beside the player (test hook). */
    async playFx(id) {
      await fx.spawn(id, { x: room.spawns.player.x - 0.6, y: 0.2, z: room.spawns.player.z + 0.8 });
    },
    fxActive: () => fx.active,
    /** Sends a dev command to the sim (test hook). */
    command: (cmd) => bridge.command(cmd),
    aimAt: (x, y, z) => play.aimAt({ x, y, z }),
    /** Sends the player's input until the next call (test hook; the real controls arrive with the M1 integration). */
    sendInput: (i) => (play.scripted = i ? { ...idleInput(), ...i } : null),
    snapshot: () => play.latest,
    events: () => play.log,
    enemyViews: () => play.enemyViews,
    damageShown: () => hud.damageShown,
    /** Puts the temporary camera in front of the player so the smoke screenshots show the pose. */
    frontView() {
      play.cameraOverride = (camera) => {
        const p = play.latest?.players[0].pos ?? room.spawns.player;
        camera.position.set(p.x + 0.8, 1.5, p.z + 3.6);
        camera.lookAt(p.x, 1.0, p.z);
      };
    },
    pieces: room.pieces.length,
    /** Draws a frame and counts the distinct colours on a coarse grid of it. */
    distinctColours() {
      renderer.render(game.scene, game.camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const seen = new Set<number>();
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) seen.add((px[(y * w + x) * 4] << 16) | (px[(y * w + x) * 4 + 1] << 8) | px[(y * w + x) * 4 + 2]);
      return seen.size;
    },
  };
  state.ready = true;

  const clock = new THREE.Clock();
  const frame = () => {
    const dt = clock.getDelta();
    play.update(dt);
    fx.update(Math.min(dt, 0.1), game.camera);
    if (play.latest) debugDraw.update(play.latest, debugFlags);
    const pose = perf?.benchmarkPose();
    const saved = pose ? { pos: game.camera.position.clone(), quat: game.camera.quaternion.clone() } : null;
    if (pose) {
      game.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      game.camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
    }
    perf?.beforeRender();
    renderer.render(game.scene, game.camera);
    perf?.afterRender();
    perf?.frame(dt * 1000);
    if (saved) {
      game.camera.position.copy(saved.pos);
      game.camera.quaternion.copy(saved.quat);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const fatal = fatalMessage(detectCapabilities());
if (fatal) showFatal(fatal);
else boot().catch((e) => showFatal(`Conflux could not start: ${e instanceof Error ? e.message : String(e)}`));
