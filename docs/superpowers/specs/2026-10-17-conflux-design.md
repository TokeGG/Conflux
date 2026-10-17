# Conflux: design spec

Date: 2026-10-17. Status: draft for owner review. Repo: `TokeGG/conflux` (new, private, not yet created).

## 1. What this is

Conflux is a third-person action roguelite that runs in the browser. You play a mage who fights elemental monsters through a run of rooms. You hold one of four elements at a time (fire, water, earth, wind), each with its own playstyle, and you win by switching element to suit the enemy and by chaining elements into reactions. Every run is new: the starting skills, the rewards, the rooms and the encounters are all seeded and different.

It is the third game in the owner's set (MMO Arena, Aim Arena). It follows the same pattern: a standalone repo, a browser game, a shared sign-in with the launcher, patch notes, a generated wiki and tests before every push.

### Success criteria for the first playable (end of M3)

1. A player can complete a run of about 8 rooms and a boss in 20 to 30 minutes with no crash.
2. The core loop works as intended: hit enemy A with water, swap to earth and hit enemy B, return to A for a reaction, swap and finish B with a reaction.
3. Two runs started from different seeds feel different in their first three rooms (different skills, rewards or enemies).
4. The game keeps a steady 60 fps at 1920x1080 on a mid-range laptop with the `chunky` render profile, or runs at a lower render scale without code changes. The owner measures this on their own GPU with the dev panel's performance page and reports back; it has not been measured yet.
5. Before any public release, every shipped asset has a verified licence entry (section 14). During development the licence gate only warns.

### Non-goals for the first playable

Co-op or any multiplayer (designed for, not built), the open-level and branching-map run modes, the fifth element (ice), shops, difficulty modes, daily seeds and leaderboards, the full 32-skill pool (M3 ships 20), accounts (guests only, browser storage), and the dev panel's Commit to GitHub and redeploy buttons (they need the server).

## 2. Decisions recorded from design

| Topic | Decision |
|---|---|
| Players | Single-player first, simulation kept separate so friends can join later |
| Camera and aim | Free-aim third person, over-the-shoulder, crosshair at screen center (Risk of Rain style), full 3D aim and hit detection |
| Elements | Fire, water, earth, wind. One active at a time. Swap with Q or 1-4. |
| Skills | 3 per element (basic, secondary, utility). Pool of 8 per element. Runs start with a random skill per slot per element. |
| Augments | Stat, behavior and reaction augments, up to 3 per skill |
| Reactions | Many, data-driven. 12 ordered combinations, 10 distinct effects, more later. |
| Run structure | Room-to-room first, behind a pluggable run-mode interface |
| Meta-progression | Unlocks only (no permanent power) |
| Look | `chunky` render profile now (native resolution, antialiasing, low-poly, blocky textures, smoothed sprites), designed so better profiles can be added later |
| Rooms | Darker and gloomier than the spike, as a per-room lighting preset, done in M5 |
| Bosses | Maw (forest, earth) and Pumpkin Reaper (graveyard, earth and fire) |
| Name | Conflux |
| Mob import | The dev panel can upload a model and add it as a mob (section 13.7), stored in the browser until a server exists, exported as a zip for the repo |
| Dev panel | Built into the game from M0, modelled on MMO Arena's (section 13), including a performance page for the owner's GPU testing |
| Licences | Deferred by the owner: the manifest and warnings stay, the blocking gate is switched on before any public release |

## 3. Architecture

### 3.1 Repo layout (TypeScript monorepo, same pattern as MMO Arena)

| Folder | Contents | Rule |
|---|---|---|
| `shared/` | Simulation, all game data (JSON), types | No DOM, no Three.js, no art file paths. Runs in a Web Worker in the browser and in Node for tests and, later, the co-op server. |
| `client/` | Three.js rendering, input, camera, HUD, animation, effects, asset loader, worker bridge | Reads sim state and events, sends inputs. Never decides gameplay. |
| `server/` | Later: accounts (shared with launcher), unlocks, seeds, leaderboards, co-op rooms | Not needed for the first playable. |
| `scripts/` | Asset converters, wiki generator, headless balance runs | Offline tools. |

