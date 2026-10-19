# Project rules

Conflux is a browser roguelite. The binding design is `docs/superpowers/specs/2026-10-17-conflux-design.md`; the build plan is `docs/superpowers/plans/2026-10-17-conflux-m0-m3.md`.

- **Layering:** `shared/` is the deterministic 60 Hz simulation and all game data. It must not import the DOM, Three.js, or any art path. Art is referenced only by logical ID (`fx.fireball_travel`, `model.golem`) and resolved by the asset manifest. The client reads sim state and sends inputs; it never decides gameplay.
- **Randomness:** only the four seeded streams (`map`, `encounter`, `reward`, `combat`). Never `Math.random()` in `shared/`.
- **Every change bumps the version:** run `npm run bump -- "<what changed, plain words>"` (patch number +1, README line 1, root and client `package.json`, a new top entry in `shared/data/patches.json`). Keep versions below 1.0. Owner and dev tools are never listed in patch notes.
- **Before pushing:** `npm run typecheck` and `npm test` must pass.
- **Wiki:** after changing skills, augments, reactions, statuses or enemies, run `npm run wiki` and commit `WIKI.md` (a test fails while it is out of date).
- **Numbers are tuned in the dev panel** (F2 with `?dev`). A tuned run never counts toward unlocks.
- **Licences:** `client/public/assets/licenses.json` lists every asset. Unverified assets only warn until `LICENSE_GATE=enforce` is set, which must be switched on before any public release. Never commit raw downloads or the unmodified Spellwoven pack.
- **Three.js is pinned to 0.164.1.** Newer releases broke FBX rendering in this project.
- **Tests first:** every behaviour has a test that was seen to fail before the code that makes it pass. Tests run with `node:test` through `tsx`.
