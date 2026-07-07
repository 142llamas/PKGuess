# PokéGuess Online — MANIFEST
_Last updated: 2026-07-05 · the authoritative CURRENT-STATE file inventory._
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
| docs/css/styles.css | 1.14.3 | ✅ | Sections A–P. Latest additions: profile pill/identity panel, Cycling Road v2, Team Mode. **#4:** `.clue-limit-note` rule. **#6:** Victory Road merged-chip styles. **#11:** `.lb-draft-links` row. **Host-disconnect resilience:** `.host-left-banner` (online.js + race.js). |
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
| docs/data/movestats-gen{1,2}.json | curated | ✅ | 244 moves (Gen 2), Gen 1 mirrors Gen 2. Base power/accuracy/type/category/PP/priority only — see sim.js below for where the actual move *effects* now live. **Fairy-type fix:** Charm and Sweet Kiss retagged Normal, Moonlight retagged Dark — their real pre-Gen-6 types (Fairy didn't exist in Gen 1/2; the data pipeline had inherited the modern retcon typing). Confirmed inert for simulator behavior (type-effectiveness is only ever consulted by the damage path, and all three are 0-bp status moves) — a pure data-accuracy fix. |
| docs/data/typechart-gen{1,2}.json | gen | ✅ | 17-type (Gen 2) / 15-type (Gen 1, derived) chart. No Fairy row — correct, since Fairy doesn't exist in Gen 1/2 (see movestats-gen{1,2}.json's entry above: the 3 moves that used to be mistagged Fairy are now retagged to their real historical types). |
| docs/data/draftpool-gen2.json | gen | ✅ | Draft-specific movepool overrides (e.g. Smeargle). |
| database.rules.json | 1.1.0 | ✅ | Firebase security rules. **#12/#13:** added `/draft/progress/{uid}` (own-uid-only write, numeric 0–5) backing the persisted Elite-4 unlock-progress fix. **⚠️ Needs to be re-deployed to the Firebase console — this repo copy is ahead of what's live until you re-paste it.** |

