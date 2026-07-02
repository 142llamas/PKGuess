# Change Tracker — 18-item round (post-testing feedback)

Status: ✅ done · 🔜 planned (phase noted) · ⏳ in progress

## Phase 1 — quick fixes (DONE)
| # | Item | Status | Files |
|---|------|--------|-------|
| 1a | Rename Race → "Cycling Road" (labels only; rework in Phase 3) | ✅ | `modes.js`, `modes/race.js` |
| 5 | E4 stage lock hardened (locked button truly inert) | ✅* | `modes/draftbattle.js` |
| 8 | Removed "Battle the leader" from daily draft | ✅ | `modes/draftbattle.js` |
| 12 | Safari: bait/rock at normal cost (no discount); choosing a clue costs **double**; new help text | ✅ | `modes/safari.js` |
| 14b | Cards say "1 – Will / 2 – Koga / 3 – Bruno / 4 – Lance / All Time – Champion" | ✅ | `modes/draftbattle.js` |
| 14c | Challenge/history screen: "Elite 4 – Stage x" / "Greatest Pokémon of All Time" | ✅ | `modes/draftbattle.js` |
| 14d | "Player's" → screen name; default "Player" | ✅ | `modes/draftbattle.js` |
| 14e | Share: "I challenged X and won/lost with my Y"; no "-build", no "Player's" | ✅ | `lib/share.js` |
| 14f | History row: "Gastly – Ice/Grass – 35/55/65/35/100/125" | ✅ | `modes/draftbattle.js` |
| 18 | Mobile: draft Confirm button right-aligned | ✅ | `css/styles.css` |

*#5: the locked challenge button is now fully inert (disabled + no handler + pointer-events:none). The deeper "one Pokémon = one throne" cascade is #14a (Phase 4); if the lock misbehaves again after that, it'll be because of the cascade model, which #14a rebuilds.

## Phase 2 — guess-mode correctness (IN PROGRESS)

### Done this batch

| Location | Files | Items |
|---|---|---|
| `docs/js/lib/` | `engine.js` (1.3.0), `mp-rules.js` (1.1.0) | #10, #11, #13, #15b, #15c |
| `docs/js/modes/` | `single.js` (1.1.0), `multiplayer.js` (1.1.0) | #10, #11, #13, #15b, #15c |
| `docs/js/modes/` | `online.js` (1.1.0), `safari.js` (1.1.0), `victoryroad.js` (1.2.0) | #13 only |
| `docs/css/` | `styles.css` (1.11.0) | #10, #11, #15b |
| `tools/test/` | `engine.test.mjs`, `online.smoke.mjs` (updated), **`cluemode.smoke.mjs`** (new), **`mp-cluemode.smoke.mjs`** (new) | test coverage |

**#13 — Gen 2 mode was silently Johto-only almost everywhere.** Root cause: a `poolFilter` mapping (`data.id==='gen2' → 'gen2'`) was duplicated across 5 files, and the engine's own `'gen2'` primitive means #152-251 *only* — so every mode except the Pokédex was quietly excluding Kanto Pokémon from "Gen 2" games. Fixed with one shared primitive (`poolFilterForData`/`matchesPool` in `engine.js`) that every controller now calls, instead of each re-deriving its own mapping — the bug class (two meanings drifting apart) can't recur. Verified with a 60-trial engine test proving both Kanto and Johto mons actually appear. Also dropped online's now-redundant "Both" generation option (Gen II already means the full dex everywhere else).

**#10/#11/#15b/#15c — Clue selection & category diversity, done properly, not patched.** These turned out to be one connected engine gap, not four separate bugs:
- Manual "Choose" clicks always bypassed the Cycle-All diversity rule (only Force-Different was ever enforced on manual reveals; Cycle-All only worked inside the random-reveal algorithm). Added one shared predicate (`categoryDiversityBlocked`) used by manual reveals, the weighted-random reveal, AND the new by-category reveal — enforcement and the on-screen "blocked" display can no longer drift apart.
- Added `autoRevealFromCategory()` — the missing "By category" mechanic (click a category header, get a random clue from it; individual clues are never directly pickable).
- **Random** and **By-category** clue cards are now genuinely read-only (no click handler at all, not just visually dimmed) in both Single Player and Hotseat — clicking one does nothing, exactly per spec.
- Hotseat additionally never had a working Category-Diversity setting at all — `catDiversity` was collected in the setup form but never passed to the round, so Force-Different/Cycle-All were silent no-ops in multiplayer regardless of clue mode. Fixed, and added the missing "By category" option to hotseat's setup to match Single Player.
- A UI reveal-button/header can never fire during the player's forced *guess* turn (a real gap the old code had — the auto-reveal methods bypass the phase check by design for their one legitimate internal use, so I added an explicit `respectForcedPhase` flag rather than leaving that door open).
- Verified with 49 new real-DOM click-driven assertions across the two new smoke files (not just engine unit tests) — Choose still works, Random/By-category cards are unclickable, the dedicated controls work, Force-Different and Cycle-All are both enforced and visibly blocked with a reason.

