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
| docs/js/modes.js | 1.1.0 | ✅ | Registry (8 entries). Draft split: **Draft Battle** (free-play, random) + **Daily Challenge** (same seeded draft); both lazy-load draftbattle.js, differ by `params.variant`. All `enabled:false` until ported. |
| docs/js/main.js | 1.1.0 | ✅ | Config load, menu render, hash router `#/<mode>/<gen>`, lazy launch, friendly fallbacks. Now passes `mode.params` to the controller. Tested under jsdom (8 cards, real config load). |

## Data pipeline & data (Phase 2 — DONE this pass, except 2b below)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| tools/generate-data.mjs | 1.0.0 | ✅ | Excel → data/*.json. Reproduces the game's own `fm` header→key map verbatim; cleans the move list (drops stat-block bleed, rescues annotation bleed, collapses double-spaces, fixes known typos); writes `_data-report.json`. Needs `npm install xlsx`. |
| tools/rules/gen1.rules.json / gen2.rules.json | 1.0.0 | ✅ | Per-gen engine config (clues/categories/difficulties/multiClue) lifted verbatim from the canonical HTML; folded into gen{N}.json by the pipeline. |
| docs/data/config.json | 1.0.0 | ✅ | App shell: title, gens, genLabels, mpDefaults, modes list. |
| docs/data/gen1.json | gen | ✅ | 151 mons + clues/categories/difficulties/multiClue. (Excel is richer than old inline — see note below.) |
| docs/data/gen2.json | gen | ✅ | 251 mons + rules. **0 cell diffs vs the shipped game's inline data.** |
| docs/data/movelist-gen{1,2}.json | gen | ✅ | Cleaned movepools `{speciesLower:[{move,source}]}`. 175 stat-fragments dropped, 78 bled moves rescued, 2 junk cells unresolved (phanpy/donphan). |
| docs/data/typechart-gen2.json | gen | ✅ | GSC-era 17-type chart, self-validated. Only Draft (Gen 2) uses it. |
| docs/data/_data-report.json | gen | ✅ | Move-cleaning audit: `rescued` (verify) + `unresolved` (fix at Excel source). |

### Phase 2b (remaining — needed by Draft, not by Guess)
| File | Status | Notes |
|------|--------|-------|
| docs/data/movestats-gen{1,2}.json | ⬜ | Per-move type/bp/acc/prio from a vetted source, with a **completeness gate** (fail loudly if any movepool move lacks stats — this is what catches the last garbled cells). |
| docs/data/typechart-gen1.json | ⬜ | Deferred; only a future Gen 1 Draft would need it. |

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

## Notes
- **Gen 1 Excel ≠ old inline data (expected).** The `v5` Gen 1 workbook is newer
  and richer than the Gen 1 data baked into the shipped launcher: `exampleMoveset`
  and `tmHmMove` are populated in the Excel but were empty inline, and
  `evoMethod`/`compMoveset*`/`evolvesFrom` differ on some entries (540 cells).
  Per "Excel is the source of truth," the generated `gen1.json` is authoritative.
  Gen 2 matched the inline data exactly (0 diffs).
- **Unresolved move cells (2):** phanpy & donphan have a literal `"but why?)"`
  in the Move column — correctly dropped. Optionally fix at the Excel source.

## Inputs held this session
Canonical HTML (launcher wrapping two inline-data games), Gen 1 Excel
(`PokeGuess_Red_Blue_Yellow_v5.xlsx`), Gen 2 Excel (`pokeguessworkbook.xlsx`,
incl. `Field Reference` map), `sim.js`, `draft.js` v0.4.1. Still needed from you:
silhouette sprite assets (named by Pokédex #), Firebase web config (Phase 4).