### 3.2 Simulation

- Fixed tick, 60 Hz. Units are metres, Y up, a character at rest faces +Z.
- All randomness comes from seeded streams (`map`, `encounter`, `reward`, `combat`) derived from the run seed, so a stream never perturbs another.
- The sim takes inputs and produces state plus events. It never touches graphics.
- Input per player per tick: `{ moveX, moveZ, aimYaw, aimPitch, camOrigin, buttons, swapTo }`. The client sends the camera; the sim resolves the aim point itself by raycasting the camera ray against level colliders and enemy hurtboxes, then fires skills from the character's hand toward that point.
- Events (examples): `cast`, `hit`, `status_applied`, `reaction`, `guard_broken`, `enemy_died`, `room_cleared`, `reward_offered`. The client turns events into animation, effects and sound.
- Single-player runs the sim in a Web Worker and sends snapshots to the main thread, which interpolates for rendering. Co-op later runs the same sim on a server with the same message types.
- Determinism: the same seed and inputs give the same state hash in the same JavaScript engine. Cross-browser bit-identical replays are not promised.

### 3.3 Level data the sim needs

Each room has simple colliders (boxes and cylinders), a ground height function and spawn points, kept next to its visual layout. Colliders are generated from Kenney piece bounds (staging `env/index.json`) and hand-corrected. Projectiles collide with colliders. Enemy hurtboxes are capsules or small sphere groups (bosses use several).

### 3.4 Render profiles

A render profile is data the client reads.

| Setting | `chunky` (first) | later profiles |
|---|---|---|
| Render scale | 1.0 native, user option 0.75 to 1.0 | any |
| Antialiasing | on | on |
| Texture filtering | nearest for tiny textures, linear for sprites | linear |
| Texture tier | tiny (128 to 256 px) and 512 px | high resolution |
| Models | low-poly tier | detailed tier |
| Effects | smoothed sprites plus shaders and particles | more shaders |
| Lighting | per-room preset (ambient, light, fog) | richer |

The sim's data refers to art only by logical ID. `assets.json` maps each ID to files per profile and to a licence entry. Adding a profile never changes gameplay data.

## 4. Player, controls and casting

| Input | Action |
|---|---|
| WASD, mouse | Move, over-the-shoulder aim |
| LMB, RMB, Shift | Basic, secondary, utility of the active element |
| Q or 1-4 | Swap element |
| Space | Dodge roll |
| E | Interact (doors, rewards) |

All keys are rebindable.

Starting values (all tunable, in `shared/data/player.json`):

| Value | Starting number |
|---|---|
| Move speed | 6 m/s |
| Dodge | 0.4 s roll, 0.25 s invulnerable, 1.2 s cooldown, one charge |
| Swap cooldown | 0.4 s |
| Swap-in bonus | next skill within 3 s: +25% damage, and the status it applies (if it applies one) is guaranteed. Wind skills with no status only get the damage. |
| Movement while casting | 70% during windup, 50% while channelling |
| Health | 100, no mana, skills use cooldowns, basics are free |

A dodge cancels any cast. Legs follow movement and the upper body follows the aim (section 12).

## 5. Skills

A skill is one JSON entry. New skills are data, not code.

```json
{
  "id": "fire.fireball",
  "element": "fire",
  "slot": "basic",
  "shape": { "type": "projectile", "speed": 22, "radius": 0.25, "gravity": 0, "lifetime": 1.2 },
  "damage": 14,
  "cooldown": 0.45,
  "applies": "burning",
  "cast": { "archetype": "throw", "windup": 0.18, "clip": "cast_1h_magic_attack_02", "move": 0.7 },
  "fx": { "travel": "fx.fireball_travel", "hit": "fx.fireball_impact" },
  "tags": ["projectile", "fire"]
}
```

