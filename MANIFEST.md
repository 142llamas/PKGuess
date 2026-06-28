# PokeGuess Online — MANIFEST
_Last updated: 2026-06-25 · the authoritative file inventory. Paste into a new chat to re-sync._

Per SPEC principle 1, every code file carries a header (`@file`, `@version`,
`@updated`, `@changelog`); versions live in files, never in filenames. This
table is the index. Status: ✅ done & tested · 🟡 in progress · ⬜ not started.

## App shell (Phase 1 — DONE this pass)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/index.html | 1.0.0 | ✅ | Loads fonts + styles.css + main.js (module). Relative paths for Pages subpath. |
| docs/.nojekyll | — | ✅ | Empty; keeps Pages from stripping `js/`-prefixed paths. |
| docs/css/styles.css | 1.9.0 | ✅ | Sections A–H: shell, canonical game CSS, single-player, Pokédex, Safari, VR, Multiplayer, Firebase/Leaderboard. |
| docs/js/lib/dom.js | 1.1.0 | ✅ | `el()`, `clear`, `mount`, `on`. No global state. |
| docs/js/modes.js | 1.6.0 | ✅ | Registry (8 entries). Draft split: **Draft Battle** (free-play, random) + **Daily Challenge** (same seeded draft); both lazy-load draftbattle.js, differ by `params.variant`. All `enabled:false` until ported. |
| docs/js/main.js | 1.3.0 | ✅ | (controller try/catch added)  Config load, menu render, hash router `#/<mode>/<gen>`, lazy launch, friendly fallbacks. Now passes `mode.params` to the controller. Tested under jsdom (8 cards, real config load). |

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

## Fixes & polish pass
| Change | Status |
|--------|--------|
| Menu group order: Draft → Guess → Reference | ✅ |
| Menu cards wider on desktop (max-width 860px) | ✅ |
| Stat spread labels (HP/Atk/Def/Spc/Spe gen1, HP/Atk/Def/SpA/SpD/Spe gen2) via `statSpreadEl()` in dom.js | ✅ |
| Victory Road icon: 🗻 (mountain) instead of 🏎 (race car) | ✅ |
| VR tier rows expandable/collapsible with clue names | ✅ |
| Leaderboard gen buttons navigate to leaderboard (gen sets default tab) | ✅ |
| Leaderboard waits for auth before reading (fixes empty board) | ✅ |
| database.rules.json: `.read` moved to leaderboard parent level (fixes read permission) | ✅ |
| Multiplayer: gen shown in setup title and game topbar | ✅ |
| Multiplayer: running guess log for current round | ✅ |
| Multiplayer: null value removed from action block (RTG mode) | ✅ |
| Safari: Bait = cheap clues (<4pt base), Rock = costly clues (≥4pt base), Run = 3 buttons | ✅ |

## Draft Battle + Daily Challenge (Phase 5a — DONE: engine + data)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/sim.js | vetted | ✅ | Copied verbatim from provided sim__1_.js. runMatch/simulateBattle/toRealStats/moveId. |
| docs/js/draft.js | v0.4.1 | ✅ | Copied verbatim from provided draft__1_.js. DraftSession/autoDraft/buildSpeciesList/buildLearnsetMap/normalizeSpecies. |
| docs/js/lib/draft-adapter.js | 1.0.0 | ✅ | Thin re-export shim so mode controllers import cleanly from lib/. |
| docs/js/modes/draftbattle.js | 1.5.0 | ✅ | 6×2 draft UI: one card at a time, pick 0–2 attributes, advance. Stats/types/moves all interactive. Reroll buttons. Drafted-summary sidebar. Skip advances. Complete screen. Battle phase wired as Phase 5b stub. **Enabled (Draft Battle + Daily Challenge).** |
| docs/data/movelist-gen2.json | gen | ✅ | Mew: 102 moves incl. 93 TM/HMs. Smeargle: Sketch only (correct for guess game). |
| docs/data/draftpool-gen2.json | gen | ✅ | **New file.** Draft-specific pool overrides. Smeargle: 257 moves (all minus Sketch) for draft. Mew not overridden (movelist already correct). |

