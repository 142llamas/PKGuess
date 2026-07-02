# PokéGuess Online — MANIFEST
_Last updated: 2026-07-02 · the authoritative CURRENT-STATE file inventory._
_For the history of **why** each change was made, see `CHANGE_TRACKER_v3.md` — this file is just a snapshot of what exists right now, verified directly against the actual file headers._

Per SPEC principle 1, every code file carries a header (`@file`, `@version`,
`@updated`, `@changelog`); versions live in files, never in filenames. This
table is the index. Status: ✅ done & tested · 🟡 in progress · ⬜ not started.

---

## App shell

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/index.html | 1.0.0 | ✅ | Loads fonts + styles.css + main.js (module). Relative paths for Pages subpath. |
| docs/.nojekyll | — | ✅ | Empty; keeps Pages from stripping `js/`-prefixed paths. |
| docs/css/styles.css | 1.14.0 | ✅ | Sections A–P. Latest additions: profile pill/identity panel, Cycling Road v2 (toasts, splits, rematch countdown), Team Mode. |
| docs/js/main.js | 1.4.0 | ✅ | Config load, menu render, hash router, lazy launch. Profile pill wiring (identity-ui.js) replaced the old one-shot name toast. |
| docs/js/modes.js | 1.8.0 | ✅ | Mode registry. Cycling Road blurb updated for the v2 (synced-timer) mechanic. |

