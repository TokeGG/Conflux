import * as THREE from 'three';
import { defaultData, DEFAULT_PROFILE, DataLayers, PATCHES, genCredits, type LicenseEntry, RunDirector, ENDLESS, dailyFor, dayKey, type Daily, generateRoom, loadLedger, saveLedger, type RoomPlan, type RunPhase } from '@conflux/shared';
import { detectCapabilities, fatalMessage, showFatal } from './capabilities.ts';
import { applyProfile, applyTextureFilters, createRenderer } from './renderer/profile.ts';
import { createScene, fitHeight } from './renderer/scene.ts';
import { buildRoomScene } from './renderer/room.ts';
import { AssetLoader, assetBase, fetchManifest } from './assets/loader.ts';
import { loadPlayer } from './anim/player.ts';
import type { LocoState } from './anim/locomotion.ts';
import { Hud } from './hud/hud.ts';
import { dailyBestLine, loadDailyBest, saveDailyBest } from './dailyBest.ts';
import { describeGate } from './hud/runFormat.ts';
import { loadCrosshair, saveCrosshair } from './crosshair.ts';
import { CrosshairPage } from './dev/pages/crosshair.ts';
import { RoomLights } from './renderer/roomLights.ts';
import { disposeCopies } from './renderer/skins.ts';
import { RunScreens } from './hud/runScreens.ts';
import { menuCamera } from './hud/menuCamera.ts';
import { EscMenu } from './hud/menu.ts';
import { loadBindings, saveBindings } from './keybinds.ts';
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
    __conflux?: { ready: boolean; tick: number; room: string; run(): { phase: RunPhase; roomIndex: number; tuned: boolean; screen: string; hp: number; gates: { x: number; z: number }[]; counters: Record<string, number>; unlocked: string[] } | null; menuOpen?: () => boolean; lockRequests(): number; lights(): number; lamp(on: boolean): void; lookFrom(px: number, py: number, pz: number, lx: number, ly: number, lz: number): void; pieces: number; distinctColours(): number; pose(state: LocoState, castClip: string | null, castW: number, aimPitch: number): void; frontView(): void; playFx(id: string): Promise<void>; fxActive(): number; command(cmd: DevCommand): void; aimAt(x: number, y: number, z: number): { aimYaw: number; aimPitch: number }; sendInput(i: Partial<Input> | null): void; snapshot(): Snapshot | null; events(): SimEvent[]; enemyViews(): number; damageShown(): number; renderInfo(): { calls: number; triangles: number; geometries: number; textures: number; parts: string[] } };
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
  // ?room=<id> opens a particular room (to look at a template); otherwise the first forest room
  const wanted = new URL(location.href).searchParams.get('room');
  const params = new URL(location.href).searchParams;
  // a normal visit plays a run; ?room=<id> or ?sandbox opens the single room with the dev tools
  // ?theme=<crypt|hall|cave>&seed=<n> opens one generated room by itself (to look at a style)
  const themeParam = params.get('theme');
  const runMode = !wanted && !themeParam && !params.has('sandbox');
  let room = (wanted && data.rooms[wanted]) || data.rooms.forest_clearing;
  if (themeParam && data.themes[themeParam]) {
    room = generateRoom(data, Number(params.get('seed')) || 1, 1, 0, themeParam).room;
    data.rooms[room.id] = room;
  } else if (runMode) {
    // the main menu opens on one of the game's own dark rooms, not on the old outdoor one
    const names = Object.keys(data.themes);
    const pick = Date.now() % 100000;
    room = generateRoom(data, pick, 1, 0, names[pick % names.length]).room;
    data.rooms[room.id] = room;
  }
  const game = createScene(room.lighting);
  game.setGround(!room.look);

  const loader = new AssetLoader(await fetchManifest(), DEFAULT_PROFILE);
  for (const [key, glb] of customModels) loader.addCustomModel(key, glb);
  let roomGroup = await buildRoomScene(room, loader);
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
  let crosshair = loadCrosshair(storage);
  hud.setCrosshair(crosshair);
  const debugFlags = noDebug();
  const play = new Game({ scene: game.scene, camera: game.camera, canvas: renderer.domElement, loader, bridge, data: () => layers.current(), room, playerModel: player, rig, fx, hud, profile, flags: debugFlags });

  const roomLights = new RoomLights(game.scene, 8);
  roomLights.setRoom(room.lights ?? []);
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
    panel.registerPage(new CrosshairPage(() => crosshair, (c) => ((crosshair = c), saveCrosshair(storage, c), hud.setCrosshair(c))));
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
    get room() {
      return room.id;
    },
    run: () =>
      director
        ? { phase: director.phase, roomIndex: director.run.roomIndex, tuned: director.run.tuned, screen: screens.open, hp: director.run.hp, gates: director.run.current.def?.spawns.doors ?? [], counters: director.ledger.counters, unlocked: director.ledger.unlocked }
        : null,
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
    /** What the last frame cost the renderer (test hook for the performance checks). */
    renderInfo: () => {
      const shown = (o: THREE.Object3D): boolean => {
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, parts: game.scene.children.map((c) => { let n = 0; c.traverse((o) => ((o as THREE.Mesh).isMesh && shown(o) ? n++ : 0)); return `${c.name || c.type}:${n}`; }).filter((s) => !s.endsWith(':0')) };
    },
    lockRequests: () => play.input.lockRequests,
    /** How many point lights are lit in the scene (test hook). */
    lights: () => {
      let n = 0;
      game.scene.traverse((o) => ((o as THREE.PointLight).isPointLight && o.visible && (o as THREE.PointLight).intensity > 0 ? n++ : 0));
      return n;
    },
    /** Floods the scene with light so a screenshot shows the layout (test hook). */
    lamp(on) {
      const old = game.scene.getObjectByName('screenshot-lamp');
      if (old) game.scene.remove(old);
      if (on) {
        const l = new THREE.AmbientLight(0xaab4ff, 1.6);
        l.name = 'screenshot-lamp';
        game.scene.add(l);
        game.scene.fog = new THREE.Fog(0x05060a, 90, 200);
      }
    },
    /** Puts the camera at one point looking at another (test hook for screenshots). */
    lookFrom(px, py, pz, lx, ly, lz) {
      play.cameraOverride = (camera) => {
        camera.position.set(px, py, pz);
        camera.lookAt(lx, ly, lz);
      };
    },
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

  // ---- the run: screens between rooms, driven by what the sim reports ----
  const screens = new RunScreens();
  screens.onResume = () => play.input.requestLock();
  let director: RunDirector | null = null;
  let shown: RunPhase | null = null;
  let showMenu: () => void = () => undefined;
  let todays: Daily | null = null;
  const seedOf = () => Number(params.get('seed')) || Date.now() % 1_000_000;

  /** Scenes of the rooms behind the open gates, built ahead one at a time between frames. */
  const prebuilt = new Map<string, Awaited<ReturnType<typeof buildRoomScene>>>();
  const prebuild = async (plans: RoomPlan[]): Promise<void> => {
    for (const plan of plans) {
      await new Promise((r) => setTimeout(r, 120));
      if (!plan.def || prebuilt.has(plan.roomId) || director?.phase !== 'doors') continue;
      const built = await buildRoomScene(plan.def, loader);
      // the player may have walked through a gate while this was building: nobody would ever free it then
      if (director?.phase === 'doors' && !prebuilt.has(plan.roomId)) prebuilt.set(plan.roomId, built);
      else disposeCopies(built);
    }
  };

  /** Loads a room's scene and swaps the sim to it. The sim's swap is asked for first, so frames of the old room are dropped. */
  const loadPlan = async (plan: RoomPlan): Promise<void> => {
    const run = director!.run;
    play.inputEnabled = false;
    const swapped = bridge.enter({ seed: run.seed, current: plan, skills: run.skills, augments: run.augments, hp: run.hp, tuned: run.tuned });
    const next = plan.def ?? layers.current().rooms[plan.roomId];
    // the scene was built while the gates were open when it could be, so stepping through does not stall
    const group = prebuilt.get(plan.roomId) ?? (await buildRoomScene(next, loader));
    prebuilt.delete(plan.roomId);
    for (const [id, g] of prebuilt) (disposeCopies(g), prebuilt.delete(id));
    game.scene.remove(roomGroup);
    disposeCopies(roomGroup);
    roomGroup = group;
    game.scene.add(roomGroup);
    game.setLighting(next.lighting);
    game.setGround(!next.look);
    room = next;
    roomLights.setRoom(next.lights ?? []);
    play.loadRoom(next);
    await swapped;
    // a reward waiting at the entrance keeps the game paused and the controls off until it is picked
    play.inputEnabled = director!.phase === 'fighting';
  };

  const sync = (): void => {
    if (!director || director.phase === shown) return;
    shown = director.phase;
    saveLedger(storage, director.ledger);
    const d = director;
    const data = layers.current();
    if (d.phase === 'reward') {
      const atEntrance = d.run.mode === 'endless';
      if (atEntrance) (bridge.command({ op: 'pause', on: true }), (play.inputEnabled = false));
      screens.rewards(d.offers, data, d.run.skills.equipped, (i, slot) => {
        d.pick(i, slot);
        if (atEntrance) void startRoom();
        else sync();
      });
    }
    else if (d.phase === 'doors') {
      // endless: the gates are walked through, so no screen; the player steps up to one and the next room loads
      if (d.run.mode === 'endless') {
        screens.hide();
        play.inputEnabled = true;
        void prebuild(d.doors.map((c) => c.room));
        hud.setGates(d.doors.map((c, i) => ({ pos: d.run.current.def?.spawns.doors[i] ?? { x: 0, y: 0, z: 0 }, ...describeGate(c, data) })));
      }
      else screens.doors(d.doors, data, d.run.roomIndex + 1, (i) => void enterDoor(i));
    }
    else if (d.phase === 'dead' || d.phase === 'won') {
      // a daily run records how far it got; the end screen compares it with the best of the day
      const bestToday = todays && d.run.daily ? saveDailyBest(storage, todays.day, d.run.history.length) : 0;
      screens.end(d.run, d.earned, data, () => (bridge.command({ op: 'pause', on: true }), showMenu()), bestToday);
    }
  };

  /** After a reward at the entrance: the room starts again with what was picked (new skills, augments, health) and the game runs. */
  const startRoom = async (): Promise<void> => {
    const d = director!;
    const run = d.run;
    screens.hide();
    shown = d.phase;
    await bridge.enter({ seed: run.seed, current: run.current, skills: run.skills, augments: run.augments, hp: run.hp, tuned: run.tuned });
    bridge.command({ op: 'pause', on: false });
    play.inputEnabled = true;
  };

  const enterDoor = async (i: number): Promise<void> => {
    const plan = director!.enter(i);
    hud.setGates([]);
    shown = director!.phase;
    screens.hide();
    await loadPlan(plan);
  };

  const beginRun = async (daily?: Daily): Promise<void> => {
    const ledger = director?.ledger ?? loadLedger(storage);
    director = new RunDirector(layers.current(), daily ? daily.seed : seedOf(), ledger, layers.isModified(), ENDLESS, daily ? { daily } : undefined);
    todays = daily ?? null;
    director.onEnter = (plan) => {
      // the reward of the room just left (if any) appears as soon as the new room is in place
      shown = null;
      hud.setGates([]);
      void loadPlan(plan).then(sync);
    };
    shown = director.phase;
    screens.hide();
    bridge.command({ op: 'pause', on: false });
    play.cameraOverride = null;
    hud.root.style.display = '';
    await loadPlan(director.run.current);
  };

  if (runMode) {
    bridge.onFrame((snapshot, events) => {
      if (!director) return;
      if (snapshot.tuned) director.markTuned();
      director.onEvents(events);
      director.onPlayerHp(snapshot.players[0].hp);
      sync();
    });
    const credits = async (): Promise<string[]> => {
      try {
        const res = await fetch(`${assetBase()}licenses.json`);
        return genCredits(((await res.json()) as { entries: LicenseEntry[] }).entries).split('\n').filter(Boolean);
      } catch {
        return [];
      }
    };
    /** The main menu: the dark room behind it, a slow orbit, no crosshair or bars. A run ends here, whether it was won or lost. */
    showMenu = () => {
      director = null;
      hud.setGates([]);
      shown = null;
      play.inputEnabled = false;
      hud.root.style.display = 'none';
      play.cameraOverride = (camera) => {
        const c = menuCamera(performance.now() / 1000, room.size);
        camera.position.set(c.pos.x, c.pos.y, c.pos.z);
        camera.lookAt(c.look.x, c.look.y, c.look.z);
      };
      document.exitPointerLock?.();
      const today = dailyFor(dayKey(new Date()), layers.current());
      const names = today.elements.map((e) => e[0].toUpperCase() + e.slice(1)).join(', ');
      screens.start(loadLedger(storage), layers.current(), () => void beginRun(), { patches: PATCHES, credits }, { label: `Today: ${names}`, best: dailyBestLine(loadDailyBest(storage, today.day)), onBegin: () => void beginRun(today) });
    };
    showMenu();
  }

  // ---- the Esc menu: settings and keys, applied at once and saved ----
  play.input.bindings = loadBindings(storage);
  const applySettings = (): void => {
    play.input.sensitivity = 0.0022 * settings.sensitivity;
      game.camera.fov = settings.fov;
    game.camera.updateProjectionMatrix();
    applyProfile(renderer, profileFromSettings(settings));
  };
  applySettings();
  const menu = new EscMenu({
    getSettings: () => settings,
    onSettings: (s) => ((settings = s), saveSettings(storage, s), applySettings()),
    getBindings: () => play.input.bindings,
    onBindings: (b) => ((play.input.bindings = b), saveBindings(storage, b)),
    onOpen: () => (document.exitPointerLock?.(), bridge.command({ op: 'pause', on: true }), (play.inputEnabled = false)),
    onResume: () => (bridge.command({ op: 'pause', on: false }), (play.inputEnabled = true), play.input.requestLock()),
    onQuit: () => location.reload(),
  });
  /** The menu opens during play, not over the main menu, the reward screens or the end of a run. */
  const menuAllowed = (): boolean => screens.open === 'none' && (!runMode || (director !== null && director.phase !== 'dead' && director.phase !== 'won'));
  // losing the mouse (the browser takes it back on Esc) or pressing Esc when it is not locked opens the menu
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && menuAllowed() && !menu.isOpen) menu.open();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat) return;
    if (menu.isOpen) menu.resume();
    else if (menuAllowed()) menu.open();
  });
  window.__conflux!.menuOpen = () => menu.isOpen;

  const clock = new THREE.Clock();
  const frame = () => {
    const dt = clock.getDelta();
    play.update(dt);
    roomLights.update(performance.now() / 1000, play.latest?.players[0].pos ?? null);
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