### Sanity check results
- Smeargle: 242 draftable moves, Sketch excluded ✓
- Mew: 95 moves (93 TM/HM + level-up/tutor) ✓
- Magikarp: 19 draftable moves, shows ≤10 per card ✓
- Ditto + Unown: excluded from draft ✓
- 6×2 draft completes in ~6–12 cards as designed ✓

### Phase 5b — DONE (this pass)
- ✅ Battle phase: `runMatch` integration (N=501) + step-through playback UI
  (live HP bars, play/pause/step/skip, verdict banner with win% and W–L).
- ✅ Throne system (Firebase-backed): 5 thrones (Day/Week/Month/Year/All-Time);
  a throne whose stored `period` has rolled over (midnight CT, etc.) shows a
  deterministic NPC champion (`autoDraft` seeded by `throne:{tier}:{period}`);
  beat the champion (strict majority) to claim it.
- ✅ Daily Challenge: one seeded draft (CT-date seed) + one attempt per identity
  (existence check + immutable Firebase rule), all-pairs ranking by average
  win%, results page + share card.
- ✅ share.js: **created this pass** (was listed done previously but was absent
  from disk). CT-aware date/period/seed helpers + summary card + WhatsApp/clipboard.
- ⬜ Silhouette sprite assets (img/silhouettes/{spriteId}.png) — still owed by
  user; the controller references the build's `silhouetteSpriteId` and degrades
  gracefully without the images.

### ✅ RESOLVED — draft is now genuinely 2-picks-per-card
The engine (`draft.js` v0.5.0) was reworked (with approval) so picks RECORD on
the current card and the deck advances only on `commitCard()`. Both of a card's
picks therefore read THAT card's data. Spec rules implemented & tested:
2 picks/card from the correct card; a type drafted twice → mono (Fire+Fire ⇒
Fire/—); "—" pickable on mono cards (≥1 real type guaranteed); drafted stats
greyed on all later cards; no duplicate moves; move reroll = with replacement,
weighted toward unseen moves. Headless `test-engine2.mjs`: 20/20 (incl. "both
stats from same card", 500/500 completion with 0 mis-sourced picks, daily
determinism). jsdom UI smoke: 12/12 (confirm gated to 2 picks, greying, reroll,
completion). The vetted `sim.js` was NOT touched.

## Firebase + Identity + Leaderboards (Phase 4 — DONE)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/lib/firebase.js | 1.0.0 | ✅ | Lazy Firebase SDK loader (CDN, v10.12.2). Returns thin helpers: set/update/get/push/onValue/onDisconnectSet. Cached after first load; modes that don't need the network never fetch the SDK. |
| docs/js/lib/identity.js | 1.0.0 | ✅ | Anonymous Firebase Auth + display name + optional 4-digit PIN claim for cross-device re-linking. Name stored at /players/{uid}. Claim at /nameclaims/{nameLower}. |
| docs/js/lib/leaderboard-data.js | 1.0.0 | ✅ | submitScore/topEntries/rankEntries (no DOM). Boards: gen1/gen2 × single/victoryroad/safari under /leaderboard/{gen}/{mode}. |
| docs/js/modes/leaderboard.js | 1.0.0 | ✅ | Browse screen: 6 tabs (gen × mode), top-10 per board, your rank highlighted, refresh button. **Enabled.** |
| database.rules.json | 1.0.0 | ✅ | Firebase Realtime DB security rules. players/nameclaims/leaderboard/rooms/draft all validated. Daily entries immutable once written. Throne writes validated. |
| docs/js/main.js | 1.3.0 | ✅ | Added lazy identity init + first-launch name-prompt toast. |