## Data pipeline & data
_Unchanged since Phase 2 — not touched in the most recent rounds of work._

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| tools/generate-data.mjs | 1.0.0 | ✅ | Excel → data/*.json. |
| docs/data/config.json | 1.0.0 | ✅ | App shell config: title, gens, genLabels, mpDefaults, modes list. |
| docs/data/gen1.json / gen2.json | gen | ✅ | 151 / 251 mons + clues/categories/difficulties/multiClue. |
| docs/data/movelist-gen{1,2}.json | gen | ✅ | Full real-move learnsets (used by the guess game's moveset clues). |
| docs/data/movestats-gen{1,2}.json | curated | ✅ | 244 moves (Gen 2), Gen 1 mirrors Gen 2. Base power/accuracy/type/category/PP/priority only — see sim.js below for where the actual move *effects* now live. |
| docs/data/typechart-gen{1,2}.json | gen | ✅ | 17-type (Gen 2) / 15-type (Gen 1, derived) chart. **Known quirk (found, not fixed):** no Fairy row exists — a few moves (Charm, Sweet Kiss, Moonlight) are tagged Fairy-type by the data pipeline (a modern-gen retcon) and resolve as neutral-effectiveness as a result. Their non-damage effects are still correct; this is a data-generation issue, not a move-effects issue. |
| docs/data/draftpool-gen2.json | gen | ✅ | Draft-specific movepool overrides (e.g. Smeargle). |
| database.rules.json | 1.0.0 | ✅ | Firebase security rules. Collection-level `.read` fix for throne/daily-entries (was child-level only, which silently broke "offline"-looking throne/daily reads) — this is the version currently live; re-paste into the Firebase console if you haven't already. |

## Shared libraries (`docs/js/lib/`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| dom.js | 1.1.0 | ✅ | `el()`, `clear`, `statSpreadEl`, `genBar`. No global state. |
| engine.js | 1.3.0 | ✅ | `PokeGuessRound` — clue costs/reveals/guessing/scoring/difficulty locks, category diversity (Force-Different/Cycle-All), multi-use clue exhaustion. Shared by every guess mode + Cycling Road's clue sequencing. |
| mp-rules.js | 1.3.0 | ✅ | Pure multiplayer rules: `seedFor`, `buildEngine` (now accepts clueMode/catDiversity), `applyReveals`, `revealOutcome`, `guessOutcome`, `weightedRandomClue`, `champion`, `makeRoomCode`, `computeAutoDeducedIds` (evolution auto-deduction — single source of truth for hot-seat + online), `buildRevealSequence` (Cycling Road's predetermined, points-free clue ordering), `makeRng`. |
| firebase.js | 1.0.0 | ✅ | Lazy Firebase connection (`getFirebase()`). |
| identity.js | 1.1.0 | ✅ | Anonymous auth + display name + PIN claim/re-link. `checkNameClaim`/`getClaimStatus` added for collision-checked name changes. |
| identity-ui.js | 1.0.0 | ✅ | **New.** Profile pill + full identity panel (set/change name with collision check, PIN protect, re-link on a new device) — replaced the old one-shot first-load toast. |
| leaderboard-data.js | 1.0.0 | ✅ | submit/read/rank leaderboard entries. |
| catch-tracker.js | 1.0.0 | ✅ | **New.** Shared Seen/Caught store — single source of truth used by every guess mode (previously each mode duplicated its own localStorage logic, and Single/Hot-seat/Online didn't call it at all). |
| pokeinfo.js | 1.0.0 | ✅ | **New.** Shared Pokédex-detail-card HTML builder — one source of truth so the Pokédex and the guess-mode summary screen render a Pokémon's info identically. |
| share.js | 1.2.0 | ✅ | CT-aware date/period/seed helpers, summary-card text, WhatsApp/clipboard share. |
| draft-adapter.js | 1.2.0 | ✅ | Thin re-export shim for the spec-locked `../draft.js` and `../sim.js` (see below) — lets mode controllers import them from `lib/` without editing the vetted originals. Re-exports now include `autoDraftScaled`, `resolveThroneCascade`, `TIER_RANK`. |

## Guess modes (`docs/js/modes/`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| single.js | 1.2.0 | ✅ | Single Player. Category-mode + diversity support; catch-tracker wired in (correct guess → Caught, out of points via any path → Seen). |
| pokedex.js | 1.1.0 | ✅ | Independent Seen/Caught filter toggles (union when both active, replacing the old exclusive radio); uses shared catch-tracker + pokeinfo. |
| safari.js | 1.2.0 | ✅ | Bait/rock reveal at normal cost, manual click costs double; catch-tracker wired in. |
| victoryroad.js | 1.2.0 | ✅ | Endless streak gauntlet, 8 tiers. |
| multiplayer.js (hot-seat) | 1.3.0 | ✅ | RTG/GTR, Choose/Random/By-Category clue modes, real category diversity, clue-exclusion panel, evolution auto-deduction (via the shared mp-rules helper), catch-tracker wired in. Fixed: multi-use clues (e.g. Reveal One Weakness) were being permanently dropped from the random/category pool after one use instead of respecting their real cap. |
| online.js | 1.4.0 | ✅ | Full feature parity with hot-seat: By-Category clue mode, real diversity, exclusion panel, evolution auto-deduction (same fix as above applied here too), catch-tracker wired in. Persistent post-game lobby + opt-in rematch with a host-triggered 5s countdown (leader-driven, resilient to host disconnect), replacing the old immediate one-click "Play again" that also never reset scores. **Known gap:** clue cards use their own `.online-clue` CSS rather than hot-seat's `.clue-btn` styling — behavior is identical, appearance isn't pixel-matched yet. |
| leaderboard.js | 1.1.0 | ✅ | Leaderboard browse screen. |

## Cycling Road (`docs/js/modes/race.js`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| race.js | 2.1.0 | ✅ | **Full rewrite from the ground up** — no longer "buy clues, first to target wins." Predetermined per-mystery clue order (same for every player, seeded from the room); first clue shows immediately, one more every 5s. Independent per-player advancement with live standings + "advanced to round N" toasts. Rooms hold up to 12; ends once every active player finishes or a time cap (target × 2 min) hits; warned early exit. Results ranked by total time with per-mystery fastest/slowest split highlighting. Persistent post-game lobby + opt-in rematch (5s countdown). **Team Mode** (`settings.teams`): a team-builder lobby (manual assign + Randomize Teams, even/n±1 split), one shared position per team with a rotating single answerer, team standings/results, rematch requires *every* connected player opted in. **Known gap:** doesn't yet have online.js's host-disconnect resilience (`isLeader()` fallback) — uses a hard host check instead. |

## Draft Battle

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/draft.js | 0.7.0 | ✅ | **Lives at `docs/js/`, not `docs/js/lib/`** — spec-locked "vetted" file; other modules import it via `draft-adapter.js`. `DraftSession`/`autoDraft`/`buildSpeciesList`/`buildLearnsetMap` unchanged in behavior. New: `autoDraftScaled` (rejection-samples to a target base-stat-total band — Elite 4 scaling), `resolveThroneCascade` + `TIER_RANK` (pure decision logic for the one-Pokémon-one-throne rule), and `buildLearnsetMap` now excludes the 30 banned draft moves (Attract, Self-Destruct, Baton Pass, etc. — full list in `TESTING_CHECKLIST.md`). |
| docs/js/sim.js | 2.1.0 | ✅ | **Lives at `docs/js/`, not `docs/js/lib/`.** Major rewrite: real per-move effects (recoil, drain, self-heal, guaranteed/secondary status, confusion, stat boosts, OHKO, high-crit, fixed/HP-based damage) via a new `MOVE_EFFECTS` table — previously every move fell through to plain damage or a no-op regardless of what the engine's own machinery could do. New engine capability: multi-hit moves (real 3/8·3/8·1/8·1/8 split), two-turn charge moves (Fly/Dig with genuine semi-invulnerability, Solarbeam/Razor Wind/Skull Bash), recharge (Hyper Beam). Specially-cased: Curse (different move entirely for Ghost vs. non-Ghost users), Belly Drum, Rest, Pain Split, Leech Seed, Jump Kick/High Jump Kick crash-on-miss. **Fixed a real, significant bug:** OHKO moves (Guillotine/Horn Drill/Fissure) were completely non-functional — `bp:0` in the base data meant the damage-dispatch code never even checked `move.ohko`. Disclosed simplifications: Magnitude/Return/Frustration use flat listed power (no friendship stat exists here); Tri Attack always picks paralysis on proc instead of randomizing burn/freeze/paralysis; Jump Kick's crash damage (1/8 max HP) is an estimate. |
| docs/js/lib/draft-adapter.js | 1.2.0 | ✅ | See "Shared libraries" above. |
| docs/js/modes/draftbattle.js | 1.10.0 | ✅ | Draft UI → battle playback → throne → daily → share. Battle-log playback now narrates every event sim.js 2.0+ introduced (charge, recharge, multi-hit, curse, belly drum, rest, pain split, leech seed, crash, stat boosts, confusion ending) — these were silently dropped by the renderer before, so a correctly-computed effect could show nothing happening on screen. Elite 4 NPCs scale to a target base-stat-total band per tier (Will 425–450, Koga 475–500, Bruno 525–550, Lance 575–600; All-Time intentionally left unscaled). One-Pokémon-one-throne enforced: claiming a higher throne while holding a lower one keeps the higher, and bumps the just-defeated holder down to the vacated lower throne if they were human (or leaves it to a fresh NPC if not). Daily results has a "See Yesterday's Results" button (Central-Time date math) with a way back to today. "Battle the leader" removed (all-pairs ranking is automatic). Elite-4 labels, one-throne history formatting, locked-stage hardening all still in place from earlier passes. |

## Tests (`tools/test/`)

| File | Covers |
|------|--------|
| run.mjs | Zero-dep test runner — `node tools/test/run.mjs` runs every `*.test.mjs` suite below (580 assertions total as of this writing). |
| sim.test.mjs | Stat conversion, moveId, recoil/drain/multi-hit/two-turn/recharge/OHKO/high-crit/fixed-damage/guaranteed-status/Curse/Belly Drum/Rest/Pain Split/Leech Seed/Jump Kick crash — the full #6 move-mechanics rework. |
| sim-status.test.mjs | **New.** Deep, exact-value verification of status effects and stat stages specifically (burn/poison/toxic chip math, paralysis speed/full-para rate, freeze thaw rate, confusion self-hit rate, stat-boost deltas and clamping) — requested explicitly as a dedicated check beyond sim.test.mjs's broader coverage. |
| draft.test.mjs | Two-picks-from-correct-card, commitCard, type-twice→mono, "—" pick, full-completion with 0 mis-sourced picks, daily determinism, weighted move reroll, autoDraft, the banned-move list, `autoDraftScaled`'s target-band convergence, `resolveThroneCascade`'s full decision matrix. |
| engine.test.mjs | normalizeName, round setup, clue purchase/cost, wrong-guess cost, correct-guess score, gen pool filter. |
| mp-rules.test.mjs | Seed determinism, room codes, replay-identical clue values, reveal/guess outcomes, turn rotation, champion, `buildRevealSequence` determinism + the example-moveset repeat cap. |
| identity.test.mjs | Name claim, cross-device reclaim, wrong-PIN rejection. |
| catch-tracker.test.mjs | Basic get/mark, caught-implies-seen (never downgrades), case-insensitivity, manual override incl. clearing an entry. |
| modes.smoke.mjs | jsdom render smoke for every guess mode; Pokédex combo-filter (17 assertions); Single Player's win/loss catch-tracking. |
| online.smoke.mjs | Two-client fake-Firebase integration: create→join→start→reveal-sync→scoring→auto-advance→turn-skip, By-Category/diversity/exclusion/evo-deduction parity, rematch flow (success + "nobody opted in" + leader-resilience). |
| cluemode.smoke.mjs | Single Player's Random/By-Category/diversity-blocked card states. |
| mp-cluemode.smoke.mjs | Hot-seat's Random/By-Category/diversity-blocked card states + the multi-use clue re-offer fix. |
| identity-ui.smoke.mjs | Profile pill + identity panel (name change, PIN protect, re-link, collision blocking). |
| race.smoke.mjs | Cycling Road individual mode end-to-end: predetermined sync, independent pacing + toasts, room cap, time cap, results/splits, both rematch outcomes, early exit. Uses a virtual clock + per-client JSDOM windows (documented workaround for a jsdom quirk with duplicate ids across simulated clients). |
| race-teams.smoke.mjs | Team Mode end-to-end: room creation, both team-assignment paths, the answerer gate + rotation, cross-team-only toasts, dual-team completion, results, all-opt-in rematch. |

**Dev-only standalone smoke scripts** (not part of `run.mjs`; exercise the full Draft Battle / daily UI with a fake offline Firebase):
`smoke.mjs`, `smoke2.mjs`, `smoke-daily.mjs` — the latter now also verifies the Yesterday/Today results round-trip.

## Rules, docs, config

| File | Status | Notes |
|------|--------|-------|
| database.rules.json | ✅ | See "Data pipeline" above. |
| README.md | 🟡 | Last substantively updated early in the project — still accurate on setup/deploy basics, but doesn't mention Cycling Road, Teams, or the battle simulator rework. Not blocking; update opportunistically. |
| CHANGE_TRACKER_v3.md | ✅ | The authoritative decision history — start here in any new chat. |
| TESTING_CHECKLIST.md | ✅ | Hands-on QA checklist covering every feature through this manifest's date. |
| NEW_CHAT_GUIDE.md | ✅ | How to hand off to a fresh chat without losing context. |

---

## Known, disclosed gaps (not oversights — intentionally scoped out and documented)
- Online's clue cards don't visually match hot-seat's card styling yet (behavior is identical).
- `race.js` doesn't have online.js's `isLeader()` host-disconnect resilience.
- A handful of move mechanics use disclosed simplifications (see sim.js's entry above).
- The Fairy-type data-tagging quirk on Charm/Sweet Kiss/Moonlight (see "Data pipeline" above).
- Silhouette sprite assets (`docs/img/silhouettes/<num>.png`) were still owed by the user as of the original Phase 5 notes — the app degrades gracefully without them, but if they were never supplied, Pokédex/Draft silhouettes are still blank.