**Known pre-existing gap, not introduced by this batch:** hotseat's random/by-category reveal pools (`revealRandom`/`revealFromCategory`) never re-offer an already-revealed multi-use clue (e.g. a 2nd "Reveal One Weakness"). This inherits an existing limitation in `revealRandom`'s filter that predates this work; flagging it rather than quietly fixing it since it wasn't in scope and touching it risked unrelated behavior change.

### Still pending
#16 name+PIN identity, #17 catch mechanic + Pokédex Seen/Caught combo filter.
**Deferred to Phase 3 (online/hotseat parity work):** extending Random/By-category read-only cards + a real Category-Diversity setting to `online.js` — it already shares the same engine primitives, so this will be low-risk once Phase 3 unifies the two controllers.

## Phase 2 continued — #16 identity + #17 catch mechanic (DONE)

| Location | Files | Items |
|---|---|---|
| `docs/js/lib/` | `identity.js` (1.1.0), **`identity-ui.js`** (new), **`catch-tracker.js`** (new) | #16, #17 |
| `docs/js/` | `main.js` (1.4.0) | #16 |
| `docs/js/modes/` | `safari.js` (1.2.0), `pokedex.js` (1.1.0), `single.js` (1.2.0), `multiplayer.js` (1.2.0), `online.js` (1.2.0) | #17 |
| `docs/css/` | `styles.css` (1.12.0) | #16 |
| `tools/test/` | `identity.test.mjs` (new), `identity-ui.smoke.mjs` (new), `catch-tracker.test.mjs` (new), `run.mjs` (now async-capable), `mp-cluemode.smoke.mjs`, `modes.smoke.mjs` | test coverage |

**#16 — there was no PIN option anywhere, and duplicate names were never checked.** The backend (`claimName`/`reclaimName`/PIN hashing) already existed but was **completely unused** — the only identity UI in the whole app was a one-shot toast on first load that called a bare, uncheck-able `setName()`. Fixed properly:
- A persistent **profile pill** in the header (not a toast that vanishes forever once dismissed) opens a real panel at any time: set/change your name, protect it with a PIN, or re-link a claimed name on a new device.
- Setting a name now checks `/nameclaims` first — a name already claimed by someone else is blocked with a clear message instead of silently allowed.
- Added `checkNameClaim()`/`getClaimStatus()` to `identity.js`, plus a test-only Firebase-override hook so this could be verified against real collision logic (not just eyeballed) — **19 unit tests** (name claim, cross-device reclaim, wrong-PIN rejection) + **12 real-DOM panel tests**.