## Draft Battle (Phase 5 — DONE: 5a engine/data + 5b battle/throne/daily/share)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/lib/sim.js | vetted | ✅ | Verbatim copy of vetted sim.js (runMatch/simulateBattle/toRealStats/moveId). Do not edit. |
| docs/js/draft.js | 0.5.0 | ✅ | **Reworked (approved):** per-card commit — 2 picks/card, each sourced from the correct card; type-twice→mono; "—" pickable; weighted move reroll (with replacement). Imports ./sim.js. Lives at docs/js/draft.js (NOT lib/). |
| docs/js/lib/share.js | 1.1.0 | ✅ | **Created this pass.** centralDateParts/centralDateStr/centralPeriodKey (DST-correct via Intl America/Chicago), seedFromDate/seedFromString, buildSummaryText (🟩/⬜ meter), copyToClipboard, shareWhatsApp. |
| docs/js/modes/draftbattle.js | 1.5.0 | ✅ | **Phase 5b + engine-rework wiring.** Buffers UI picks and applies them via session.commitCard() (correct per-card sourcing). Type chips pickable when owned (→mono); Skip when stuck; dynamic pick prompt. Draft UI unchanged from 1.1.0; replaced the battle stub with: runMatch(N=501) playback (HP bars, play/step/skip, verdict), throne challenge+claim (Firebase, CT period reset, deterministic NPC champions), daily entry gate + all-pairs ranking + share. Imports CT/seed/share from lib/share.js. Headless: draft completes 400/400; battle deterministic; 20-player all-pairs ≈515ms; jsdom smoke (freeplay + daily, offline) passes. See KNOWN ISSUE re: 6×2. |
| docs/css/styles.css | 1.9.0 | ✅ | Section I (draft) + **Section J (5b): battle stage, HP bars, verdict banner, playback controls, spinner, offline notice, daily-results.** Note: two stale "Section I" header blocks exist from prior passes (older `.draft-stat-btn`/`.draft-queue` classes are unused by the current controller) — harmless, worth a cleanup later. |