Shape types: `projectile`, `cone`, `stream` (channel), `zone`, `wall`, `self`, `dash`. Each takes its own numeric fields (angle, range, width, duration, count, tick).

Cast archetypes (animation): `throw`, `sweep`, `push`, `slam`, `channel`, `self`. Each maps to an upper-body clip and the skill gives the timing.

### 5.1 Pool and runs

8 skills per element: 3 basic, 3 secondary, 2 utility (32 total). A run starts with one random skill per slot per element (12). Reward offers add skills to swap in. A skill keeps its augments when swapped out.

### 5.2 Starting set (concepts, numbers in data)

| Element | Basic | Secondary | Utility |
|---|---|---|---|
| Fire | Fireball (throw, projectile, burns) | Flame Cone (sweep, 45 degrees, short range) | Flame Dash (leaves burning ground) |
| Water | Water Bolt (throw, slows, soaks) | Tidal Stream (channel) | Bubble Shield (absorbs damage, pops as a splash) |
| Earth | Boulder (throw, slow, heavy, knockback, arcs) | Spike Field (slam, area) | Stone Skin (less damage taken, slower) |
| Wind | Gust Volley (3 fast low-damage hits) | Cyclone (push, pulls and lifts enemies) | Air Dash (dash, brief dodge window) |

M3 ships 20 skills (5 per element: the 12 above plus 8 more). The full 32 arrive by M5.

## 6. Statuses and reactions

### 6.1 Statuses

| Status | Applied by | Effect | Duration |
|---|---|---|---|
| Burning | fire hits | damage over time, spreads to nearby enemies | 5 s |
| Soaked | water hits | 15% slow | 8 s |
| Rocked | earth hits | brittle: +15% damage taken | 8 s |
| Gusted | only specific wind skills (Cyclone, Updraft) | airborne, cannot act | 1.2 s |

Wind is the catalyst. Most wind hits apply no status but trigger reactions on the others. A status never stacks, it refreshes. Enemies show an icon with a remaining-time ring above their heads, and the crosshair highlights the enemy under it.

### 6.2 Reaction rule

A damaging hit of element E on an enemy carrying a status of a different element triggers the reaction for that pair. The old status is consumed and the hit applies its own status afterwards, so alternating elements keeps chaining. Each enemy has a 0.75 s cooldown per reaction. Reaction damage scales with the triggering hit's damage.

### 6.3 Reaction table

12 ordered combinations, 10 distinct effects (Steam and Mud each appear twice). Numbers are first-pass starting values.

| Existing status | Hit by | Reaction | Effect |
|---|---|---|---|
| Burning | water | Steam | 3 m burst at 100% hit damage, Blind 3 s |
| Soaked | fire | Steam | same as above |
| Burning | earth | Obsidian | Brittle shell 4 s: +30% damage taken, -50% speed |
| Burning | wind | Firestorm | burn spreads to enemies within 6 m, 60% hit damage burst |
| Soaked | earth | Mud | root 2 s, then 40% slow 4 s |
| Rocked | water | Mud | same as above |
| Soaked | wind | Shock Chain | chains to up to 3 other Soaked enemies within 8 m at 70% damage |
| Rocked | fire | Magma | 4 m ground pool for 4 s, damage over time |
| Rocked | wind | Sandstorm | 4 m area for 3 s, damage over time, Blind |
| Gusted | fire | Fire Tornado | airborne spin, 150% damage over 1.5 s, spreads Burning |
| Gusted | water | Rain Cloud | 5 m cloud for 5 s: soaks enemies, heals the player 2% per s |
| Gusted | earth | Meteor Slam | slammed down: 200% damage in 3 m, stun 1 s |

Reactions are data rows (`shared/data/reactions.json`). A test requires every ordered pair of different elements with a status to be defined.

### 6.4 Elements on enemies

