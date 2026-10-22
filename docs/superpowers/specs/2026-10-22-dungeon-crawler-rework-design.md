# Conflux dungeon-crawler rework: design

Status: draft for the owner's review. Supersedes the world, map and run-flow parts of `2026-10-17-conflux-design.md`. Combat, elements, reactions, skills, augments, unlocks and the dev panel stay as built.

## 1. Intent

The owner played v0.1.39 and found it playable but wrong: the world is bright and green, the map is not what they wanted, and vertical mouse look is inverted. They want a **dark, gloomy dungeon crawler** that matches the mood of the mobs they supplied.

In the owner's words:
- Every room is different and random; rooms are connected.
- Fight rooms lock until cleared; quiet rooms (shops and the like) are open.
- The run is endless; each floor can be anything different from the one before.
- Souls are the currency.
- All kinds of room styles, including a **bone pit with skeleton mobs** and a **library with book mobs**.
- **More decor and textures: a lot of scenery.** The lighting in the prototype was fine.

Success: a first-time player walks through five or six rooms and every one looks and plays differently, all of them dark and cluttered with scenery, with no two layouts alike.

## 2. What stays and what changes

| Stays | Changes |
|---|---|
| Deterministic 60 Hz sim, four seeded streams, replay hash | World: forest and fixed templates are replaced by generated rooms |
| Elements, statuses, reactions, skills, augments, elites | Map: 9 fixed rooms become an endless run of generated floors |
| Unlock ledger, tuned-run rule, patch notes, wiki | Rewards: pick-of-three screen becomes souls plus shops |
| Dev panel, model importer, bot and balance report | Look: bright forest becomes dark, fogged and torch-lit |
| Worker sim, `RunDirector`, `enter` message | Controls: vertical mouse look fixed, with a setting to flip it |

## 3. Run structure

- A run is endless. Depth `d` starts at 1. Enemy budget, enemy count and elite chance grow with depth; bosses appear at every 5th depth.
- A **floor** is 8 rooms: about 5 fight rooms (one is an elite room), 1 or 2 quiet rooms, and a last room that holds the stairs down (or the boss on boss depths).
- Rooms are separate simulations joined by a short generated corridor, so the transition is a walk, not a menu. The player's health, skills, augments and souls carry over.
- At the end of a room, 1 to 3 exit doors open. Each door shows what is behind it (fight, elite, shop, shrine, stairs) as an icon above the door, chosen when the room is generated.
- **Theme is independent per room.** Each room picks its theme from the weighted theme list (section 5); the same theme can repeat, and consecutive rooms never use the same layout seed.
- The run ends on death. The death screen shows depth reached, souls banked and rooms cleared. Unlocks still come from the ledger.

## 4. Souls and shops

- Enemies drop souls (weights per enemy in data; elites and bosses drop more). Souls are collected by walking over them or by a pickup radius.
- Fight rooms no longer offer rewards. The pick-of-three screen is removed; its offer logic is reused to stock shops.
- **Shop room** (open, no fight): a keeper and 3 or 4 wares drawn from the reward pool: one skill (the unlock pool and the owned-skill rules still apply), one or two augments with rarity by depth, and a heal. Prices scale with depth and rarity. Walk up to a ware and press the interact key to buy.
- **Shrine room** (open): one free choice between two boons or a trade of health for souls. Not in the first version; the room type and door icon exist so it can be added.
- Souls reset each run; they are not a meta currency.

## 5. Room generator

A room is a pure function of `(runSeed, depth, roomIndex)` using a fork of the `map` stream, so any room can be rebuilt and the same seed always gives the same room.

### 5.1 Layout

1. Pick a theme (weighted by depth where a theme is gated).
2. Pick a footprint on a 4 m grid: rectangle of 4 to 8 by 4 to 8 cells, optionally with one corner block removed (L-shape), or two overlapping rectangles (T or cross) for large rooms.
3. Build floor tiles and walls round the boundary; wall corners are filled so no gap shows.
4. Place 1 to 3 exits (gate pieces in the wall), never on a corner cell. The player starts opposite the first exit.
5. Place props in layers (section 6), keeping clearances: the player's start, every exit, and every enemy spawn stay open, and a walkable path joins start to every exit.
6. Place enemy spots (budget decides how many), then lights.

### 5.2 Themes

| Theme | Look and decor | Mob affinity |
|---|---|---|
| Crypt | Coffins, crypts, gravestones, candles, urns, altar | Skeleton, ghost, zombie |
| Dungeon hall | Columns, braziers, banners, broken walls, rubble | Golem, treefellow, wisp, skeleton |
| Cave | Rock walls, standing rocks, glowing mushrooms, stalagmites, roots | Stump, gust, fire sprite |
| **Bone pit** | Sunken floor, heaps of bones and skulls, broken coffins, a bone throne or altar | **Skeleton swarm**, skeleton mage, bone giant (elite) |
| **Library** | Rows of bookshelves, reading tables, scattered pages, candelabras, a central lectern | **Book mobs**: flying books, a tome guardian (elite), wisps |
| Prison | Iron bars, cells, chains, bone piles in cells, torches | Zombie, skeleton, vampire (elite) |
| Chapel | Pews, altar, cross columns, candles, broken windows | Ghost, vampire, skeleton mage |
| Shop | Keeper, counter, stalls with wares, barrels, chests, banners | none (open room) |
| Boss arena | Large room, pillar ring, central dais, braziers | Maw, Reaper (boss depths) |