## Shared libraries (`docs/js/lib/`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| dom.js | 1.1.0 | ✅ | `el()`, `clear`, `statSpreadEl`, `genBar`. No global state. |
| engine.js | 1.3.1 | ✅ | `PokeGuessRound` — clue costs/reveals/guessing/scoring/difficulty locks, category diversity (Force-Different/Cycle-All), multi-use clue exhaustion. Shared by every guess mode + Cycling Road's clue sequencing. **#5:** added `SCORE_MULTIPLIERS` + `computeScoreMultiplier` — Single Player leaderboard scores stack a multiplier for harder settings (Forced Reveal, Random/By-category, stricter category diversity) on top of the difficulty points budget. |
| mp-rules.js | 1.4.0 | ✅ | Pure multiplayer rules: `seedFor`, `buildEngine`, `applyReveals`, `revealOutcome`, `guessOutcome`, `weightedRandomClue`, `champion`, `makeRoomCode`, `computeAutoDeducedIds`, `buildRevealSequence`, `makeRng`. **#8:** `computeAutoDeducedIds` fix (Can-Evolve-alone no longer leaks family size). **New:** `leaderUid(room)` — the single shared host-disconnect-resilience helper used by both online.js and race.js, extracted from online.js's own prior local implementation so the two controllers (identical room shape) can't drift apart on this. |
| firebase.js | 1.0.0 | ✅ | Lazy Firebase connection (`getFirebase()`). |
| identity.js | 1.1.0 | ✅ | Anonymous auth + display name + PIN claim/re-link. `checkNameClaim`/`getClaimStatus` added for collision-checked name changes. |
| identity-ui.js | 1.0.0 | ✅ | **New.** Profile pill + full identity panel (set/change name with collision check, PIN protect, re-link on a new device) — replaced the old one-shot first-load toast. |
| leaderboard-data.js | 1.0.0 | ✅ | submit/read/rank leaderboard entries. |
| catch-tracker.js | 1.0.0 | ✅ | **New.** Shared Seen/Caught store — single source of truth used by every guess mode (previously each mode duplicated its own localStorage logic, and Single/Hot-seat/Online didn't call it at all). |
| pokeinfo.js | 1.0.0 | ✅ | **New.** Shared Pokédex-detail-card HTML builder — one source of truth so the Pokédex and the guess-mode summary screen render a Pokémon's info identically. |
| share.js | 1.4.0 | ✅ | CT-aware date/period/seed helpers, summary-card text (`'daily'`/`'throne'`/`'gauntlet'` kinds), WhatsApp/clipboard share, the drafted-mon share-card infrastructure (#14/#15). **#1:** daily share text leads with `dailyChallengeLink()` and shows the player's name (`stablePlayerFallbackName` if unset) instead of the mon's name. |
| draft-adapter.js | 1.3.0 | ✅ | Thin re-export shim for the spec-locked `../draft.js` and `../sim.js` (see below) — lets mode controllers import them from `lib/` without editing the vetted originals. Re-exports now include `autoDraftScaled`, `resolveThroneCascade`, `TIER_RANK`, `isTierUnlocked`, `nextProgressRank`. |

## Guess modes (`docs/js/modes/`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| single.js | 1.2.2 | ✅ | Single Player. Category-mode + diversity support; catch-tracker wired in. **#2/#3:** corrected greyed-clue help text. **#5:** leaderboard score now applies `engine.js`'s multiplier stack; summary shows "raw × multiplier = final"; Custom stays unmultiplied and off the leaderboard. |
| pokedex.js | 1.1.0 | ✅ | Independent Seen/Caught filter toggles (union when both active, replacing the old exclusive radio); uses shared catch-tracker + pokeinfo. |
| safari.js | 1.2.0 | ✅ | Bait/rock reveal at normal cost, manual click costs double; catch-tracker wired in. |
| victoryroad.js | 1.3.0 | ✅ | Endless streak gauntlet, 8 tiers. **#6 (full tier rework):** every tier's threshold +1; habitat extended to Tier 2, First Anime to Tier 3; "Has an Immunity" added to Tiers 1–4 (ordered *before* the type slots — engine.js locks it once both types are known); combined weakness/resistance reveal added to Tiers 3–8 (`revealUpToCombined`, 6/5/4/3/2/1 total per tier); Highest/Lowest Base Stat (no value) added to Tier 7. Display: types/egg-moves/weakness-resistance each merged into one chip; a pre-existing exhaustion-sentinel display leak is now filtered everywhere. |
| multiplayer.js (hot-seat) | 1.3.2 | ✅ | RTG/GTR, Choose/Random/By-Category clue modes, real category diversity, clue-exclusion panel, evolution auto-deduction, catch-tracker wired in. **#9:** GTR's reveal step is exactly one mandatory clue, auto-advances after. **#7:** dropped the layout-dependent ↑ hint text. **Removed** the "Skip guess / go to reveal" button from GTR's guess phase (undermined the guess-first design). |
| online.js | 1.5.0 | ✅ | Full feature parity with hot-seat. **#19:** GTR's reveal step now advances the turn automatically after exactly one clue (previously stayed in 'reveal' indefinitely after a turn-expiry + wrong guess). **#7:** dropped the layout-dependent ↑ hint. **Removed** the "Skip guess → reveal" GTR button. **Host-disconnect resilience:** the Lobby "Start game" and post-game "Start rematch" buttons were still hard-gated on `room.hostUid===me.uid` (a known gap even here) — both now use `isLeader()` (shared via mp-rules.leaderUid), and a host-left banner tells every player when the original host has disconnected and who's taken over. `isHost()` removed (now unused). **Known gap:** clue cards use their own `.online-clue` CSS rather than hot-seat's `.clue-btn` styling. |
| leaderboard.js | 1.2.0 | ✅ | Leaderboard browse screen. **#11:** added Elite 4 Standings / Daily Challenge Results links at the top. |

## Cycling Road (`docs/js/modes/race.js`)

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| race.js | 2.2.0 | ✅ | **Host-disconnect resilience** (ported from online.js via the shared `mp-rules.leaderUid()` — this was a known, disclosed gap): every action previously gated on a hard `room.hostUid===me.uid` check (both lobbies' Start buttons, both post-game Start-rematch buttons, the turn-timeout/round-ending duties, the rematch-resolution trigger) now uses `isLeader()` instead; `room.hostUid` itself still identifies the original creator for the crown icon. Added a host-left banner (both lobbies, both game-over screens). **Found and fixed along the way:** `renderTeamGameOver()` was missing its own `bestByCol`/`worstByCol` declaration entirely — a `ReferenceError` the instant both teams' game-over screen tried to render, newly EXPOSED (not introduced) by the earlier #17 fix, which was the first time the shared cap-timer interval could actually reach team mode's own ending logic. **#17:** cap-timer interval dispatches team-aware vs. individual functions correctly (was hijacking the standings display in team games and denying the game-ending check a periodic self-heal chance). **#16.** Full rewrite from the ground up — predetermined per-mystery clue order, independent per-player advancement, persistent post-game lobby + opt-in rematch, Team Mode. |

## Draft Battle

| File | Version | Status | Notes |
|------|--------:|--------|-------|
| docs/js/draft.js | 0.8.0 | ✅ | **Lives at `docs/js/`, not `docs/js/lib/`** — spec-locked "vetted" file; other modules import it via `draft-adapter.js`. `DraftSession`/`autoDraft`/`buildSpeciesList`/`buildLearnsetMap` unchanged in behavior. `autoDraftScaled`, `resolveThroneCascade` + `TIER_RANK`, banned-move filtering as before. **New (#12/#13):** `isTierUnlocked` + `nextProgressRank` — the Elite-4 unlock gate is now based on a persisted, monotonic "highest tier ever reached" value instead of "do you currently hold the previous throne," which the one-throne cascade (#14a) and every tier's own cadence reset both legitimately (and wrongly) used to relock. |
| docs/js/sim.js | 2.2.0 | ✅ | **Lives at `docs/js/`, not `docs/js/lib/`.** Real per-move effects via `MOVE_EFFECTS` (recoil, drain, self-heal, status, confusion, stat boosts, OHKO, high-crit, fixed/HP-based damage), multi-hit, two-turn/recharge moves, and move-specific special cases (Curse, Belly Drum, Rest, Pain Split, Leech Seed, Jump Kick crash). Fixed OHKO moves being completely non-functional (bp:0 skipped the damage-dispatch check entirely). **Move-accuracy pass:** Magnitude now rolls the real 4–10 power table every use (`MAGNITUDE_TABLE`/`rollMagnitude`, was a flat bp:75) — needs no external stat so it's fully accurate; Tri Attack's secondary proc now picks randomly among paralysis/burn/freeze (`secondary.status` can be an array), was always paralysis; Charm was found to have NO effect implemented at all (a silent no-op) while investigating the Fairy-type fix — added its real -2 Attack drop. Return/Frustration deliberately left at flat power — their real formulas are friendship-based and no friendship stat exists anywhere in this draft context, so inventing one would be an arbitrary guess, not genuine accuracy. Jump Kick/High Jump Kick crash left at 1/8 max HP — no more-confident Gen-2-specific figure found to replace it with. |
| docs/js/lib/draft-adapter.js | 1.3.0 | ✅ | See "Shared libraries" above. |
| docs/js/modes/draftbattle.js | 1.12.1 | ✅ | Draft UI → draft card → Elite-4 gauntlet → daily → share. **#14/#15:** consolidated Elite-4 gauntlet, canvas share card, non-gating progress badge. **#10:** daily-results date-override fix. **#1:** daily Share passes `playerName`/`dailyChallengeLink()` into `buildSummaryText`. |

## Tests (`tools/test/`)

| File | Covers |
|------|--------|
| run.mjs | Zero-dep test runner — `node tools/test/run.mjs` runs every `*.test.mjs` suite below (696 assertions total as of this writing). **Fixed:** `sim-status.test.mjs` had been written but never registered here — none of its assertions (burn/poison/paralysis/confusion/stat-stage verification) had ever actually run as part of `npm test`; now registered. |
| sim.test.mjs | Stat conversion, moveId, recoil/drain/multi-hit/two-turn/recharge/OHKO/high-crit/fixed-damage/guaranteed-status/Curse/Belly Drum/Rest/Pain Split/Leech Seed/Jump Kick crash — the full #6 move-mechanics rework. |
| sim-status.test.mjs | Deep, exact-value verification of status effects and stat stages (burn/poison/toxic chip math, paralysis speed/full-para rate, freeze thaw rate, confusion self-hit rate, stat-boost deltas and clamping), plus the move-accuracy pass: Charm's -2 Attack (was a no-op), Magnitude rolling multiple distinct levels across many uses (proves it's a real roll), Tri Attack's proc producing more than one distinct status (proves it's randomized). Now actually registered in `run.mjs` (see its entry above). |
| draft.test.mjs | Two-picks-from-correct-card, commitCard, type-twice→mono, "—" pick, full-completion with 0 mis-sourced picks, daily determinism, weighted move reroll, autoDraft, the banned-move list, `autoDraftScaled`'s target-band convergence, `resolveThroneCascade`'s full decision matrix, **`isTierUnlocked`/`nextProgressRank` (#12/#13)**. |
| engine.test.mjs | normalizeName, round setup, clue purchase/cost, wrong-guess cost, correct-guess score, gen pool filter, **`computeScoreMultiplier` (#5) — every axis, the full stack, Custom returning null.** |
| mp-rules.test.mjs | Seed determinism, room codes, replay-identical clue values, reveal/guess outcomes, turn rotation, champion, `buildRevealSequence`, `computeAutoDeducedIds` #8, **`leaderUid` (original host connected, fallback to earliest-joined-still-connected, joinOrder vs Object.keys ordering, never-null-for-a-real-room, null-safe on a missing room).** |
| identity.test.mjs | Name claim, cross-device reclaim, wrong-PIN rejection. |
| catch-tracker.test.mjs | Basic get/mark, caught-implies-seen (never downgrades), case-insensitivity, manual override incl. clearing an entry. |
| modes.smoke.mjs | jsdom render smoke for every guess mode; Pokédex combo-filter (17 assertions); Single Player's win/loss catch-tracking; **#5 deterministic-win multiplier breakdown**; **#11 (Leaderboard's Elite 4 Standings / Daily Challenge Results links navigate correctly).** |
| online.smoke.mjs | Two-client fake-Firebase integration: create→join→start→reveal-sync→scoring→auto-advance→turn-skip, By-Category/diversity/exclusion parity, **#8 evo-deduction non-leak**, rematch flow (success + "nobody opted in" + leader-resilience), **#19 (GTR after a turn-expiry: exactly one reveal, no skip, then auto-advance)**. |
| cluemode.smoke.mjs | Single Player's Random/By-Category/diversity-blocked card states + **#4 (clue-limit-note class↔CSS-rule binding)**. |
| mp-cluemode.smoke.mjs | Hot-seat's Random/By-Category/diversity-blocked card states + the multi-use clue re-offer fix (now driven via RTG turn-cycling instead of the old GTR-stays-in-reveal exploit, since #9 fixed that), **#9 (GTR: exactly one reveal, no skip, auto-advance)**. |
| identity-ui.smoke.mjs | Profile pill + identity panel (name change, PIN protect, re-link, collision blocking). |
| race.smoke.mjs | Cycling Road individual mode end-to-end: predetermined sync, independent pacing + toasts, room cap, time cap, results/splits, both rematch outcomes, early exit, **#16**, **#18 investigation (could not reproduce; see CHANGE_TRACKER)**, **host-disconnect resilience (lobby Start button, banner, mid-game time-cap duty, all with the original host disconnected)**. Fake Firebase's reentrancy guard now queues a nested notification instead of silently dropping it (matches real Firebase's eventual consistency). |
| race-teams.smoke.mjs | Team Mode end-to-end: room creation, both team-assignment paths, the answerer gate + rotation, cross-team-only toasts, dual-team completion, results, all-opt-in rematch, **#17**, **host-disconnect resilience (team-builder lobby taken over by a fallback leader, banner, mid-game time-cap duty)**. Same reentrancy-queueing fake-Firebase fix as race.smoke.mjs. |
| victoryroad.smoke.mjs | **New.** #6's full tier rework driven through the real UI with a deterministic shuffle (`rng:()=>0`): Tier 1→2 boundary exactly at streak 5/6 (the "+1" bump), "Has an Immunity" pre-revealed in Tier 1 (proves the immunity-before-types ordering fix), the merged Type/Egg-Move/Type-Matchups chips, no exhaustion-sentinel leaks, and reaching Tier 3 (streak 11) to confirm the combined weakness/resistance reveal. |
| throne.smoke.mjs | **New.** Drives the real Elite-4 **gauntlet** end-to-end (#14/#15) against a real fake Firebase via `draftbattle.js`'s test-injection hooks: one-click Will→All-Time climb, per-row "Watch" replay + return to results, one Claim, one Share (incl. the canvas-share graceful-degrade path in a no-canvas test environment) — plus the "🏅 Your best" progress badge surviving the #14a cascade AND a simulated cadence reset (#12/#13), `claimThrone`'s write-verification catching a silently-failed write, and the daily "already done today" gate's View Results button showing today (#10). |
| share.test.mjs | **New.** CT date/period/seed helpers; `buildSummaryText`'s new `'gauntlet'` kind + existing kinds unaffected; `typeColor`/`typeTextColor` spot-checked against the literal styles.css values; `buildMonCardPlan`'s pure layout data; `drawMonCardToCanvas` verified against a recording fake 2D context (jsdom has no real canvas 2D, and this project avoids a canvas-polyfill dependency); `draftBattleLink`'s graceful no-`location` fallback. |

**Dev-only standalone smoke script** (not part of `run.mjs`; exercises the full Draft Battle / daily UI with a fake offline Firebase): `smoke-daily.mjs` — also verifies the Yesterday/Today results round-trip. **Note:** earlier notes here also referenced `smoke.mjs`/`smoke2.mjs`, but neither exists in the current repo (checked directly) — that reference was already stale before this session; `throne.smoke.mjs` now covers the full Draft Battle/Elite-4 flow those were described as testing.

## Rules, docs, config

| File | Status | Notes |
|------|--------|-------|
| database.rules.json | ✅ | See "Data pipeline" above. |
| README.md | ✅ | Rewritten: intro paragraph now covers Cycling Road (incl. Team Mode + host-disconnect resilience) and the Elite-4 gauntlet / real move mechanics; repository layout tree updated to every current file; testing section documents both `npm test` and `npm run test:smoke` accurately. |
| CHANGE_TRACKER_v3.md | ✅ | The authoritative decision history — start here in any new chat. |
| TESTING_CHECKLIST.md | ✅ | Hands-on QA checklist, updated for: Victory Road's #6 tier rework, GTR's single-mandatory-reveal fix (both hot-seat and online) and skip-button removal, host-disconnect resilience (online + both Cycling Road modes), Leaderboard's draft links, the daily share-link format, the Elite-4 gauntlet flow (Section 9 fully rewritten — was still describing the old per-tier challenge flow), Magnitude/Tri Attack/Charm move fixes, and the Fairy-type removal. |
| NEW_CHAT_GUIDE.md | ✅ | How to hand off to a fresh chat without losing context. |

---

## Known, disclosed gaps (not oversights — intentionally scoped out and documented)
- Online's clue cards don't visually match hot-seat's card styling yet (behavior is identical).
- Return/Frustration use flat listed power rather than a real friendship-based formula — no friendship stat exists anywhere in this draft context to compute one from.
- Jump Kick/High Jump Kick's crash damage (1/8 max HP) is an estimate — no more Gen-2-specific figure found with higher confidence.
- Silhouette sprite assets (`docs/img/silhouettes/<num>.png`) were still owed by the user as of the original Phase 5 notes — the app degrades gracefully without them, but if they were never supplied, Pokédex/Draft silhouettes are still blank.