## Guess modes (Phase 3 — IN PROGRESS)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/lib/pokeinfo.js | 1.0.0 | ✅ | Shared per-Pokémon info card HTML (Pokédex detail + guess post-game). |
| docs/js/lib/engine.js | 1.2.0 | ✅ | DOM-free `PokeGuessRound` + `normalizeName`. Faithful port of the canonical Gen 2 round logic (pools, availability/locks/exhaustion, rising+discounted costs, purchase limits, all clue-value specials, category diversity, weighted random reveal, guess+score). **One engine, both gens:** ids ≤26 are identical across gens (literal); moveset clues (ids 27-34 diverge) resolve by `special`/`field`. Tested headless vs real gen1 + gen2 data (26/27 assertions; the 1 was a bad test fixture, not a bug). |
| docs/js/modes/single.js | 1.1.0 | ✅ | Single-player on engine.js (config → game → summary). **1.1.0:** guards stale/missing clue-difficulty data with a message instead of a blank screen; main.js now also try/catches controllers. Tested under jsdom. **Enabled.** |
| docs/js/modes/pokedex.js | 1.0.0 | ✅ | Pokédex/study reference: searchable, sortable (#/A–Z) list; catch tracker (localStorage); detail view (info, type matchups, comp movesets, full move list). Reads movelist. Tested under jsdom (11 assertions). **Mode enabled.** |
| docs/js/modes/safari.js | 1.0.0 | ✅ | Safari Zone: shared budget across a shuffled pool; 2 free start clues (Generation + BST Range); bait (random reveal), run (skip), wrong −1; ends on 0 pts / pool exhausted; score = caught; catch tracker shared w/ Pokédex. Tested under jsdom (14 assertions). **Enabled.** |
| docs/js/modes/victoryroad.js | 1.0.0 | ✅ | Endless streak gauntlet: one guess per Pokémon, wrong = game over, 8 tiers reduce pre-revealed clues as streak grows (Tier 1: 12 clues → Tier 8: 3 clues). Perfect sweep overlay at 251. Tier slot IDs resolved by special/field so both gens work. Live timer. Tested (13 assertions). **Enabled.** |
| docs/js/modes/multiplayer.js | 1.0.0 | ✅ | Hot-seat multiplayer: 2–4 players, RTG/GTR modes, choose/random clues, clue exclusion panel, shared point pool, evo cross-inference deductions, round-end overlay with standings, podium + per-player stats, round history table. Tested (12 assertions in isolated JSDOM). **Enabled.** |

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

## Rules / docs / tests (Phase 6 — DONE this pass, except mp-rules)
| File | Version | Status | Notes |
|------|--------:|--------|-------|
| database.rules.json | 1.0.0 | ✅ | Validated; covers throne (extra mon/period allowed), daily seed read-only (client derives it), daily entries immutable & owner-only, leaderboard shape/bounds. Ship at repo root; paste into Firebase console. |
| README.md | 1.0.0 | ✅ | Run locally, run tests, regenerate data, deploy to Pages, full Firebase setup, silhouettes (`docs/img/silhouettes/<num>.png`), time/determinism notes. |
| tools/test/run.mjs (+ _harness) | 1.0.0 | ✅ | Zero-dep runner; `node tools/test/run.mjs`. |
| tools/test/sim.test.mjs | 1.0.0 | ✅ | toRealStats, moveId, determinism, win accounting (championWins/n), type immunity, stronger-mon-wins. |
| tools/test/draft.test.mjs | 1.0.0 | ✅ | 2-picks-from-correct-card, commitCard, type-twice→mono, "—" pick, 300-run completion w/ 0 mis-sourced, daily determinism, weighted move reroll, autoDraft. |
| tools/test/engine.test.mjs | 1.0.0 | ✅ | normalizeName (trim+lowercase only — punctuation must match), round setup, clue purchase deducts, wrong-guess cost, correct-guess score, gen pool filter. |
| docs/js/modes/race.js | 1.0.0 | ✅ | Parallel online Race (first to N solved). |
| docs/js/modes/online.js | 1.0.0 | ✅ | Online MP: Firebase rooms (6-char code), 2+ players, RTG/GTR, choose/random reveals, shared pool, 60s timed turns (leader-enforced), auto-advance ~5s after a win, verified results, podium. Answer never transmitted. |
| docs/js/lib/mp-rules.js | 1.0.0 | ✅ | Pure rules (SPEC §6): seedFor, buildEngine, applyReveals, revealOutcome, guessOutcome, nextTurnPos, weightedRandomClue, advanceAfterWin, champion, makeRoomCode. Ported from hot-seat; no DOM/Firebase. |
| tools/test/online.smoke.mjs | 1.0.0 | ✅ | Dev-only (jsdom) two-client integration: fake in-memory Firebase + controllable clock. Drives create→join→start→reveal-sync→wrong-guess turn-pass→verified correct guess→scoring→auto-advance→60s turn-skip. 25 assertions. Not in the zero-dep runner. |
| tools/test/mp-rules.test.mjs | 1.0.0 | ✅ | Seed determinism, room codes, seed→same-mystery, replay-identical clue values, reveal/guess outcomes, turn rotation, win advance, champion. |

**Suite result: 402 passed, 0 failed (`node tools/test/run.mjs`). Plus dev smokes (jsdom): online.smoke.mjs 25/25, smoke2.mjs 12/12.**

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
silhouette sprite assets at docs/img/silhouettes/<num>.png (keyed by Pokédex number; spriteId is null in the data so num is used), Firebase web config (Phase 4).

### Online MP v1 — scope notes (follow-ups for hot-seat parity)
- No per-clue **exclusion panel** yet (hot-seat lets you exclude clues from the random pool).
- No **evolution auto-deduction** yet (hot-seat auto-reveals deducible evo clues for free).
- Anti-cheat is **detect-and-flag** (verified): clients re-derive the mystery and show a banner on a result that doesn't check out. A serverless design can't *prevent* a tampered client from writing a score — only surface it.
- Reached from the menu **Online** tile (`#/online/<gen>`). Optional later: a "Play online" button inside hot-seat multiplayer.js.

### Future enhancements
- Google sign-in (optional): anon auth + name/PIN already covers cross-device; add only if real accounts are wanted.