Themes can be added later by adding a recipe (section 5.3); no engine change.

### 5.3 Recipes

A theme is data: the footprint ranges, the wall and floor sets, texture sets, prop pools with counts and clearance, light colours and the mob pool. The generator is theme-agnostic. Adding the next theme means adding a recipe and, where an asset is missing, a procedural prop.

## 6. Scenery: a lot of decor and texture

The prototype rooms were too bare. Target density: **120 to 200 visible pieces per room**, built from layers:

1. **Structure:** walls, gates, corners, columns, raised or sunken floor sections.
2. **Floor:** textured tiles with variation (cracked, damp, bone-strewn); decals of rubble, puddles, moss, blood and webs.
3. **Large set pieces (2 to 5):** altars, crypts, bookshelf rows, bone heaps, statues, sarcophagi.
4. **Medium clutter (10 to 20):** coffins, tables, barrels, chests, gravestones, columns, fallen pillars.
5. **Small clutter (40 to 100):** bones, books, pages, candles, urns, skulls, debris, mushrooms, roots, chains.
6. **Wall decor:** banners, torches, hanging moss and chains, cobwebs, bars.

Texturing: the Kenney pieces ship with flat colours, so each theme tints and textures its floor and wall materials from the supplied tile, stone, brick, metal and wood sets (`tex.sbs128` and `tex.sbs256`) at chunky filtering. The palette is desaturated and cool; warm colour comes only from light.

Performance rules: repeated props are instanced; a room's meshes are merged by material where they do not move; at most 8 live point lights per room (nearest-first, the rest baked into fake glow sprites); everything respects the existing render profile so weak GPUs can drop detail.

**Assets that do not exist yet** (to be built procedurally from boxes and the supplied textures, because no kit has them): bookshelves, bone heaps, skulls, scattered pages, book mobs, bone throne, bars and cells. This is the largest new-content risk; see section 9.

## 7. Mobs

Existing roster (golem, treefellow, stump, wisp, gust, fire sprite, treegolem, and the bosses) stays and gets theme affinity weights.

New mobs, as data plus rigs through the existing importer and `procedural` rig type:
- **Skeleton** (basic melee swarmer), **skeleton mage** (ranged), **bone giant** (elite, guard stance). Models: the supplied graveyard `character-skeleton`, animated by the procedural rig.
- **Ghost** and **zombie**, **vampire** (elite): the graveyard character models, same method.
- **Book** (flying, swoops and shoots pages), **tome guardian** (elite, big book with guard stance). No model exists in the supplied kits: the first version builds a book from boxes with a cover texture and a flap animation. If the owner supplies a model, the importer replaces it.

Each new mob gets: element and weaknesses, an attack template from the existing five, cost for the encounter budget, soul value, and a bot-test entry.

## 8. Look and lighting

The prototype's lighting was approved. Rules: near-black ambient, fog colour almost black, a warm player torch that follows the player, flickering braziers, candles and wall torches, cool tints for cave mushrooms and library candelabras, red for boss arenas. Per-theme light colours live in the recipe. Exits are marked with a lit gate so they can be found in the dark.

## 9. Open questions and risks

1. **Book mob model.** Procedural book from boxes is the plan; the owner may prefer to supply a model.
2. **Procedural props** (bookshelves, bone heaps, skulls, cells) carry the most visual risk. Plan: build the first one (bookshelf), show a screenshot, then continue.
3. **Cave and minidungeon kits** are not in the repo yet (the first import skipped them). They are CC0 Kenney and sit in the staging folder; the work imports them.
4. **Lights on weak GPUs:** capped at 8 per room; the render profile can lower it.
5. **Licences:** textures marked unverified in the licence ledger only warn; unchanged policy.

## 10. Testing

- Generator invariants over 500 seeds per theme: every exit reachable from the start; no prop on the start, an exit or an enemy spot; walls closed (no gaps in the boundary); piece counts within the recipe's range; no two rooms from different seeds identical.
- Determinism: the same `(runSeed, depth, roomIndex)` gives byte-identical output.
- The scripted bot plays generated rooms of every theme and clears most of them; the balance report gains per-theme win rates.
- Director tests: souls collected, shop purchase rules, doors show the right room kind, health and loadout carry across rooms, the tuned and unlock rules hold.
- Browser smoke: boot, walk through a door into a generated room, buy from a shop, pick a theme by URL parameter (`?theme=library&seed=n`) and take screenshots of every theme.
- Controls: a test that vertical look follows the setting.

## 11. Milestones

Each is its own plan and ends with something the owner can play.

| # | Milestone | Playable result |
|---|---|---|
| D1 | Generator core, dark look, textures, controls fix, three themes (crypt, hall, cave), endless rooms with doors and corridors | Walk through random dark rooms |
| D2 | Souls, shops, quiet rooms, door icons, floors, depth scaling, death screen | The full loop |
| D3 | Remaining themes (bone pit, library, prison, chapel), procedural props, new mobs including skeletons and books | All the styles |
| D4 | Scenery density pass, boss arena and boss floors, balance, performance, wiki and patch notes | Ready to share |

Only D1 is planned in detail first.
