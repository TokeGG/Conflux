# Staging (not a repo)

Converted assets for the elemental roguelite, ready to move into the new repo's `client/public/assets/`.
`licenses.json` lists every asset with author, license and a `verified` flag. Unverified assets must not ship.

| Folder | What |
|---|---|
| `models/` | player, enemies, bosses, weapons as GLB (skins and clips kept) |
| `clips/<rig>/` | 52 Mixamo clips baked at 30 fps per rig (`wizardpack`, `oldwizard`), Int16 quaternions plus hips, `index.json` per rig |
| `fx/spellwoven/` | 72 effects as lossless WebP sheets plus `fx.json` (frame size, columns, timing, anchor, events) |
| `fx/spell_animations/` | 21 more spell images (CC-BY, credit required) |
| `env/<kit>/` | 551 Kenney pieces with `index.json` (bounds and triangle counts for collision generation) |
| `tex/` | texture sets as WebP with `index.json` (license per set) |
| `audio/` | MMO Arena's sound library (unverified) |
| `scripts/` | the converters that made all of this (rerunnable) |
| `contact_*.png` | visual checks of the converted models and baked clips |
