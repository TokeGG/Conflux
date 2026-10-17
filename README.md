# Conflux · v0.1.3

A third-person action roguelite that runs in your browser. You hold one of four elements at a time (fire, water, earth, wind), fight elemental monsters through a run of rooms, and win by switching element to suit the enemy and chaining elements into reactions. Every run is different.

The design is in [`docs/superpowers/specs/2026-10-17-conflux-design.md`](docs/superpowers/specs/2026-10-17-conflux-design.md); the build plan is in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Running it

```bash
npm install
npm run dev        # Vite on http://localhost:5173 (add ?dev for the dev panel, F2 to open it)
npm run build      # production build into client/dist
npm test           # simulation, data, tools
npm run typecheck
npm run bump -- "What changed."   # version, README line 1 and the patch notes
```

## Layout

| Folder | Contents |
|---|---|
| `shared/` | the simulation and all game data (JSON); no DOM, no Three.js |
| `client/` | Three.js rendering, input, animation, effects, HUD, the dev panel |
| `scripts/` | asset converters, release tools, balance runs |

## Assets and licences

Converted assets live in `client/public/assets/`; `client/public/assets/licenses.json` lists every asset with author, licence and a `verified` flag. Unverified assets only warn for now; the blocking gate is switched on before any public release. Original downloads and the unmodified Spellwoven pack are never committed.