Enemy data carries explicit `weak` and `resist` lists, defaulted from the element cycle: fire is weak to water, water to earth, earth to wind, wind to fire; each element resists the one it is strong against (fire resists wind, water resists fire, earth resists water, wind resists earth). An enemy takes 1.5x damage from a weakness, 0.5x from a resistance, and is immune to the status of its own element. A boss with two elements simply lists what it wants.

## 7. Augments

An augment is a data entry that targets a skill, a tag or an element.

```json
{
  "id": "aug.wide_cone",
  "kind": "stat",
  "rarity": { "common": { "angle": 10 }, "rare": { "angle": 15 }, "epic": { "angle": 25 } },
  "target": { "skill": "fire.flame_cone" },
  "ops": [{ "op": "add", "path": "shape.angle", "value": "$rarity.angle" }]
}
```

| Kind | Example | Mechanism |
|---|---|---|
| Stat | Flame Cone +15 degrees (45 to 60) | add or multiply a number on a skill |
| Behavior | Tidal Stream +1 stream, Fireballs explode | change count, shape or add a hook |
| Reaction | Steam is larger | modify a reaction's numbers |

Rarity is common, rare or epic. Each skill has up to 3 augment sockets. Tag and element targets act as global passives from the same format. M3 ships 12 augments, the full set (at least 40) by M5.

## 8. Enemies

An enemy is a data entry.

```json
{
  "id": "enemy.golem_fire",
  "element": "fire",
  "weak": ["water"], "resist": ["wind"],
  "model": "model.golem", "tint": "#ff6a2a", "scale": 2.6,
  "rig": { "type": "own", "clips": { "idle": "Idle", "walk": "Walk", "attack": ["Attack1", "Attack2"], "guard": ["Defence1"] } },
  "hp": 220, "speed": 2.2, "cost": 6,
  "hurtboxes": [{ "capsule": [[0, 0.6, 0], [0, 2.0, 0], 0.7] }],
  "ai": "tank",
  "attacks": ["atk.golem_slam", "atk.golem_swipe"],
  "guard": { "reduction": 0.8, "onFor": 3, "offFor": 5, "staggerOnWeak": 2 }
}
```

