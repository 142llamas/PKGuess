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
| docs/css/styles.css | 1.2.0 | ✅ | Sections A–E: shell, canonical game CSS, single-player, Pokédex, Safari. |
| docs/js/lib/dom.js | 1.0.0 | ✅ | `el()`, `clear`, `mount`, `on`. No global state. |
| docs/js/modes.js | 1.1.0 | ✅ | Registry (8 entries). Draft split: **Draft Battle** (free-play, random) + **Daily Challenge** (same seeded draft); both lazy-load draftbattle.js, differ by `params.variant`. All `enabled:false` until ported. |
| docs/js/main.js | 1.2.0 | ✅ | (controller try/catch added)  Config load, menu render, hash router `#/<mode>/<gen>`, lazy launch, friendly fallbacks. Now passes `mode.params` to the controller. Tested under jsdom (8 cards, real config load). |

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

### Phase 2b (DONE this pass) — movestats + Gen 1 type chart
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| tools/generate-movestats.mjs | 1.0.0 | ✅ | **Bootstrap only** — PokeAPI → initial movestats + review CSVs. Superseded by apply-movestats once curated. |
| tools/apply-movestats.mjs | 1.1.0 | ✅ | Gen 2 movestats from curated CSV; **Gen 1 movestats derived from Gen 2** (mirrors values; Gen-2-only + deleted moves naturally absent). Does NOT strip movelists — see note. |
| docs/data/movestats-gen1.json | derived | ✅ | 160 moves, mirrors Gen 2 exactly. Per user: "Gen 1 follows Gen 2." |
| docs/data/movestats-gen2.json | curated | ✅ | 244 moves. Bide/Counter/Beat Up/Mirror Coat/Present excluded → not draftable. |
| docs/data/movelist-gen{1,2}.json | gen | ✅ | **Full real-move learnsets** (kept for the guess game's moveset clues). Junk like the bled "Gyarados" is dropped (species-name = not a move); real moves without movestats (Counter, Bide…) stay here and are simply excluded from Draft at draft time. |
| docs/data/movestats-gen{1,2}.review.csv | curated | ✅ | Your edited CSVs — the source of record for apply-movestats. |
| docs/data/typechart-gen1.json | gen | ✅ | 15 types, **derived** from the Gen 2 chart (Dark/Steel removed; Bug↔Poison 2×, Ghost→Psychic 0). Please verify edge matchups. |

## Guess modes (Phase 3 — IN PROGRESS)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/lib/engine.js | 1.0.0 | ✅ | DOM-free `PokeGuessRound` + `normalizeName`. Faithful port of the canonical Gen 2 round logic (pools, availability/locks/exhaustion, rising+discounted costs, purchase limits, all clue-value specials, category diversity, weighted random reveal, guess+score). **One engine, both gens:** ids ≤26 are identical across gens (literal); moveset clues (ids 27-34 diverge) resolve by `special`/`field`. Tested headless vs real gen1 + gen2 data (26/27 assertions; the 1 was a bad test fixture, not a bug). |
| docs/js/modes/single.js | 1.1.0 | ✅ | Single-player on engine.js (config → game → summary). **1.1.0:** guards stale/missing clue-difficulty data with a message instead of a blank screen; main.js now also try/catches controllers. Tested under jsdom. **Enabled.** |
| docs/js/modes/pokedex.js | 1.0.0 | ✅ | Pokédex/study reference: searchable, sortable (#/A–Z) list; catch tracker (localStorage); detail view (info, type matchups, comp movesets, full move list). Reads movelist. Tested under jsdom (11 assertions). **Mode enabled.** |
| docs/js/modes/safari.js | 1.0.0 | ✅ | Safari Zone: shared budget across a shuffled pool; 2 free start clues (Generation + BST Range); bait (random reveal), run (skip), wrong −1; ends on 0 pts / pool exhausted; score = caught; catch tracker shared w/ Pokédex. Tested under jsdom (14 assertions). **Enabled.** |
| docs/js/modes/victoryroad.js | — | ⬜ | Endless streak gauntlet (next). |
| docs/js/lib/mp-rules.js + docs/js/modes/multiplayer.js | ⬜ | Hot-seat first. |

### Draft structure (Phase 5) — DECIDED: 6×2
Draft shows **6 Pokémon; the player takes ~2 aspects from each** to assemble the 12
(6 stats / 2 types / 4 moves) — framed as "build one Pokémon from a team of six."
Chosen over the vetted engine's 12-spins-one-aspect model (less of a slog; thematic
team-of-6). Accepted consequence: rerolls reveal new Pokémon, so taking 1 aspect then
rerolling can pull from MORE than 6 species before all 12 are filled — fine by design.
**Implication:** `draft.js` v0.4.1 (vetted 12-spin engine) must be reworked for 6×2 and
re-verified; applies to both free-play and daily.

### Resolved: Gen 1 vs Gen 2 guess split (SPEC §11 Q1) — CONFIRMED
ONE engine + ONE set of controllers, driven by `gen{N}.json`. **Gen 1 adopts Gen 2's
rules** (confirmed by user): the unified engine applies Gen 2's contextual-availability
cross-inference to both gens. No per-gen rule branching.

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
- **Gen 1 source = `PokeGuess_Red_Blue_Yellow_v3.xlsx`** — treated as the source of
  truth; richer than the old inline Gen 1 data.
- **Name reconciliation (3):** the v3 move sheet spells a few names differently from
  its dex sheet — `Nidoran(f)→Nidoran-F`, `Nidoran(m)→Nidoran-M`, `Farfetch'd→Farfetchd`.
  The pipeline normalises move-sheet names to the dex spelling so movelist keys match
  what engine.js/draft.js look up (`dexName.toLowerCase()`).
- **Golbat moves** were missing from the v3 move sheet; supplied via
  `tools/supplemental/gen1-moves.json` (7 Level-up + 14 TM/HM) and merged by the
  pipeline (de-duplicated, so it self-deactivates once added to the Excel). All
  151 Gen 1 species now have moves; every move in both gens resolves to movestats.
- **Unresolved move cells (2):** phanpy & donphan have a literal `"but why?)"`
  in the Move column — correctly dropped. Optionally fix at the Excel source.

- **Non-moves removed by the gate (2):** `Gyarados` (Gen 2, from a garbled
  "Gyarados only): Thunderbolt" cell) and `Tail Club` (Gen 1, Cubone/Marowak —
  not a real move; their real move "Bone Club" is present). Both correctly dropped.
- **Movestats to set manually:** variable/fixed-power moves are flagged
  `NEEDS_BP_REVIEW` in the review CSVs (Counter, Seismic Toss, Return/Frustration,
  Dragon Rage, OHKO moves, etc.) — `bp` is left at 0 for you to fill in. Move
  type/power/accuracy come from a modern base; the main Gen-2-era nuance already
  handled is type (e.g. Bite = Normal in Gen 1, Dark in Gen 2).

## Inputs held this session
Canonical HTML (launcher wrapping two inline-data games), Gen 1 Excel
(`PokeGuess_Red_Blue_Yellow_v3.xlsx`), Gen 2 Excel (`pokeguessworkbook.xlsx`,
incl. `Field Reference` map), `sim.js`, `draft.js` v0.4.1. Still needed from you:
silhouette sprite assets (named by Pokédex #), Firebase web config (Phase 4).
