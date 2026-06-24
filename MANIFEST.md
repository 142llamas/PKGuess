# PokeGuess Online — MANIFEST
_Last updated: 2026-06-23 · the authoritative file inventory. Paste into a new chat to re-sync._

Per SPEC principle 1, every code file carries a header (`@file`, `@version`,
`@updated`, `@changelog`); versions live in files, never in filenames. This
table is the index. Status: ✅ done & tested · 🟡 in progress · ⬜ not started.

## App shell (Phase 1 — DONE this pass)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/index.html | 1.0.0 | ✅ | Loads fonts + styles.css + main.js (module). Relative paths for Pages subpath. |
| docs/.nojekyll | — | ✅ | Empty; keeps Pages from stripping `js/`-prefixed paths. |
| docs/css/styles.css | 1.0.0 | ✅ | Section A = new launcher/shell styles; Section B = canonical game CSS verbatim (tokens + all mode screens). 732 lines. |
| docs/js/lib/dom.js | 1.0.0 | ✅ | `el()`, `clear`, `mount`, `on`. No global state. |
| docs/js/modes.js | 1.0.0 | ✅ | Registry (7 modes), `getMode`, `resolveFactory`. Guess modes gens [1,2]; Draft [2]. All `enabled:false` until ported. |
| docs/js/main.js | 1.0.0 | ✅ | Config load (graceful default), menu render, hash router `#/<mode>/<gen>`, lazy launch, friendly fallbacks. Tested under jsdom. |

## Data pipeline & data (Phase 2 — NEXT)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| tools/generate-data.mjs | — | ⬜ | Excel → data/*.json with SPEC §7 cleaning; completeness-gate on movestats. |
| docs/data/config.json | — | ⬜ | Difficulties, categories, defaults, modes list. |
| docs/data/gen1.json / gen2.json | — | ⬜ | Generated from both Excels. |
| docs/data/movelist-gen{1,2}.json | — | ⬜ | Full movepools, cleaned. |
| docs/data/movestats-gen{1,2}.json | — | ⬜ | Derived; `cat` computed from type. |
| docs/data/typechart-gen{1,2}.json | — | ⬜ | Derived. |

## Guess modes (Phase 3)
| File | Status | Notes |
|------|--------|-------|
| docs/js/lib/engine.js | ⬜ | Port from canonical HTML. Resolve gen1/gen2 controller split here. |
| docs/js/modes/{single,pokedex,safari,victoryroad}.js | ⬜ | |
| docs/js/lib/mp-rules.js + docs/js/modes/multiplayer.js | ⬜ | Hot-seat first. |

## Online + identity + leaderboard (Phase 4)
| File | Status |
|------|--------|
| docs/js/lib/{firebase,identity,leaderboard-data}.js | ⬜ |
| docs/js/modes/{online,leaderboard}.js | ⬜ |

## Draft Battle (Phase 5) — engines VETTED, drop in as-is
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/lib/sim.js | original | ⬜ (have it) | Verified: exports toRealStats/moveId/simulateBattle/runMatch; N=501; turn cap 100; cat from type. |
| docs/js/lib/draft.js | 0.4.1 | ⬜ (have it) | Verified: imports from sim.js; targets real gen2.json fields; drops moves absent from movestats. |
| docs/js/lib/share.js | — | ⬜ | Summary card + WhatsApp/clipboard. |
| docs/js/modes/draftbattle.js | — | ⬜ | Draft UI → battle playback → throne → daily → share. |

## Rules / docs / tests (Phase 6)
| File | Status |
|------|--------|
| database.rules.json | ⬜ |
| README.md | ⬜ |
| tools/test/*.mjs | ⬜ (unit tests for engine/sim/draft/mp-rules) |

## Inputs held this session
Canonical HTML (launcher wrapping two inline-data games), Gen 1 Excel
(`PokeGuess_Red_Blue_Yellow_v5.xlsx`), Gen 2 Excel (`pokeguessworkbook.xlsx`,
incl. `Field Reference` map), `sim.js`, `draft.js` v0.4.1. Still needed from you:
silhouette sprite assets (named by Pokédex #), Firebase web config (Phase 4).