Rig types: `own` (the model's own clips), `mixamo` (baked clips on a Mixamo-compatible rig) and `procedural` (bobbing, stretching, part motion, with effects).

### 8.1 AI archetypes

Rusher, Shooter, Tank, Swarm, Flyer, Charger, Summoner, Ambusher. Each is a small state machine over movement primitives and attacks. Attacks reuse the player's shape primitives (projectile, cone, zone, dash) and always show a ground telegraph before landing.

### 8.2 Guard stance

Tanks and golems cycle guard (golems use their Defence clips). While guarding they take 80% less damage from everything except their weakness element, and reactions bypass the guard. A weakness hit does 1.5x damage and staggers the enemy out of guard for 2 s. This makes the element switch matter.

### 8.3 First roster

| Enemy | Element | Role | Source model | Animation |
|---|---|---|---|---|
| Tree stump | earth | swarm rusher | stump | procedural hop |
| Treefellow | earth | tank, root slam | treefellow | procedural stomp and sway |
| Earth golem | earth | bruiser with guard | treegolem (static) | procedural |
| Fire, water, wind golems | fire, water, wind | tank with guard | golem (own clips), tinted | own clips |
| Fire sprite | fire | flying shooter | particles and sprites | procedural |
| Wisp / wind gust | wind | flyer / pulling swarm | wisp ribbons | procedural |
| Maw | earth | forest boss | maw (Mixamo rig) | baked clips |
| Pumpkin Reaper | earth and fire | graveyard boss | reaper (static, 24 parts) | procedural per part |

### 8.4 Bosses

Bosses have health phases at 66% and 33% with new attacks and adds.
- Maw keeps its own look (grey skin, red hair, antlers, skull necklace, one glowing clawed arm), with no retexture planned. Phase 2 summons stumps, phase 3 adds arena roots and an enrage.
- Reaper: earth and fire, immune to Burning and Rocked, weak to water and wind. Phases add fire waves and earth spikes.

## 9. Runs and rooms

### 9.1 Run mode interface

A run mode implements `start(seed)`, `nextChoices(state)` and `onRoomCleared(state)`. Room-to-room is the first. Open-level and branching-map modes plug in later and reuse everything else.

### 9.2 Room-to-room mode

- About 8 rooms across 2 biomes, then a boss. Room types: combat, elite, boss. Each cleared combat room ends with a reward choice.
- Doors show the next room's reward icon and biome before you pick.
- Rooms are hand-assembled templates per biome (Kenney pieces plus colliders), picked by the `map` seed. An encounter is drawn from the biome's enemy pool within a difficulty budget: `budget(room) = 8 + 3 * roomIndex` (tunable), spent on enemy `cost` values.
- Room data: layout, colliders, spawn points, encounter table, lighting preset, music id.

### 9.3 Rewards

After a combat room the player chooses 1 of 3: a new skill (for one element, never a duplicate), an augment, or a heal. Rarity weights rise with depth, for example rooms 1 to 3: common 70, rare 27, epic 3; later rooms: 40, 45, 15 (tunable). Guarantees: at least one skill offer by room 3, and no repeated skill offers within a run.

### 9.4 Difficulty

Enemy budget rises each room, with modest health and damage scaling. Elites get a modifier: fire aura, trail of burning ground, speed boost or extra guard.

## 10. Meta-progression (unlocks only)

An unlock ledger per player: skills and augments enter the pool through achievements (for example "trigger Steam 50 times", "beat Maw"), never through currency, and never make a run stronger. A fifth element (ice, supported by the Spellwoven art) can be an unlock later. Guests keep the ledger in the browser. Signed-in players keep it on the server (post-first-playable).

## 11. Testing

- Data validation: every skill, augment, enemy, attack, room and reaction references real fx, clips, statuses, models and licence entries.
- Determinism: same seed plus same input script gives the same state hash across two runs.
- Reaction completeness: every ordered pair is defined.
- Headless balance: bots play whole runs (choosing elements by enemy weakness) and report win rate, run length, and the most and least used skills, augments and reactions.
- Guard and boss phase tests: thresholds trigger exactly once.
- Wiki: `scripts/gen-wiki.ts` builds `WIKI.md` from the data and a test fails while it is stale.
- Licence gate: `licenses.json` is checked on every build. Unverified assets produce a warning during development, and fail the build once the gate is switched on (before any public release).
- Rules (in the new repo's `CLAUDE.md`): version bump and patch-note entry with every change, tests before pushing.

## 12. Animation

- Mixamo clips are baked offline onto each target rig (world-turn-since-rest retargeting plus a swing correction that aims each limb along the source's). The result is 30 fps Int16 quaternion clips per rig (staging `clips/<rig>/`, 52 clips).
- Casting uses an upper-body bone mask over the locomotion clips, so the player can move while casting. Aim pitch is added procedurally on the spine and head.
- Legs follow movement (4-direction walk, run, sprint, jump, dodge), the upper body follows aim.
- Enemies use their own clips (golem), baked Mixamo clips (Maw) or procedural motion (everything else).
- Verified in the spike: the cast mask leaves the legs unchanged (0 degrees), and the swing correction removes the fixed rest-pose offset (arms 74 and 87 degrees without it).
- Not yet verified: motion in real time (foot sliding, blends), and the Old Wizard's robe, which no clip drives.

## 13. Dev panel (in the game, like MMO Arena's)

The game has a dev panel built in from M0, so the owner can tune numbers while playing and measure performance on their own machine. It is modelled on MMO Arena's F2 panel (`devPanel.ts`, `devPages.ts`, `devEdits.ts`, `devfields.ts`, `devpatch.ts`).

### 13.1 Access

F2 or a small dev button opens it. It is available when the URL has `?dev` or `localStorage.confluxDev` is set (dev builds and the owner). Public builds hide it. Later, when the server exists, access follows the owner and dev grants, like MMO Arena. The sim pauses while the panel is open on a data page (it can be turned off).

### 13.2 Editing values (the pages)

Each page has a search box, a navigation tree, groups of values with plain-words labels, units and bounds, the file's value next to the live one, and a reset for the entry and for the page.

| Page | What it edits |
|---|---|
| Player and game | health, move speed, dodge, swap cooldown, swap-in bonus, cast movement, global options |
| Elements | the weakness cycle, resist and weak multipliers |
| Statuses | duration, damage, slow, brittle percentage |
| Reactions | every number in the reaction table |
| Skills | damage, cooldown, shape numbers (speed, radius, angle, range, width, duration, count), windup, cast clip, applied status |
| Augments | rarity values and ops |
| Enemies and bosses | health, speed, cost, element, weak and resist, guard timings, attacks, boss phase thresholds |
| Rooms and encounters | the budget formula, enemy pools, room templates |
| Models and mobs | uploaded models, the mob form, animation mapping, placement (section 13.7) |
| Rewards | rarity weights by depth, guarantees |
| Effects (visual only) | effect timing, scale, intensity. Never changes the sim state or its hash. |

### 13.3 Data layers and the Changes list

Numbers come in layers: the data files, then the owner's saved session numbers, then the numbers tried in the current run. Each layer is put back before layers are applied again. A change reaches entities already in the run. The toolbar has *Try now*, *Keep for my session* (browser storage), *Put all back*, and *Changes (N)*, which lists every changed value as old to new with an undo for each. Edits are validated (bounds, existing paths) before they apply.

Because no server exists at first, the way to make changes permanent is **Copy changes** (the list as JSON). The owner pastes it to Claude, who applies it to the data files and bumps the version. When the server exists, a *Commit to GitHub* button can do the same, like MMO Arena. A run that used tuned numbers is flagged and never counts toward unlocks.

### 13.4 Run and match tools

| Tool | Purpose |
|---|---|
| Pause, step one tick, time scale (0.1x to 2x) | study fast fights |
| Restart room, set seed and restart, skip room, jump to boss | reach any situation quickly |
| God mode, infinite cooldowns, free camera | test without dying |
| Spawn enemy (id, count, at the crosshair), spawn dummy with a chosen status, kill all | build the combo test |
| Give skill, give augment, set active element, apply status to the target | test builds |
| Draw hurtboxes, colliders, the aim ray, telegraphs; show AI state and status timers | see what the sim sees |
| Reaction log | the last reactions with their numbers |

### 13.5 Animation and model viewer

Pick any model and any baked clip, scrub the timeline, test the upper-body mask over a locomotion clip, choose the cast clip for each archetype, and preview a golem tint. This is where clip choices are made visually.

### 13.6 Performance page (for GPU testing)

| Reading or control | Detail |
|---|---|
| FPS (average, 1% low, minimum) and frame time | live graph |
| Where the time goes | sim worker tick time, render time, and GPU time where `EXT_disjoint_timer_query_webgl2` exists |
| Renderer counts | draw calls, triangles, geometries, textures, programs (`renderer.info`), memory where the browser reports it |
| Environment | GPU name (`WEBGL_debug_renderer_info`), browser, resolution, device pixel ratio, render scale |
| Live toggles | render scale, antialiasing, shadows, effects (sprites, particles, shaders), texture filtering, enemy count cap |
| 10-second benchmark | a fixed camera path through a stress room with a set number of enemies and effects |
| Report | one button copies a plain-text report: GPU, resolution, settings, average fps, 1% low, worst frame, draw calls, triangles. The owner pastes it as feedback. |

The panel costs nothing per frame while closed, and the performance readouts only sample while the performance page is open.

### 13.7 Adding mobs from the panel (model import)

The owner can upload a new mob model in the dev panel and have it join the game without a code change. It mirrors the upload box on MMO Arena's and Aim Arena's Models pages (a file picker or drop box, a size limit, a list of uploaded models with delete).

**Step by step**

1. **Upload.** Drop a `.glb` or `.gltf` (with its textures, or as a `.zip`), or an `.fbx` (textures embedded or alongside). Limit: 100 MB per file. USDZ is not read in the browser (convert it first, as was done for the Reaper).
2. **Inspect.** The panel reads the file and shows meshes, triangles, skeleton and bone names, animation clips with durations, textures with sizes, and bounding size. It flags problems (no mesh, a texture it cannot decode, more than 4 skin weights per vertex, a huge triangle count).
3. **Prepare (in the browser, no server).** Fit and orient: scale to a chosen height, turn to face +Z, put the feet at y = 0. Reduce triangles to the budget (mobs 30,000, bosses 60,000) with the meshopt simplifier. Downscale textures to the render profile's tier (at most 1024 px). Keep skins and clips.
4. **Animation.** The panel picks one of two modes from what the file contains:
   - **Own clips:** the model has its own animations. A mapping table (idle, walk, run, attack 1 to 3, guard, hit, death) is filled by name matching and can be edited with dropdowns and a live preview.
   - **Procedural:** a static model, or one the owner prefers to animate by motion presets (hop, stomp and sway, hover, spin, lunge, part sway), each with numbers.

   Models on a Mixamo skeleton also get a third mode, **shared clips**, after the first playable (it needs the clip library stored in a rig-independent form and retargeted when the model loads; until then Mixamo-rigged mobs use their own clips or the offline bake script).
5. **Define the mob.** A form fills the enemy JSON from section 8: name, id, element (with weak and resist defaulted from the cycle, editable), AI archetype, health, speed, cost, tint, scale, guard on or off with timings, and attacks chosen from templates (melee swipe, slam, projectile, charge, summon) with their numbers. Hurtbox capsules are generated from the bounding box, drawn over the model, and editable.
6. **Place it.** Tick which biomes and encounter pools it belongs to, and its cost. A **Spawn now** button puts it next to the player in the current run, and a **test arena** with a training dummy tries its attacks.
7. **Save.** The model (processed GLB), its enemy JSON and a manifest entry (author, licence, source URL, left blank and marked unverified by default) are stored in the browser (IndexedDB) as a **custom content layer**, loaded after the data files. They appear in the Changes list as additions with an undo, and the uploaded-models list has a delete that also removes the mob from its encounter pools.
8. **Make it permanent.** *Export* downloads one zip: the processed GLB, the enemy JSON and the licence stub, laid out like the repo. The owner gives it to Claude, who adds the files and bumps the version. When the server exists, a *Commit* button does it, like MMO Arena.

**Rules.** The sim knows nothing about files: a custom mob is an enemy entry that points at a logical model ID (`model.custom.<id>`), so the determinism and data-validation rules still apply and the state hash includes the enemy data. A run that uses custom content is flagged and never counts toward unlocks. Uploads that fail validation are refused with a plain message and nothing is stored. The same flow is later reusable for bosses and props (a *kind* choice at step 1).

### 13.8 Tests

Every editable field has a label, unit and bounds (a catalogue test fails on an unlabelled field). Applying and then undoing a patch restores the exact values. The Effects page never changes a state hash. Closing the panel stops its sampling. For model import (with small fixture models): processing keeps skins and clips, respects the triangle and texture budgets, and fits height and orientation; a malformed file is refused without storing anything; removing a model removes its mob from every encounter pool; an exported zip loads back identically.

## 14. Assets and licences

The converted assets are in a staging folder (`staging/`, 85 MB) with a `licenses.json` manifest and converter scripts. They move into `client/public/assets/` when the repo exists. Original downloads and Spellwoven's raw pack never go in the repo.

| Asset | Status |
|---|---|
| Golem, Treefellow, stump, wisp | CC-BY 4.0 (credit on the Credits page) |
| Old Wizard and 5 staffs (from MMO Arena) | CC-BY 4.0 |
| Maw, all clips | Mixamo terms (Maw's texture files still needed, see section 17) |
| Spellwoven v4 | Full Version terms (ship converted atlases only) |
| spell_animations | CC-BY 4.0 |
| Kenney kits, SBS textures | CC0 |
| **Tree golem, Pumpkin Reaper** | **unverified (owner to supply Sketchfab pages)** |
| **Pack Wizard (52 characters)** | **unverified** |
| **Wood, vegetation, grounds, cave and grass/dirt textures** | **unverified** |
| **Audio (from MMO Arena)** | **unverified there too** |

`licenses.json` is the single source for `CREDITS.md` and the in-game Credits page. The owner has deferred the licence work: the build warns about unverified assets now, and the blocking gate is switched on before any public release. The player model is the chibi pack Wizard (matches the chunky style) once its licence is confirmed, and the Old Wizard until then.

## 15. Milestones

Each milestone ends in something playable.

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M0 | Foundation | repo, build, worker sim tick, asset loader and manifest, render profile, one room with colliders, dev panel shell (F2, data layers, Changes list) and the performance page | a character stands in a room, the sim ticks, tests run |
| M1 | Player | controller, camera and crosshair, 12 starting skills, swap, dodge, statuses and reactions, cast animation with mask, dev pages for player, skills, statuses and reactions, run and match tools, animation viewer | the owner's combo works against training dummies |
| M2 | Enemies | roster, AI archetypes, telegraphs, guard stance, hurt and death, dev pages for enemies, spawn tools, **model import: upload, prepare, own-clips and procedural modes, mob form, spawn and test arena, save and export** | a room with mixed elemental enemies is winnable |
| M3 | Run loop | rooms, encounters, rewards, 20 skills, 12 augments, seeds, dev pages for augments, rooms and rewards, skip-room and seed tools | **first complete playable** |
| M4 | Bosses | Maw and Reaper with phases | both bosses beatable |
| M5 | Polish | gloomy lighting presets, audio, unlocks, wiki, full skill pool and 40 augments, launcher entry | release candidate |

Planning scope: the first implementation plan covers M0 to M3 (the first complete playable). M4 and M5 get their own plans once M3 has been played and tuned.

## 16. Integration (after the first playable)

- A static site first (no sleeping server). A small API service later for accounts, unlocks, seeds and leaderboards.
- Shared sign-in with the launcher, modelled on Aim Arena's `shared-auth.js` and `exelink.js` (to be studied in the plan).
- A launcher entry (a change in the `mmoarena` repo), announcements and moderation, and a desktop deep link.

## 17. Risks and open items

| Risk or item | Plan |
|---|---|
| Unverified licences (section 14) | deferred by the owner; the manifest warns now, the gate is enforced before any public release |
| Maw texture files not yet in staging | the owner has the textured model and will send the texture files |
| Tree golem and Reaper are static | animate procedurally (per part for the Reaper) |
| Old Wizard robe not driven by clips | cloth chain or rest-locking, if the Old Wizard is used |
| 3D aim and collision data | generate colliders from kit bounds, generous hurtboxes, optional aim assist |
| Performance at 1080p with antialiasing | render-scale option and the dev panel's performance page and benchmark; the owner will test on their own GPU and send the report (nothing measured so far) |
| Real-time animation quality | check foot planting and blends in M1 |
| Uploaded models vary wildly (huge meshes, bad rigs, missing textures) | validation and budgets in the import step, refuse with plain messages, test with fixture models |
| Content volume (32 skills, 40+ augments) | data-driven design, growing by milestone |
| Name availability | "Conflux" is a common word. Check search and store collisions before any public release. |
| Cross-browser determinism | server-authoritative co-op, same-engine replays only |