**#17 — the catch mechanic was silently missing everywhere except Safari.** Root cause: `single.js` and `multiplayer.js` never called the catch tracker **at all**; `online.js` didn't either. Fixed with one shared module (`catch-tracker.js`, same storage key — no existing player data lost) wired into every guess mode:
- **Single Player**: correct guess → Caught; out of points (via *any* path — a guess, a card click, or a random/category reveal) → Seen, via one centralized `checkGameOver()` so this can't be missed again in a new code path.
- **Hotseat**: a round's winner marks it Caught (shared device/tracker, by design); quitting mid-round marks it Seen.
- **Online**: each player's own device marks Caught (if they won) or Seen (everyone else) when a round resolves, or Seen if they leave mid-round.
- **Pokédex filter rework**: Seen and Caught are now independent toggles — Caught alone and Seen alone behave exactly as before (unchanged), but selecting **both** now shows the union (#17a), matching "Caught is a subset of Seen." Verified with a dedicated 17-assertion DOM test seeding known catch data and clicking every toggle combination.

**Flagged finding, now fixed:** hotseat's Random/By-category reveal pools were permanently dropping a multi-use clue (e.g. "Reveal One Weakness", 6 uses) after its very first reveal, instead of respecting its real cap — the same bug class as the Cycle-All gap from the earlier batch. Also fixed the clue-card display, which only ever showed a multi-use clue's *latest* value (never its full per-use history) — both now match `single.js`'s established pattern. Proved with a deterministic test (a fixed `rng()=>0` walks the candidate pool in a predictable order) that a multi-use clue survives being picked multiple times before its real exhaustion point.

**Full test tally this session:** 473 unit tests (suite) + 29 mode-render + 25 online + 11 race + 19 single-cluemode + 33 mp-cluemode + 12 identity-ui = **602 assertions**, all green, plus both draft smokes.


## Phase 3 — Cycling Road rework + online parity (PLANNED)
#1 full rework (predetermined clue order, timed 5s reveals, ≤12 players, advance messages, time cap, early-exit warning, splits summary, lobby persistence) · #2 same lobby/rematch on Online MP · #4 Online == Hotseat look/behaviour · #3 Teams sub-mode.

## Phase 4 — battle simulator overhaul (PLANNED)
#6 real move mechanics (recharge, two-turn, status, stat stages, recoil, drain, multi-hit, Curse-Ghost) · #6j remove ~30 moves from draft pool · #7 scale E4 champion stats per tier · #14a one-Pokémon-one-throne cascade · #9 daily "yesterday's results" + share.

---
## ⚠️ You were missing the round-2 batch — RE-UPLOAD THESE
These contain earlier fixes (#9–#14, #17 from the previous list) that never reached your GitHub. Latest versions are in this bundle:
- `docs/js/lib/engine.js`, `docs/js/lib/pokeinfo.js` (new)
- `docs/js/modes/single.js`, `docs/js/modes/victoryroad.js`, `docs/js/modes/pokedex.js`, `docs/js/modes/safari.js`

---

## Phase 3 — Cycling Road rework + online/hotseat parity (IN PROGRESS)

### #1 — Full Cycling Road rework (DONE)

| Location | Files |
|---|---|
| `docs/js/lib/` | `mp-rules.js` (1.2.0) |
| `docs/js/modes/` | `race.js` (2.0.0 — complete rewrite) |
| `docs/js/` | `modes.js` (1.8.0) |
| `docs/css/` | `styles.css` (1.13.0 — Section O) |
| `tools/test/` | `mp-rules.test.mjs`, `race.smoke.mjs` (complete rewrite) |

The old "buy clues, first to target wins" loop is gone entirely, replaced with the mechanic you specified:

- **#1a** — Clues are **predetermined per mystery**, seeded from the room so every player who reaches a given mystery sees the identical clue set in the identical order. New shared helper `buildRevealSequence()` (`mp-rules.js`) reuses the engine's own weighted-random algorithm (cheap/easy clues first) instead of inventing a second one, confirmed by your earlier answer.
- **#1b** — First clue shows the instant a mystery is presented; one more every 5 seconds after that, on each player's own clock.
- **#1c** — A correct guess advances that player independently; the live standings bar stays; every other player sees a toast ("X has advanced to round N") — never for your own advancement.
- **#1d** — Rooms hold up to 12. The game ends once every *active* (connected, hasn't left) player has solved the target, or a room-wide time cap (target × 2 minutes) elapses — whichever comes first. Quitting mid-game shows a warned confirm ("you won't be able to see results") and marks you `left` so you stop blocking the completion gate for everyone else.
- **#1e** — Results are ranked by total time (players cut off by the time cap are listed after, by progress); a full per-mystery split table shows the fastest split in each mystery column in green and the slowest in red.
- **#1f** — Players stay in a **persistent post-game lobby** (not kicked out) until Main Menu or leaving. Rematch is an opt-in toggle with a live count; the host can trigger a 5-second countdown once they and at least one other player are opted in; only whoever is still opted in when the countdown ends joins the new game; if nobody stayed opted in, the host sees an error and is returned to the main menu.

**A genuine engine finding surfaced by this work:** "Reveal One Example Moveset" has no real exhaustion rule in the engine at all — every points-based mode (Single/Safari/Hotseat/Online) accidentally masks this because each reveal costs points, which eventually runs out. Cycling Road has no points economy, so without a fix this one clue would have dominated an entire mystery's reveal sequence (confirmed: 161 of 200 draws in testing before the fix). Fixed with a local repeat cap inside `buildRevealSequence()` — deliberately **not** by changing the shared engine's exhaustion rule, so every other mode's behavior is completely unaffected.

**Testing note — worth knowing about:** verifying this needed a genuinely custom test harness: a virtual clock (so 5-second reveal cadences and multi-minute time caps could be tested without real wall-clock waits) and, separately, per-client JSDOM windows (two simulated players sharing one browser document turned out to make `querySelector('#id')` unreliable in jsdom specifically when both players' elements shared the same id — confirmed via `.contains()` disagreeing with `querySelector` on the exact same node; real players are never in the same document, so this was a test-fidelity issue, not a product bug — but it was worth chasing down rather than working around, since it could easily have caused an earlier smoke test to be checking the wrong thing). Final tally: **33/33** on the new `race.smoke.mjs`, exercising predetermined sync, independent pacing + toasts, the room cap, the time cap, results/splits, both rematch outcomes, and early exit — full sweep across every other suite stayed green (630 total assertions this session).

### Still pending in Phase 3
- **#2** — apply the same persistent-lobby + rematch pattern to Online guess multiplayer (`online.js`). The pattern is now proven and reusable; this should be comparatively lower-risk.
- **#3** — Teams sub-mode of Cycling Road (2 teams, one answerer per team at a time, team-builder UI with a randomize-into-even-teams button, all-members-must-opt-in rematch).
- **#4** — make Online and Hotseat look and behave identically outside of their necessarily-different setup screens.

---

### #4 — Online/Hotseat feature parity (MOSTLY DONE)

| Location | Files |
|---|---|
| `docs/js/lib/` | `mp-rules.js` (1.3.0) |
| `docs/js/modes/` | `online.js` (1.4.0), `multiplayer.js` (1.3.0) |
| `tools/test/` | `online.smoke.mjs` (+15 assertions), `mp-cluemode.smoke.mjs` |

Online was missing several things hot-seat already had — not cosmetic differences, but entire settings that never existed in the online form at all:

- **By-category clue selection** — didn't exist in online; now matches hot-seat exactly (click a category header, individual cards aren't directly clickable).
- **Real Category Diversity** (Force-Different / Cycle-All) — the setting didn't exist in online's create-room form at all.
- **The "Clue Availability" exclusion panel** — hot-seat's per-clue exclude checkboxes, ported as-is.
- **Evolution auto-deduction** — online never had this. I extracted the logic out of `multiplayer.js` into one shared `computeAutoDeducedIds()` in `mp-rules.js` so hot-seat and online can't drift apart on it again, and refactored `multiplayer.js` to use the same function.
- **Same multi-use-clue bug, found again** — online's random-reveal pool had the identical `!(id in revealedClues)` mistake I fixed in `multiplayer.js` last time (permanently dropping a multi-use clue like "Reveal One Weakness" after one use). Fixed the same way, in the same pass.

**A genuine finding while testing evolution deduction:** the underlying rule (inherited from hot-seat, not something I changed) is asymmetric — revealing "Can Evolve" first successfully cascades into auto-revealing Family Size and Evolution Stage, but revealing "Evolution Stage" first blocks the OTHER two clues entirely at the engine level (by design — the engine intentionally makes them mutually exclusive rather than independently purchasable), so deduction can't run in that direction. This predates all of my changes; I didn't alter the underlying rule, only relocated it to be shared — flagging it here rather than quietly "fixing" a rule I wasn't asked to change.

**Explicitly NOT done — two known remaining gaps for #4:**
1. **Visual parity** — online's clue cards use their own `.online-clue` CSS rather than hot-seat's `.clue-btn` styling. They now *behave* identically (same features, same states) but don't yet *look* pixel-identical. Unifying this means changing online's card DOM structure, which felt like more risk than I wanted to bundle into the same pass as the functional changes above.
2. **Host-resilience pattern** — online.js has a nice existing feature hot-seat/Cycling Road lack: an `isLeader()` fallback (if the host disconnects, the next-lowest connected uid takes over host-driven duties) instead of a hard `isHost()` check. I used `isLeader()` for online's new rematch-countdown resolution (matching online's own convention), but didn't retrofit this resilience into `race.js`'s host-driven logic (time-cap ending, rematch resolution) — that's a `race.js` improvement, not required for #2/#4, noted here in case you want it later.

### Still pending in Phase 3
- **#3** — Teams sub-mode of Cycling Road (2 teams, one designated answerer per team at a time — rotates on a correct guess — team-builder UI with a randomize-into-even-teams button, all-members-must-opt-in rematch).

---

### #3 — Teams sub-mode of Cycling Road (DONE)

| Location | Files |
|---|---|
| `docs/js/modes/` | `race.js` (2.1.0) |
| `docs/css/` | `styles.css` (1.14.0 — Section P) |
| `tools/test/` | `race-teams.smoke.mjs` (new, 50 assertions) |

Built as a genuinely different pacing model, not a variant of individual Cycling Road: a **team** shares one position through the mystery sequence — everyone on the team sees the same clues at the same time, but only whichever member is currently "up" can submit a guess. A correct guess advances the whole team and rotates the answering right to the next member.

- **Lobby** — a "Team Mode" toggle on room creation; once enabled, the lobby becomes a team-builder: an Unassigned pool, two team columns, host click-to-assign per player, and a **Randomize Teams** button (even split, or n/n+1 for an odd headcount). Start is gated until everyone is on a team and both teams have at least one member.
- **Gameplay** — the designated answerer sees the guess box; everyone else on the team sees "{name} is answering for your team" while still watching the same clue feed. A correct guess rotates to the next member in join order (wrapping around for a 1-person team). Standings show two team bars instead of per-player bars; "advanced to round N" toasts go to the *other* team, never your own.
- **Ending / results** — the game ends once both active teams finish (or the time cap hits); results rank the two teams by total time with the same per-mystery fastest/slowest split highlighting as individual mode.
- **Rematch** — requires **every** currently-connected player opted in (not just 2, unlike individual mode), matching "all members must want to rematch." Restarting preserves each player's existing team.

**Implementation note:** built as parallel functions alongside individual Cycling Road (`renderTeam`, `loadTeamMystery`, `solveTeamMystery`, etc.) rather than branching the existing individual-mode code path — the two pacing models are different enough (shared vs. independent position) that interleaving them risked the already-tested individual game, so I kept them side by side instead, dispatching once at the top of `render()`. Verified with a dedicated 50-assertion test covering room creation, both team-assignment paths, answerer-gating, rotation, cross-team toasts, dual-team completion, results, and the all-opt-in rematch rule — plus the full existing suite stayed green throughout, confirming zero regression to individual mode.

## Phase 3 — COMPLETE

All four items are done: #1 (Cycling Road full rework), #2 (Online rematch/lobby parity), #3 (Teams sub-mode), #4 (Online/Hotseat feature parity, with two explicitly-flagged remaining polish items: visual card styling and host-resilience pattern — see the #4 section above).

**Final test tally across Phase 3:** 708 assertions across 8 test files, all green, plus both draft smokes untouched and passing.

**What's left overall:** Phase 4 (the battle simulator overhaul — real move mechanics, E4 stat scaling, the one-Pokémon-one-throne rule, draft pool trim, daily "yesterday's results") is the only phase not yet started.

---

## Phase 4 — Battle simulator overhaul + remaining items (IN PROGRESS)

### #6 — Real move mechanics (DONE) + #6j move-pool trim (DONE)

| Location | Files |
|---|---|
| `docs/js/` | `sim.js` (2.0.0 — major rewrite), `draft.js` (move-ban list) |
| `tools/test/` | `sim.test.mjs` (+45 assertions), `draft.test.mjs` (+3 assertions) |

**What was actually wrong:** the simulator's *engine* already had real working machinery for drain, recoil, secondary effects, status, confusion, and stat boosts — but every move's data was just `{name, type, bp, acc, prio, cat}`. Zero effect fields existed anywhere, so Hyper Beam, Absorb, Swords Dance, Toxic, Doubleslap — literally every move with a "special" effect — silently fell through to plain damage (or a complete no-op for status moves). Exactly what you suspected.

**Fixed with:**
- A new curated `MOVE_EFFECTS` table in `sim.js` covering every move in the pool that has a real secondary mechanic: recoil, drain, self-heal, guaranteed status/confuse, secondary chance effects (paralyze/burn/freeze/poison/flinch/confuse/stat-drop), stat boosts, OHKO, high-crit, and fixed/HP-based damage formulas.
- **New engine capability** (didn't exist before at all): multi-hit moves (2–5 with the real 3/8·3/8·1/8·1/8 split, plus fixed-count moves like Double Kick/Twineedle, and Triple Kick's ramping power), two-turn charge moves (Fly/Dig — with a genuine semi-invulnerable charge turn — plus Solarbeam/Razor Wind/Skull Bash), and recharge (Hyper Beam forces a blank turn afterward, skipped only if it faints the target).
- **Specially-cased moves** that don't fit generic boost/status/drain: Curse (a *different move entirely* depending on whether the user is Ghost-type — confirmed and implemented both branches), Belly Drum (costs 50% max HP, sets Attack straight to +6, fails below half HP), Rest (full heal + cures status + sleeps exactly 2 turns), Pain Split, Leech Seed (drains into the seeder each turn, Grass-types immune), and Jump Kick/High Jump Kick's miss-crash damage.
- **#6j** — removed the listed 30 moves from the draft pool entirely (Attract, Self-Destruct, Explosion, Baton Pass, Mirror Move, Skull Bash, and the rest) — mostly switch/trapping/opponent-move effects that don't make sense in a switchless 1v1 sim anyway.

**A real, significant bug found and fixed along the way:** OHKO moves (Guillotine, Horn Drill, Fissure) were **completely non-functional** before this — they have `bp: 0` in the base data (their damage isn't power-based), but the damage-dispatch code required `bp > 0` before ever calling the function that checks `move.ohko`. So even on a successful accuracy roll, they did *nothing at all* — no kill, no damage, silently inert. Caught this because a test expected at least one OHKO to land across 30 trials of a 30%-accuracy move and got zero.

**Disclosed simplifications and assumptions — please spot-check anything here that matters to you:**
- Sleep duration corrected from an earlier guess of 1–3 turns to the real gen 1/2 range of 1–7 turns.
- Confusion duration (2–4 turns) and the status chip fractions (burn 1/16, poison 1/8, paralysis speed ×0.25/25% full-para) were already correct in the existing code and left unchanged.
- Magnitude, Return, and Frustration use their flat listed base power rather than the real variable-roll/friendship formulas — there's no friendship stat in this draft context, and Magnitude's true random-power table felt like disproportionate complexity for a facsimile.
- Tri Attack's real effect randomly picks between burn/freeze/paralysis; simplified to always-paralysis on proc for determinism.
- Jump Kick/High Jump Kick crash damage uses 1/8 max HP as a reasonable, commonly-cited approximation (Gen 2's exact crash formula has some genuine ambiguity in my knowledge).
- **Found but not fixed:** Charm, Sweet Kiss, and Moonlight are tagged `Fairy`-type in the data (a type that didn't exist until Gen 6) — a data-generation pipeline quirk, not something this move-effects pass touches. Since there's no Fairy row in the type chart, they simply resolve as neutral effectiveness; their non-damage effects (confuse, heal) are still correct. Fixing the typing itself would mean touching the data pipeline, a different concern from move effects.
- PP, Substitute, Counter, Transform, trapping moves (Wrap/Bind/Fire Spin/Clamp/Whirlpool), and weather/abilities/items remain out of scope, unchanged from the simulator's original design notes.

**Testing:** 45 new assertions in `sim.test.mjs`, each proving a specific mechanic actually fires (not just "didn't crash") — recoil, drain, Dream Eater's sleep requirement, multi-hit counts and distributions, Fly's charge/invulnerability/release, Hyper Beam's recharge, OHKO, high-crit rate, fixed/HP-based damage amounts, every guaranteed-status move, Curse's two branches, Belly Drum's cost and cap, Rest, Pain Split, Leech Seed (and its Grass immunity), Jump Kick's crash, secondary chance effects, and the corrected sleep range. Full sweep: **756 test assertions across 8 files, all green**, plus every draft smoke (including the full battle-playback UI) still passing.

### Still pending in Phase 4
- **#7** — scale the Elite 4's "random" NPC champion base stats per tier (Will 425–450, Koga 475–500, Bruno 525–550, Lance 575–600).
- **#14a** — one Pokémon can only hold one Elite 4 spot at a time (taking a higher stage cascades the previous holder back to the stage below).
- **#9** — daily draft "see yesterday's results" page with a share button.

---

### Requested verification pass — status effects + stat changes (DONE)

| Location | Files |
|---|---|
| `docs/js/` | `sim.js` (2.1.0), `modes/draftbattle.js` (1.7.0) |
| `tools/test/` | `sim-status.test.mjs` (new, 15 exact-value assertions), `run.mjs` |

You asked specifically to check that confusion, paralysis, poison, freeze, and burn are handled correctly — not just "fires sometimes" but the actual math. Built a dedicated test file that checks **exact numbers**, not just occurrence:

- **Burn**: chip damage is exactly maxHP/16 every turn (verified against a mon with a round 400 HP so the fraction has no rounding ambiguity), halves physical damage specifically (confirmed ~50% reduction, not affecting a separate special attack), Fire-types are never burned.
- **Poison**: chip is exactly maxHP/8, Poison/Steel-types immune to both regular and toxic poison.
- **Toxic**: chip damage genuinely *climbs* each turn — verified the exact sequence 25→50→75→100 (not just "eventually more").
- **Paralysis**: confirmed the faster Pok\u00e9mon reliably acts first *before* paralysis lands, and the full-paralysis rate lands in a sane band around 25% over hundreds of sampled turns.
- **Freeze**: confirmed a frozen Pok\u00e9mon is genuinely blocked from acting, that it isn't a permanent lock (thaws across trials), and Ice-types are immune.
- **Confusion**: self-hit rate lands around the intended ~33%, and it correctly announces when it wears off.
- **Stat stages**: guaranteed self-boosts (Swords Dance) log the exact delta every time; guaranteed target-drops (Growl) hit the *opponent's* stat, never the user's; the ±6 stage clamp was verified to actually stop accumulating past the floor; Curse's non-Ghost branch was checked to change all three stats it's supposed to (+1 Atk, +1 Def, −1 Spe) in one use.

**Two real, additional gaps found and fixed while doing this verification (beyond what was already fixed in the #6 pass):**
1. **Confusion never announced when it wore off** — sleep has "woke up," freeze has "thawed out," but confusion had no equivalent signal, silent by omission. Added a `confuse-end` event.
2. **The bigger one: the battle-log playback UI was never updated for any of the new sim.js 2.0.0 event types.** Charge turns, recharge, multi-hit counts, Curse, Belly Drum, Rest, Pain Split, Leech Seed, crash damage, and every stat boost/drop were all being computed correctly by the simulator but **silently vanishing from the on-screen battle log** (they hit the renderer's `default: continue` and produced no visible line at all). This means a player watching a battle where a mon used Swords Dance would see *nothing happen* on screen that turn, even though the Attack boost was correctly applied underneath. Fixed by adding narration for all twelve new event types.

This second one is worth flagging clearly: the underlying mechanics were correct after the #6 pass, but the player-visible result would have looked exactly like the bug you originally reported — moves silently doing nothing. Good that this got caught now.

Full sweep after this pass: **783 test assertions across 8 files, all green**, run 5 times back-to-back to confirm no flakiness in the probability-sampling checks.

---

### #7 — Elite 4 stat scaling (DONE)

| Location | Files |
|---|---|
| `docs/js/` | `draft.js` (0.6.0), `lib/draft-adapter.js` (1.1.0), `modes/draftbattle.js` (1.8.0) |
| `tools/test/` | `draft.test.mjs` (+18 assertions) |

Each Elite 4 tier's NPC now scales to your target base-stat-total band: **Will 425–450, Koga 475–500, Bruno 525–550, Lance 575–600.** (The All-Time Champion tier is intentionally left unscaled — the spec didn't define a band for it.)

**How this works without breaking the draft's own rules:** every stat "card" in the draft is a *real* Pokémon's real stat — there's no way to just assign an arbitrary target total without either breaking that property or reimplementing the card-picker's internals. Instead, `autoDraftScaled()` re-runs the normal auto-draft with a deterministic, incrementing sub-seed until the result's base-stat total lands in the target band (rejection sampling). I checked this was actually fast enough first: the natural distribution has a median around 410, so even Lance's rare 575–600 band (only ~1.2% of random drafts land there naturally) converges in well under a second — 500 draft attempts took 34ms in testing. This only ever runs once per (tier, reset period), not per page view, so the cost is a non-issue either way. Verified empirically and in 18 new tests that every tier's target band is hit reliably across multiple seeds, that results stay deterministic, and that an intentionally-impossible band falls back gracefully to the closest fit instead of hanging or throwing.

### #14a — one Pokémon can only hold one Elite 4 spot (DONE)

| Location | Files |
|---|---|
| `docs/js/` | `draft.js` (0.7.0), `lib/draft-adapter.js` (1.2.0), `modes/draftbattle.js` (1.9.0) |
| `tools/test/` | `draft.test.mjs` (+11 assertions) |

Implemented exactly as you specified: if a player already holds one throne and wins a battle for a *different* one, they keep whichever is the **higher** tier. The lower one they vacate goes to whoever they just defeated for the new throne — bumped down rather than eliminated — if that defeated holder was a real player; if the defeated holder was an NPC, the lower throne just reverts to a fresh NPC champion. Trying to "win" a *lower* throne while already holding a higher one doesn't switch you down — you keep the higher spot, and the lower one you just battled simply reverts to vacant. All-Time Champion counts as the highest possible spot, above every numbered stage.

The actual decision logic (`resolveThroneCascade`) is a small, pure function with no Firebase or DOM involvement, so it's fully unit-tested in isolation — 11 new assertions cover the up-cascade with a human defender (bump-down), the up-cascade with an NPC defender (plain vacate), the reverse case (keep the higher one), and the All-Time-outranks-everything edge case.

Full sweep after both: **809 test assertions across 8 files, all green.**

### Still pending in Phase 4
- **#9** — daily draft "see yesterday's results" page with a share button.

---

### #9 — daily draft "See Yesterday's Results" (DONE)

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.10.0) |
| repo root | `smoke-daily.mjs` (dev smoke, extended) |

Added a "📅 See Yesterday's Results" button to the daily results screen, reusing the same Central-Time date math (DST-aware) that already computes today's date — so "yesterday" is always correct even across a daylight-saving transition. Clicking it shows a "Yesterday's Results" screen with the same ranked table, Daily Rival, and Share button, computed against that historical date's saved entries; a "Today's Results" button returns you to the present day.

Verified end-to-end in the dev smoke test: submitted a daily entry, clicked through to yesterday, confirmed the date line actually changed (2026-07-01 → 2026-06-30) and the title updated, then clicked back and confirmed today's date and title were restored exactly.

## Phase 4 — COMPLETE

All five items are done: #6 (real move mechanics) + #6j (move-pool trim), the requested status-effects/stat-changes verification pass, #7 (E4 stat scaling), #14a (one-Pokémon-one-throne), and #9 (yesterday's results).

**Final test tally for Phase 4:** 809 test assertions across the full suite, all green, plus every draft smoke (including the full battle-playback UI and the new yesterday/today round-trip) passing.

## Overall project status

**All four original phases are now complete:**
- Phase 1 & 2 (earlier sessions): 25-point + 17-point feedback batches, online multiplayer, identity/PIN, catch mechanic, clue-selection modes.
- Phase 3: Cycling Road full rework, Online rematch parity, Teams mode, Online/Hotseat feature parity.
- Phase 4: Battle simulator overhaul (real move mechanics), E4 stat scaling, one-throne-per-Pokémon, daily "yesterday's results."

**Known, disclosed remaining items (not gaps — deliberately scoped out, documented above where they were found):**
- Online's clue cards don't yet visually match hot-seat's exact card styling (behavior is identical).
- `race.js` doesn't yet have online.js's host-disconnect resilience pattern (`isLeader()` fallback).
- A few move mechanics use disclosed simplifications (Magnitude/Return/Frustration flat power, Tri Attack's status pick, Jump Kick's crash-damage estimate).
- The Fairy-type data-tagging quirk on Charm/Sweet Kiss/Moonlight (a data-pipeline issue, not a move-effects issue).
