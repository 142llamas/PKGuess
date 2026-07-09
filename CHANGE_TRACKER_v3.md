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

---

## Phase 5 — 19-item testing-checklist batch (round 1: #16, #2–4, #8, #10, #5, #12–15)

Starting point: a fresh chat picked up an 802-assertion green baseline (553 unit + 229 smoke + the daily dev smoke), confirmed directly from a zip of the actual repo rather than assumed from prior notes. Worked in two batches; both left the full suite green before moving on.

### Batch 1 — #16, #2, #3, #4, #8 (DONE)

| Location | Files |
|---|---|
| `docs/js/modes/` | `race.js` (2.1.1) |
| `docs/js/modes/` | `single.js` (1.2.1 → later 1.2.2 in Batch 2) |
| `docs/css/` | `styles.css` (1.14.1) |
| `docs/js/lib/` | `mp-rules.js` (1.3.1) |
| `tools/test/` | `race.smoke.mjs`, `mp-rules.test.mjs`, `online.smoke.mjs`, `cluemode.smoke.mjs` |

- **#16 — Cycling Road "Could not create the room."** Root cause: individual (non-team) mode wrote the player object with `team: undefined`; the Firebase RTDB SDK throws synchronously on any `undefined` value in a `set()`/`update()`. Team mode wrote `team: null` (legal), which is exactly why only team mode worked — same bug existed on the join path too. Fixed by omitting `team` entirely unless team mode is on. **Also hardened the test double:** the smoke's fake Firebase used `JSON.stringify`, which silently *drops* `undefined` — exactly why this bug shipped past the existing suite undetected. The fake now throws on `undefined` like the real SDK; proved the guard actually catches the old code before restoring the fix.
- **#8 — evolution over-deduction.** `computeAutoDeducedIds` revealed family size whenever *either* "Can Evolve" or "Evolves From" was known — so revealing "Can Evolve = No" alone leaked family size (the mon could still be the final form of a 2- or 3-member family). Rewrote the determination rule to exactly mirror the engine's own cross-inference logic. The **old `online.smoke.mjs` asserted the buggy behavior directly** (`deduced.length > 0` after revealing Can Evolve) — corrected that assertion to check for the non-leak instead.
- **#2/#3 — clue help text.** "Reveal Second Type" said "Not available" instead of "Need to reveal first type"; the stat with-value clues said "Full spread already shown" even when it wasn't (the real reason is an unmet base-stat prereq). Both corrected in `single.js`'s `unavailNote()`.
- **#4 — moveset help text huge/white on Hard/Extreme.** `.clue-limit-note` had **no CSS rule at all**, so it fell back to browser defaults. Added the rule to match `.clue-unavail-note`.

Full sweep: 799 assertions, all green (+17 new regression tests).

### Batch 2 — #10, #5, #12, #13, #14, #15 (DONE)

| Location | Files |
|---|---|
| `docs/js/` | `draft.js` (0.8.0) |
| `docs/js/lib/` | `draft-adapter.js` (1.3.0), `engine.js` (1.3.1), `share.js` (1.3.0) |
| `docs/js/modes/` | `draftbattle.js` (1.11.0 → 1.12.0), `single.js` (1.2.2) |
| `database.rules.json` | 1.1.0 |
| `tools/test/` | `draft.test.mjs`, `engine.test.mjs`, `mp-rules.test.mjs` (unchanged this batch), `modes.smoke.mjs`, **`share.test.mjs` (new)**, `throne.smoke.mjs` (new, then substantially rewritten mid-batch — see below) |

**#10 — daily "see results" showed yesterday instead of today.** Two `onClick: showDailyResults` handlers (the "already done today" gate's View Results button, and a battle screen's Results button) passed the handler *bare* — the click's `MouseEvent` was received as `showDailyResults`'s `dateStrOverride` argument, a truthy value that made `isHistorical` true. Both now wrap the call so no argument is passed.

**#5 — score multipliers.** Added `SCORE_MULTIPLIERS` + `computeScoreMultiplier` to `engine.js` (pure, unit-tested): Difficulty (Easy 0.8 · Normal 1.0 · Medium 1.3 · Hard 1.6 · Extreme 2.0) × Guess Mode (Anytime 1.0 · Forced 1.3) × Clue Selection (Choose 0.8 · By-category 1.2 · Random 1.6) × Category Diversity (Free 1.0 · Force-Different 1.2 · Cycle-All 1.5), stacking multiplicatively (max ≈ 6.24×, comfortably under the leaderboard's 10000-point validation cap). Custom stays unmultiplied and off the leaderboard (unchanged from before). `single.js` submits the multiplied score and shows "raw × multiplier = final" on the win summary.

**#12/#13 — Elite-4 unlock/claim bugs.** These took real investigative work, not just a code read, because the surface symptoms ("beating Will doesn't unlock Koga," "All-Time seems to always be available") didn't obviously map to a single line of code. Built a full deterministic repro harness (`params._getFirebase`/`_getIdentity` test-injection hooks — newly added to `draftbattle.js`, matching the seam `race.js`/`online.js` already had — plus a hardened fake Firebase, plus a `Math.random` patch to make a specific drafted mon reproducible) and drove the *actual* controller through a full climb.

Found the real bug: the unlock check was "does the immediately-previous tier's throne **currently, physically** show your uid as holder" — but the #14a one-throne cascade (by design) vacates a lower throne the moment you claim a higher one, and every tier's own cadence reset (Day at midnight CT, etc.) can *also* vacate a throne purely from time passing. Either event silently erases unlock progress the player already earned. Confirmed both trigger paths empirically before fixing.

Fixed with a new, separate, monotonic value: the highest tier a player has *ever* reached, persisted at `/draft/progress/{uid}` (`isTierUnlocked`/`nextProgressRank` in `draft.js`, both pure and unit-tested) — vacating a lower throne can no longer relock tiers above it. `claimThrone()` also now verifies both the throne write and the progress write with a follow-up read (mirroring `submitDaily`'s existing pattern) instead of reporting success on an unconfirmed write, directly addressing "doesn't correctly let you claim the spot." `database.rules.json` gained a `/draft/progress/{uid}` rule (own-uid-only, numeric 0–5) — **this needs to be re-deployed to the Firebase console**, same as the earlier `database.rules.json` note about the live rules lagging the repo copy.

Along the way, this fix's own gating mechanism was **superseded by #14/#15's redesign below** before shipping — see there for why per-tier gating was removed entirely rather than kept alongside the gauntlet.

**#14/#15 — Elite-4 gauntlet rework + share.** Per your direction: "Challenge the Elite 4" no longer opens a grid of individually-clickable thrones. It now auto-battles Will → Koga → Bruno → Lance → All-Time in one action, **always starting fresh at Will** (a new draft can dethrone even the player's own earlier champions — no "start from your last unlocked tier" shortcut), stopping at the first loss or after clearing All-Time. One results screen shows a row per matchup (opponent, win %, W/L, an on-demand "▶ Watch" button reusing the existing battle-log playback UI) and a placement message ("You took the 1st/2nd/3rd/4th/Champion spot," or "You fell to Will" if nothing was beaten). One Claim (of the highest spot reached — still goes through the unchanged #14a cascade + #12 write-verification underneath). One Share.

Because the gauntlet always starts at Will regardless of prior progress, the #12/#13 per-tier "unlocked" **gate** became unnecessary — the gauntlet doesn't need permission to attempt anything, it just naturally stops at the first loss. Rather than leave dead gating logic in place, the status grid (`renderThrones`/`throneCard`) was simplified to pure display (current holder + History button) with one gauntlet-entry button; the persisted progress rank from #12/#13 was repurposed as a non-gating "🏅 Your best" badge instead of being wasted. `isTierUnlocked` remains exported/tested in `draft.js` as a general-purpose utility, just no longer called from `draftbattle.js`.

**#14** also added a "📤 Share My Pokémon" button to the Draft Complete screen: `share.js` gained a canvas-card renderer (`buildMonCardPlan` for pure layout data, `drawMonCardToCanvas` for the actual draw calls against an injected 2D context, `TYPE_COLORS`/`typeColor`/`typeTextColor` mirroring `styles.css`'s type colors exactly) and `shareMonCardImage` (Web Share API with an image file where supported, falling back to a PNG download + a copied caption). The gauntlet's consolidated share reuses the same card image alongside the new "I just took the Nth spot… see if you can beat my {Pokémon}" text (`buildSummaryText`'s new `'gauntlet'` kind) plus a deep link back into Draft Battle (`draftBattleLink`).

**Testing notes worth knowing about:**
- `drawMonCardToCanvas` is tested against a lightweight *recording* fake 2D context (an object whose `fillRect`/`fillText`/etc. just log their calls) rather than real pixels — jsdom has no canvas 2D implementation, and this project deliberately avoids adding a `canvas` npm polyfill dependency just for pixel tests. The smoke suite separately confirms clicking the real Share buttons in a real (canvas-less) jsdom environment degrades gracefully (falls through to text-only) without throwing.
- Building a genuinely reproducible end-to-end gauntlet test required a mon that reliably beats all five tiers. Found one (a `DraftSession` seed, greedily drafted) by searching offline against the exact same `runMatch` calls the app uses — but the *first* attempt to wire this into the real jsdom-driven test produced a completely different (weaker) mon than predicted. Root cause was a bug in the **test harness**, not the app: `Math.random` was un-patched immediately after `createDraftBattle()` returned, but `startDraft()` is actually invoked later, inside a pending `Promise.all(...).then()` microtask — so the patch window closed before it mattered. Fixed by keeping the patch active until after that chain resolves.
- `throne.smoke.mjs` was written once against the pre-gauntlet design (individually clicking each throne's Challenge button), then had to be substantially rewritten once the gauntlet replaced that UI entirely — a reminder that UI-driving smoke tests are coupled to the flow they drive, not just the underlying logic.
- Every fix in this phase was verified with a "does the test actually catch the old bug" check: the #16 fake-Firebase guard was proven against the literal old code, and the #12 write-verification guard was proven by temporarily re-injecting the old (unverified) `claimThrone` behavior — both restored immediately after confirming the regression test failed as expected.

**Explicitly out of scope for this batch** (deferred, not forgotten): #1 (daily share link + message format), #11 (leaderboard tab/link to draft modes), #6 (Victory Road tier/clue rework), #7/#9 (hot-seat GtR + evolution-deduction direction), #17/#18 (Cycling Road Teams recognition + rematch), #19 (online GTR turn handling after an expired turn).

**Also found, not part of the checklist:** `smoke.mjs`/`smoke2.mjs`, referenced in this file's own "round-2 batch" note and in `MANIFEST.md`'s test table, do not exist anywhere in the actual repo — checked directly against a fresh zip. This predates this session; flagging it rather than quietly fixing a reference I can't verify the original intent of. `throne.smoke.mjs` (new this session) now covers the Draft Battle / Elite-4 flow those were described as testing.

**Full test tally after Phase 5, Batch 2:** 635 unit + 265 smoke = 900 assertions, all green, plus the `smoke-daily.mjs` dev smoke.

### Batch 3 — #7, #9, #19 (DONE), #17 (DONE — deeper than it looked), #18 (investigated, not reproduced)

| Location | Files |
|---|---|
| `docs/js/modes/` | `multiplayer.js` (1.3.1), `online.js` (1.4.1), `race.js` (2.1.2) |
| `tools/test/` | `mp-cluemode.smoke.mjs`, `online.smoke.mjs`, `race.smoke.mjs`, `race-teams.smoke.mjs` |

**#7 — "click a clue above" text wrong on desktop.** Confirmed from the CSS: `.game-body` is a row on desktop (clue grid left, side panel right, where this hint lives) and only collapses to a column (clue grid above) under the mobile media query. Rather than detect viewport in JS, dropped the directional claim entirely ("Click a clue to reveal it") so it's correct regardless of layout — applied to both hot-seat's two matching hints and online.js's two equivalent ↑-arrow hints (same underlying assumption, same fix, for consistency).

**#9 — hot-seat GTR let a player reveal unlimited clues, or skip with zero.** `revealClue()` only advanced the phase out of 'reveal' for RTG; for GTR it left the phase untouched, so the clue grid stayed interactive for the SAME player indefinitely. A "Skip to guess"/"Skip reveal" option was also always available, which could end a turn having revealed nothing at all. Fixed so revealing a clue during GTR's (wrong-guess-triggered) reveal phase immediately calls `nextTurn()`, and all skip options are suppressed during that phase. **A pre-existing test actively relied on the bug**: `mp-cluemode.smoke.mjs`'s multi-use-clue-history test used GTR staying in 'reveal' forever as a convenient way to fire 20 reveals in a row for one player. Rewrote it to cycle through RTG turns (reveal once, deliberately wrong-guess, next player) instead — clue reveals accumulate in the shared round state regardless of which player revealed them, so the same coverage still works under the corrected turn rules.

**#19 — online GTR, same bug, worse symptom.** Exactly matches the report: let one player's turn expire, the next player guesses wrong, and they're stuck revealing random clues forever with no way back to the other player. Root cause was identical in shape to #9 but implemented differently: `revealOutcome()`'s GTR branch just returned `state.phase` unchanged, and turn-advancement only happened if the player happened to click a separate, unguarded "Skip to guess" button. Added a shared `applyRevealAndAdvanceIfGtr()` used by all three reveal paths (choose/random/by-category) that advances `currentTurnPos` and resets the deadline in the same write as the reveal, and suppressed "Skip to guess" during GTR's mandatory reveal (same reasoning as #9). New dedicated test drives the exact reported sequence — turn-expiry via the virtual clock, then a wrong guess, then a reveal — and confirms the turn comes back automatically. Also fixed a **pre-existing dead exit code** at the bottom of `online.smoke.mjs` (`process.exit(fail ? 0 : 0)` — always 0, with unreachable code after it) so a real failure there actually fails `npm run test:smoke` going forward.

**#17 — Cycling Road Team Mode: a correct guess "not recognized."** This took real investigative work rather than a quick code read, because the straightforward repro (2-person team, then a 1-person team, across multiple consecutive rounds) showed clue-revealing and mystery-advancement working correctly every time. Kept looking rather than concluding "can't reproduce," and found a genuine, confirmed bug one level over: `startCapTimer()`'s shared 1-second interval unconditionally called the **individual**-mode `renderProgressStrip()`/`maybeEndGameAsHost()` — even in a team game, since both `render()` and `renderTeam()` start the same timer. In a team game no player's own `solved` field is ever touched (progress lives in `teamState`), so this was visibly hijacking the standings strip once a second with a bogus "everyone stuck at 0/target" individual display.

Chasing *why* that display bug would ever look like "a correct guess wasn't recognized" led to the real finding: with the wrong function wired up, the correct team-ending check (`maybeEndTeamGameAsHost`) only ever ran *reactively*, inside `renderTeam()`, when a Firebase update happened to trigger a fresh render — it had no independent, periodic path to run again if that reactive attempt were ever missed. Built a deterministic multi-client repro (per-client JSDOM windows + a virtual clock, extending the existing `race-teams.smoke.mjs` harness) that surfaces exactly this: a write triggered synchronously from *within* another write's own notification callback can, in this test's fake Firebase, fail to reach some listeners (a reentrancy guard silently drops the nested notification) — leaving the finishing player's own client stuck rendering a stale "waiting for the other team" screen, even though the database has already correctly moved to `gameOver`. Whether or not this exact mechanism is what happens against real Firebase, the fix is a genuine resilience improvement either way: the cap-timer interval now dispatches the *correct*, team-aware pair of functions every second, giving the game-ending check a periodic, independent chance to self-heal within a second of any missed reactive update — which directly matches "the only thing that changed was that clues stopped being presented" (nothing new was happening for that player because their client had frozen on a screen from before the game genuinely ended).

**#18 — rematch only recognizing the host, not the guest — investigated, NOT reproduced.** Read `toggleRematch()`/`renderGameOver()` closely: both host and guest write to their own uid's `rematch` flag via an independent path-scoped `set()`, and the render reads `room.players` generically with no host/guest asymmetry — nothing wrong on inspection. Built increasingly adversarial reproductions against the real controller: host opts in then guest (existing test, already passing), guest opts in then host (order reversed), and both clicking with zero ticks between them (simulating two people clicking at the same instant) — checking not just the database state but what's actually *rendered* on each client's own screen. All three scenarios showed both opt-ins correctly recognized, the "2 players want a rematch" count correct on both screens, and the Start-rematch button correctly enabled. Given #17 turned out to hinge on a specific reentrant-write timing pattern that only manifests under particular conditions, it's plausible #18 has a similarly narrow trigger that these three scenarios didn't happen to hit — but I don't have enough information to narrow it further without guessing. The DOM-level assertions from this investigation are now permanently in `race.smoke.mjs` (checking what's rendered, not just the database) so if the real trigger is found later, regression coverage is already half-built. **Needs more detail to proceed**: was this Individual or Team mode? Exactly 2 players or more? Did the guest see their own "✅ Rematch selected" confirmation locally (i.e., did their own click register), or did nothing happen even on their own screen?

**Full test tally after Phase 5, Batch 3:** 635 unit + 296 smoke = 931 assertions, all green, plus the `smoke-daily.mjs` dev smoke.

### Batch 4 — #1, #6, #11 (DONE); #18 still pending your answers

| Location | Files |
|---|---|
| `docs/js/lib/` | `share.js` (1.4.0) |
| `docs/js/modes/` | `draftbattle.js` (1.12.1), `victoryroad.js` (1.3.0), `leaderboard.js` (1.2.0) |
| `docs/css/` | `styles.css` (1.14.2) |
| `tools/test/` | `share.test.mjs`, `smoke-daily.mjs`, `throne.smoke.mjs`, `modes.smoke.mjs`, **`victoryroad.smoke.mjs` (new)** |

**#1 — daily share link + format.** `buildSummaryText`'s `'daily'` kind now leads with a deep link (`dailyChallengeLink()`) and matches the exact spec'd 4 lines, with the **player's name** (not the mon's) on line 2 — falling back to a stable `Player_NNNNN` (`stablePlayerFallbackName`, derived from the uid so it's the same every time they share, not fresh-random per share — flagged as a design choice, not explicitly requested). Along the way, found that `smoke-daily.mjs` and `throne.smoke.mjs` never exposed `window.location` as a Node global, so `dailyChallengeLink()`/`draftBattleLink()` silently degraded to empty strings in those tests without it being visible — fixed both test files.

**#6 — Victory Road full tier rework.** The biggest single item this session. Straightforward parts: every tier's streak threshold shifted +1 (Tier 1 now covers up to streak 5, not 4 — each tier individually +1, not cumulative); habitat extended to Tier 2; First Anime Appearance extended to Tier 3; Highest/Lowest Base Stat (no value) added to Tier 7.

Two things surfaced only by testing, not just reading the spec: 
1. **"Has an Immunity" (new to Tiers 1–4) silently never appeared.** Root cause: `engine.js` deliberately locks that clue once both types are already known (line 309 — a legitimate cross-inference, since you could deduce it yourself at that point), and every affected tier's slot list already revealed both types *before* immunity in the pre-reveal order. Fixed by reordering `hasImmunity` before the type slots in every tier that has both — confirmed via a real UI-driven repro, not just code reading, since the standalone `clueAvailable` check looked fine in isolation and only failed once the SAME round's earlier reveals were replayed first.
2. **A pre-existing sentinel leak.** `buyClue`'s "No more X to reveal" exhaustion message gets recorded in `clueHistory` like any real value whenever a multi-use pre-reveal loop (egg moves, and now weakness/resistance) runs one call past what a mon actually has — e.g. a mon with only 2 egg moves, pre-revealed up to 3, ends up with "Ancientpower, Body Slam, No more egg moves to reveal" in its history. This already existed before this session (confirmed: Venonat, Magnemite, Voltorb and others all show it under the *old* one-chip-per-move display too) but consolidating multiple entries onto one line (per #6ii below) would have made it far more visible, so it's fixed now: every merged display filters out anything starting with "No more" before rendering.

The new weakness/resistance reveal (#6b: Tiers 3–8, a **combined** total of 6/5/4/3/2/1 per tier) is a new `revealUpToCombined()` helper that round-robins between the two multi-use clues, stopping at the cap or once a mon genuinely has nothing left in either pool (verified: Onix, rich in both, gets a clean 3/3 split at cap 6; Ditto/Rattata, with exactly one weakness and one immunity-adjacent resistance, stop cleanly after one real value each rather than looping or padding).

Display side (#6i/#6ii/#6iii): the two type clues now render as one chip on one line ("Ground / Water", or "Fire (pure)" for mono-types — avoiding a redundant "Fire / — (pure Fire-type)"); egg moves render as one chip listing every revealed move; weakness/resistance render as one chip with "Weak:"/"Resist:" prefixes, color-differentiated using the app's existing win/loss red/green convention.

New `tools/test/victoryroad.smoke.mjs` drives the real controller through a deterministic shuffle (`rng:()=>0`, which makes the Fisher-Yates order fully predictable, so the test can "know" what to guess at every step without ever reading the hidden mystery out of internal state) — advances 11 correct guesses to reach Tier 3 and confirms the combined reveal actually shows up there. Building this test surfaced one more thing worth flagging: a correct guess doesn't advance to the next Pokémon immediately — there's an 850ms delay for the "✅ Correct!" flash — so the test's first draft (using a 20ms wait) silently "guessed" against a stale, not-yet-advanced mystery and failed every guess after the first. Not a product bug, just a timing lesson for anyone else driving this screen in a test.

**#11 — Leaderboard needs a way to reach Draft results.** Added a small "Looking for Draft Battle results?" row at the top of the Leaderboard screen with direct links to the Elite 4 Standings and Daily Challenge Results screens (a simple in-app navigation via `location.hash`, reusing the exact same routes the main menu's own Draft/Daily cards use) rather than duplicating the throne/daily data-fetching logic into a third place. Also fixed a test-infrastructure gap while adding coverage here: `modes.smoke.mjs`'s shared `run()` helper never awaited its `checks` callback, so an async check (needed here because `leaderboard.js` gates its first render behind `getIdentity()` settling) would have its assertions run *after* the test had already moved on and torn the controller down — fixed to `await checks(mount)`.

**Every fix in this batch was verified with a "does the test actually catch the old bug" check**, same discipline as every batch before it: the #6a tier-threshold guard was proven by reverting Tier 2's minStreak, the #6b immunity-ordering guard by reverting the slot order back to the original (types-before-immunity), and the #11 link guard by removing the new buttons — all three failed as expected, then were restored.

**Full test tally after Phase 5, Batch 4:** 646 unit + 317 smoke = 963 assertions, all green, plus the `smoke-daily.mjs` dev smoke.

### Batch 5 — #18 dropped (couldn't recreate either); host-disconnect resilience for all online modes; move-accuracy pass; Fairy-type removed; GTR skip-guess button removed; docs updated

You confirmed you couldn't recreate #18 (rematch) either, so it's dropped rather than pursued further with no reproduction on either side.

**Host-disconnect resilience — extended to ALL online modes, not just race.js.** You asked for race.js (Cycling Road) to get the same resilience online.js already had for its turn-timeout/round-advance/rematch-resolution duties. Investigating race.js surfaced that **online.js itself had a gap in the same area**: its Lobby "Start game" button and post-game "Start rematch" button were still gated by a hard `room.hostUid === me.uid` check — meaning if the original host disconnected before ever starting the game, or during the post-game lobby before triggering a rematch, *nobody* could ever act, room permanently stuck. Fixed both, and extracted the shared logic (`leaderUid(room)`) into `mp-rules.js` so online.js and race.js — identical room shape — can't drift apart on this the way `computeAutoDeducedIds`/pool-filtering drifted before those were unified. Ported the same fix to race.js's individual AND team-mode lobbies, both post-game rematch screens, and the turn-timeout/round-ending duties. Added a host-left banner (visible wherever a room exists) telling every player when the original host has disconnected and who's taken over — the second half of your request.

**A real, deep bug found while building the race.js test, not caused by this batch's changes.** Verifying Team Mode's host-disconnect resilience meant reaching the exact scenario where both teams finish while the original host is disconnected — and the test kept failing on an assertion from the *earlier* #17 fix (Batch 4), even after reverting every single change in this batch one at a time, including a full revert back to the exact code that passed 55/55 at the end of Batch 4. That ruled out this batch's own changes as the cause and pointed at something environmental or already-latent. Direct instrumentation (temporary console logging inside the actual game-ending function, not guesswork) found it: `renderTeamGameOver()` was missing its own `bestByCol`/`worstByCol` array declaration entirely — `renderGameOver()`'s individual-mode copy had the line, `renderTeamGameOver()`'s never did — causing a `ReferenceError` the instant both teams' game-over screen tried to render. This bug has likely existed since Team Mode was first built; it was never reachable before because, until the #17 fix, the shared cap-timer interval never correctly called team mode's own ending logic in the first place — #17 was the first thing to ever actually reach this code path via that route. Fixed by adding the missing declaration. Also hardened both `race.smoke.mjs`'s and `race-teams.smoke.mjs`'s fake Firebase along the way: a write triggered synchronously from *within* another write's own listener callback was being silently dropped by a bare reentrancy guard (`if (notifying) return;`) instead of queued for a follow-up pass — real Firebase is eventually consistent but never silently loses a write, so the test's fake one shouldn't either.

**Move-accuracy pass.** Fairy type doesn't exist in Gen 1/2, so it's now removed everywhere it can be: Charm and Sweet Kiss retagged **Normal**, Moonlight retagged **Dark** — their real historical pre-Gen-6 types (all three were retroactively made Fairy in Gen 6). Confirmed this changes no simulator *behavior* for these three specifically — type-effectiveness/immunity is only ever consulted by the damage-calculation path, and all three are 0-bp status moves that never reach it — so it's a pure data-accuracy fix, exactly as requested ("100% accuracy" with no functional risk). Two side effects of chasing this down:
- **Charm was found to have no effect implemented at all** — a silent no-op every time it was used. Added its real -2 Attack drop (twice Growl's -1, matching its role as the harder-hitting version).
- Investigated whether the other disclosed simplifications could be improved. **Magnitude** now rolls the real 4–10 magnitude table every use (`MAGNITUDE_TABLE`) instead of a flat listed bp — this needed no external stat, so unlike the other two below it could be modeled exactly. **Tri Attack**'s secondary proc now picks randomly among paralysis/burn/freeze instead of always paralysis. **Return/Frustration** are deliberately left at their flat listed power — their real formulas are friendship-based, and there's no friendship stat anywhere in this draft context to compute one from; inventing an assumed value would be an arbitrary guess dressed up as precision, not genuine accuracy, so this is flagged as a structural limitation rather than "fixed." **Jump Kick/High Jump Kick crash damage** is left at the existing 1/8 max HP — looked for a more confident Gen-2-specific figure to replace it with and didn't find one with higher confidence than what's already there, so didn't want to swap a reasonable value for an unverified "precise-looking" one.

**Removed the "Skip guess" button from GTR's guess phase**, in both hot-seat and online — it let a player skip guessing entirely, which undermined GTR's whole premise (guess cold, only reveal if wrong). The *separate*, unrelated "Skip to guess" button that appears during GTR's *reveal* phase (already correctly suppressed by the #9/#19 fixes) was left alone.

**Docs updated**, per your request that this puts us in a good position for another round of testing: `README.md`'s intro/directory-tree/testing sections were rewritten (it hadn't mentioned Cycling Road, Online multiplayer, Team Mode, the Elite-4 gauntlet, or the battle-simulator rework at all). `TESTING_CHECKLIST.md` had a section (Elite 4/Throne) still describing the *old* per-tier challenge-and-claim flow from before the #14/#15 gauntlet rework — fully rewritten — plus new items across Victory Road, both GTR fixes, host-disconnect resilience, the leaderboard draft-links, the daily share format, and the move-accuracy fixes.

**Every fix in this batch was verified with a "does the test actually catch the old bug" check**: the Charm/Magnitude/Tri Attack fixes were each proven by reverting and confirming the new test failures, then restored; the online.js lobby/rematch leader-fallback fix, the race.js individual-mode and team-mode leader-fallback fixes, and the skip-guess-button removal were all proven the same way.

**Full test tally after Phase 5, Batch 5:** 696 unit + 342 smoke = 1038 assertions, all green (stable across repeated runs), plus the `smoke-daily.mjs` dev smoke.

### Phase 5 status
All items from the original 19-point list are now resolved except **#18**, which is dropped (neither side could reproduce it despite genuine effort on both). Everything else — the daily share link, Victory Road's rework, the leaderboard draft links, host-disconnect resilience across every online mode, and the move-accuracy pass — is done and tested. With the docs now current, this is a good point for a fresh, thorough testing pass against `TESTING_CHECKLIST.md`.

---

## Phase 6 — new features: Daily Draft matchups/inspect, room sharing, VR preview fix

New requests, not part of the original 19-point list. #18 was raised again and dropped for good (you couldn't recreate it either).

### Daily Draft: individual matchups, on-demand replay, mon inspection, Cal rename

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.13.0) |
| `tools/test/` | `daily.smoke.mjs` (new) |

`showDailyResults()` already computed every pair's full `runMatch()` result (win counts AND a sample battle log, needed to display the aggregate win%) — it just discarded everything except the average afterward. Restructured to retain it, per player, oriented from that player's own perspective (`myWinPct`/`iWon`), so nothing needed to be re-simulated for the new features:

- **📊 Matchups button** (every row, including Cal's) opens a per-player breakdown: every OTHER entrant, this player's specific win/loss + win% against each, with a ▶ Watch button. "No self-battling" wasn't special-cased — it falls out naturally, since the all-pairs computation never pairs a player against themselves.
- **▶ Watch** replays the already-computed sample log through the *existing* battle-playback UI (the same one the Elite-4 gauntlet's "Watch" uses) — genuinely zero re-simulation, exactly as asked, since re-computing would risk a different, confusing result.
- **🔍 Inspect button** (every row) opens a read-only view of that entrant's types/stats/moves — same core visual as the Draft Complete screen, without its draft-in-progress action buttons (Submit/Challenge/Share), since this is for looking at someone *else's* build.
- **Daily Rival renamed to Cal** — display text and the `playerName` passed to `autoDraft` only. The underlying seed key (`dailyrival:${dateStr}`) and internal uid (`__rival__`) were deliberately left unchanged, so this is a pure rename — nobody's daily results shift because of it.

**A real, non-obvious bug found while building this, not present before:** the first version of the Watch feature showed the wrong winner about half the time. `renderBattle()`'s "You win!"/"You fell short" verdict was hardcoded to the "a" (challenger) side — completely correct for the Elite-4 gauntlet, where the player's own mon is *always* passed as "a" — but daily matchups don't work that way: which player ends up "a" vs "b" for a given pair depends on their original index order when the round-robin was computed, not on who's currently watching. Viewing a matchup from the side that happened to be "b" showed the *other* player's verdict. Caught by a test that specifically checks the replayed verdict agrees with the win/loss already shown in the matchups list (which the bug violated), not just that the screen renders. Fixed with an explicit `viewingSide` option that defaults to `'a'` — every existing caller (gauntlet, individual throne challenges) is completely unaffected — and `renderDailyMatchups` now passes the correct side per matchup.

New `tools/test/daily.smoke.mjs` (properly registered, runs as part of `npm run test:smoke`, not just a manual dev check) seeds several players' daily entries directly and drives the real controller via `params.view='results'` — the same route the main menu's "Results" button uses — to reach a genuine multi-player results screen without needing to draft through the UI for each fake opponent.

### Multiplayer room sharing (Online + both Cycling Road modes)

| Location | Files |
|---|---|
| `docs/js/` | `main.js` (1.5.0) |
| `docs/js/lib/` | `dom.js` (1.2.0), `share.js` (1.5.0) |
| `docs/js/modes/` | `online.js` (1.6.0), `race.js` (2.3.0) |
| `tools/test/` | `online.smoke.mjs`, `race.smoke.mjs`, `race-teams.smoke.mjs` |

"Join my game" + a few relevant details (kept short on purpose, not every setting) + a deep link that pre-fills the room code so the recipient doesn't have to type it in:

- `main.js`'s `parseHash()` now supports a query string (`#/online/2?code=ABCDEF`), threaded through `route()`/`launchMode()` into the controller's `params.query`.
- New shared `share.js` helpers: `roomJoinLink(modeId, gen, code)` (the deep link) and `buildRoomInviteText({gameLabel, details, link})` (the message text).
- New shared `dom.js` helper `shareSheetEl(text, opts)` — extracted from draftbattle.js's existing local `showShareSheet` so online.js's and race.js's new "📤 Share Room" button use the identical WhatsApp/Copy/Close UI instead of three near-duplicate builders.
- Online: Gen, RTG/GTR, win target. Cycling Road: Gen, target Pokémon count, and a Team Mode note when relevant.
- Opening the link goes straight to the join screen with the code already filled in (a single tap on Join finishes it) — deliberately *pre-filled*, not auto-submitted, so an accidental open (e.g. a messaging app's link-preview bot) can't silently join a room.

Tested end-to-end in all three modes: the invite text contains the right details and a link that decodes back to the room's actual code, and a second simulated client opening that link (via the same `params.query` mechanism a real deep link would populate) lands pre-filled and joins successfully.

### Victory Road: tier preview didn't reflect the #6 rework

| Location | Files |
|---|---|
| `docs/js/modes/` | `victoryroad.js` (1.3.1) |
| `tools/test/` | `victoryroad.smoke.mjs` |

The pre-game tier preview built its clue list by iterating `tier.slots` — but the #6b combined weakness/resistance reveal is handled as a special case in `nextMon()` (`tier.weakResistCap`), not a plain slot, so it was completely invisible in the preview for Tiers 3–8 (and the "N clues" summary undercounted by one) even though it genuinely appears during play. Confirmed empirically (drove the real preview screen, expanded Tier 3, saw 10 listed clues with no mention of weakness/resistance) before fixing, and again after (now shows "Weakness/Resistance (up to 6)" and the count is 11). Also re-verified the tier 1/2/7/8 boundaries and clue lists are still correct end-to-end, per your request to double check gameplay behavior alongside the preview fix.

### An avoidable mistake, caught and fixed before it reached you

While updating `MANIFEST.md` for this batch, a Python script mixing JS-style `\uXXXX` unicode escapes inside a Python string triggered a `UnicodeEncodeError` on write — and Python's `open(file, 'w')` had already truncated the file to empty before the write itself failed, since opening in write mode clears the file immediately regardless of whether the write succeeds. This is a genuine gap in my own process worth naming plainly: I don't yet always take a backup copy before a scripted rewrite of an important file, and this is exactly the failure mode that habit exists to catch. Recovered by copying `/mnt/project/MANIFEST.md` (the original project file, dated 2026-07-02 — before Phase 5 began) and rebuilding forward from it using this document's own Phase 5 history, then cross-checking the version number in every touched file's own header against what the rebuilt document claimed (this caught two real transcription slips: `main.js` and `share.js` had been updated in code but their own version headers were never actually bumped — fixed both). No code was lost; only `MANIFEST.md` was briefly empty, and it's now been verified accurate line-by-line, not just restored.

**Full test tally after Phase 6:** 696 unit + 408 smoke = 1104 assertions, all green.

### Going forward
Per your request, from now on every batch's summary will end with an explicit list of exactly which files changed, so you don't have to re-upload files that haven't moved.

---

## Phase 6 continued — MANIFEST recovery verified, "Player's" mon-name bug, two real test flakes root-caused and fixed, Victory Road clue reorder

### MANIFEST.md cross-check against your uploaded prior copy

You uploaded the actual previous `MANIFEST.md` so it could be checked against the reconstruction from last time. Comparing them line-by-line found two real gaps: a legitimate cross-reference row (`docs/js/lib/draft-adapter.js → See "Shared libraries" above`) had been mistakenly deleted as if it were a stale duplicate, and two test-file rows (`throne.smoke.mjs`, `share.test.mjs`) were missing entirely. All three restored. Also cross-checked every touched file's own `@version` header against what the rebuilt document claimed for it — file headers are the actual source of truth, not the manifest — which caught two more real slips: `main.js` and `share.js` had gotten real code changes in the previous batch but their version headers were never actually bumped. Fixed both.

### "Player's" Pokémon — the drafted mon's name never used the player's real screen name

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.13.1) |
| `tools/test/` | `throne.smoke.mjs` |

`startDraft()` constructed every `DraftSession` without ever passing `playerName` at all, so `DraftSession`'s own default (`'Player'`) was always used — "Player's Feraligatr" regardless of who was actually playing. This affected free-play, the daily, the Elite-4 gauntlet's share text, and the daily results table alike, since they all eventually read the same `result.name`.

The fix needed a bit of care: `DraftSession.result()` reads `playerName` live, not just once at construction, so the first version of this fix set `playerName` correctly when identity was already resolved and otherwise kicked off a background `lazyIdentity()` call to correct it later. That's provably too fragile — a test driving the draft to completion via a tight scripted loop reached "Draft Complete" before the identity promise resolved, so the mon's name was still "Player's" at the moment `.result()` got called and cached. Fixed properly instead: identity is now resolved **in parallel** with the data fetches (movelist/movestats/draftpool/typechart) that were already being awaited before the draft screen appears, so there's no added latency and no race — by the time `startDraft()` runs, identity is always already settled, for both free-play and the daily flow (which resolved it even earlier already).

New assertions in `throne.smoke.mjs` confirm the drafted mon's name uses the real identity name for both the free-play and daily-variant flows, and that the literal fallback string "Player's" never appears when a real name is available. (One thing worth being upfront about: my first attempt at this specific assertion used the wrong apostrophe character — a curly `'` instead of the straight `'` the code actually uses — which looked like a second bug until a targeted diagnostic showed the underlying fix was correct all along and the test itself was just wrong. Fixed the test, then re-verified the fix's regression guard properly afterward.)

### Two real, intermittent test flakes — root-caused and fixed, not just re-confirmed

You asked me to either fix the "single: ran out of points" flake or tell you what to do about it — didn't want to just leave it as "known flaky." Investigated both this one and a second flake that surfaced in the same run (`mp-cluemode.smoke.mjs`'s random-reveal check) down to their actual root causes rather than accepting "sometimes fails" as an answer:

- **`modes.smoke.mjs` — "ran out of points."** The test bought every affordable clue card in a loop, assuming that would always eventually exhaust the difficulty's starting points. That's not guaranteed for every possible random mystery — if a mystery's total available clue cost happens to be less than the starting budget, the loop runs out of things to buy while points remain, and the game never reaches game-over. Fixed by falling back to repeated wrong guesses (which do cost points) once no more cards are clickable — 15/15 clean runs after the fix, versus a real (if infrequent) failure before it.
- **`mp-cluemode.smoke.mjs` — "the random-reveal button DID reveal a clue."** Root-caused via direct instrumentation (not guessing): the weighted-random reveal formula heavily favors cheap clues, and one of the cheapest is "Reveal One Egg Move" — a multi-use clue. Multi-use clues never get the `.revealed` CSS class after just one use (only once fully exhausted, matching `single.js`'s established pattern), so whenever the random pick happened to land on one, the test's `.clue-btn.revealed` count check saw no change and failed — even though a real reveal had genuinely happened. Took ~90 scripted runs to actually catch it in the act with diagnostics, since the failure rate is low (the weighted formula doesn't pick a multi-use clue every time). Fixed by checking the revealed-clues panel's entry count instead, which is correct regardless of clue type — found and fixed the identical latent issue in the adjacent By-category test too, before it could surface as its own separate "random" flake later. 60/60 clean runs after the fix.

Both fixes verified with the standard revert-and-confirm-it-fails check, same as every other fix this project.

### Victory Road: clues reordered into logical groups

| Location | Files |
|---|---|
| `docs/js/modes/` | `victoryroad.js` (1.4.0) |
| `tools/test/` | `victoryroad.smoke.mjs` |

Reordered the ribbon to group clues by the same 7 categories used throughout the rest of the app (Habitat, Evolution, Type Matchups, Stats, Trainer Usage, Movesets, Anime), in that order — weaknesses/resistances now sit right next to type/immunity info, both stat clues sit together, Trainer Usage sits between Stats and Movesets, Anime is last, matching your explicit examples.

This needed two passes to actually work. The first pass rewrote the two ordering arrays (`RIBBON_ORDER_SPECIALS`/`RIBBON_ORDER_FIELDS`) into the new category groups and looked correct on inspection — but empirically checking the *rendered* ribbon showed it hadn't changed at all. The actual bug was in `chipOrder()` itself, not the arrays: it added +100 to any clue matched by `field` rather than `special`, which silently pushed every clue with `special: undefined` (habitat, evoStage, bstRange, fullStats, gymLeader — a majority of the clue set) to the very end regardless of which array position it occupied. Reordering the arrays could never have worked while that offset existed. Replaced the whole two-array-plus-offset design with a single unified priority map keyed by whichever identifier a clue actually has, which doesn't have anywhere for that kind of trap to hide.

New assertions in `victoryroad.smoke.mjs` check the actual rendered chip order at both Tier 1 (no weakness/resistance yet) and Tier 3 (has it) — confirmed against a revert-and-fail check same as everything else.

**Full test tally after this batch:** 696 unit + 419 smoke = 1115 assertions, all green, stable across repeated runs.

### Files changed this batch
- `docs/js/modes/draftbattle.js`
- `docs/js/modes/victoryroad.js`
- `tools/test/throne.smoke.mjs`
- `tools/test/modes.smoke.mjs`
- `tools/test/mp-cluemode.smoke.mjs`
- `tools/test/victoryroad.smoke.mjs`
- `MANIFEST.md`, `CHANGE_TRACKER_v3.md`, `TESTING_CHECKLIST.md`

---

## Phase 6 continued — throne cascade bug, Elite 4 scaling investigation, sharing UX overhaul

### Bug: "I already own the highest spot" incorrectly blocked a legitimate claim

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.14.0) |
| `tools/test/` | `throne.smoke.mjs` |

You beat Will with a new draft, but claiming that spot was blocked because you already held a higher throne — with a *different* Pokémon. You confirmed the intended rule: **a single Pokémon can only hold one spot, but a player can hold as many spots as they want.**

The bug was exactly a mismatch between those two rules. `claimThrone()`'s cascade check compared `holderUid` — "does this same PLAYER hold another throne?" — when it should have been asking "does this same POKÉMON hold another throne?" Fixed by comparing the mon's own name + exact base stats (effectively unique per draft — two independent drafts coincidentally producing the same species name *and* all six random stats is astronomically unlikely) instead of who's playing.

Verified two ways, both against real gauntlet runs (not just the pure decision function, which was never the buggy part):
- The exact reported shape — already holding a higher throne with mon A, drafting a genuinely different mon B, beating Will with it, losing to Koga with it — now succeeds and leaves both thrones intact, each with its own mon.
- The cascade still correctly triggers when it's genuinely the *same* mon holding two spots (built by pre-seeding a lower throne with the exact shape a known deterministic seed produces, then letting that seed's mon claim the top spot in one clean run — avoided a "re-fighting your own prior claim" edge case that a more naive two-live-runs approach ran into first).

One thing worth flagging: this test's setup, like the existing `WINNING_SEED`, relies on a specific seed's mon beating one NPC and losing to another *for today's specific date* — Will and Koga's NPCs are period-keyed (daily/weekly), so the exact seed that reproduces this shape can drift over time. Hit this firsthand while building the test: a seed found earlier in this session no longer matched by the time the fix was verified, because the Central-Time date had rolled over in between. Documented inline in the test (the same way `WINNING_SEED`'s own comment already does) so it's easy to re-find if it ever needs it.

### Elite 4 scaling: investigated, not yet changed — needs your call

You asked whether the Will→Koga stat-band scaling might be too harsh, given a 98%→4% swing. Ran two rounds of analysis rather than guessing:

**First finding — the swing is common, not unlucky.** Drafted 24 different builds through the real UI and ran each through the actual gauntlet (today's real NPCs, not a simulation with made-up seeds). Of those: 6 lost to Will outright, **10 beat Will but lost to Koga** (the exact shape you hit), and only 2 swept every tier. "Beat Will, lose to Koga" is the single most common outcome, not a rare bad-luck result.

**Second finding — the swing is mostly the type-matchup lottery, not the stat gap itself.** Held ONE player mon fixed and generated 10 different "Koga" NPCs, all within the identical stat band (475–500 BST) with nothing else changed. Win rate across those 10 ranged from **29% to 100%** — with the stat band held completely constant. Each tier's NPC is a single, fixed roll (shared by every player for that day/week/etc., not re-rolled per attempt), so an unlucky type/moveset matchup on the NPC's side can swing the outcome dramatically on its own, independent of how the stat bands are tuned.

Put together: the stat bands (Will 425–450 → Koga 475–500, roughly a 50-BST jump against builds that typically average somewhat lower) do represent a real, intentional difficulty increase — beating Koga *given you already beat Will* only happened in about 44% of the sample, not just noise. But the variance riding on top of that, from the single-NPC-roll design, is large enough that any individual player's experience can look far more extreme than the "intended" curve suggests — a great matchup or a terrible one can each happen to anyone.

**Not changed yet, because this is a balance/feel question, not a clear bug** — I don't want to unilaterally re-tune the stat bands or the NPC-generation approach without your input. A few concrete directions if you want to soften it, roughly in order of how much they'd change:
1. **Narrow the stat bands** (e.g. smaller gaps between consecutive tiers) — reduces the baseline difficulty jump, but wouldn't touch the type-matchup variance, which the data suggests is the bigger factor.
2. **Reduce matchup-lottery extremes** — e.g. generate a few candidate NPCs per tier and pick one that isn't an extreme outlier against a "typical" build, instead of a single uncontrolled roll. Targets the actual dominant factor, but is a more involved change to the NPC-generation logic.
3. **Leave it as-is** — real Pokémon team-building is often decided by type matchups more than raw stats, and the existing "redraft to find a better matchup against this period's NPCs" counter-play already exists. The variance could be read as a feature, not a flaw.

Let me know which direction (if any) you'd like, and I'll implement it.

### Sharing UX: investigated and replaced — no longer "sharing an image"

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.14.0) |
| `tools/test/` | `throne.smoke.mjs` |

Confirmed the specific problem: `shareDraftedMon()` (Draft Complete's "📤 Share My Pokémon") and `shareGauntletResult()` (the gauntlet results' consolidated "📤 Share") both tried `shareMonCardImage()` first — the Web Share API with a canvas-rendered PNG card. On any browser without full file-share support (common on desktop, and plenty of mobile browsers too), the fallback path **silently downloaded that PNG as a side effect** — an unexplained file just appearing — and on mobile, handed off to the OS's own native image-share sheet instead of this app's consistent WhatsApp/Copy/Close toast used for everything else (daily results, room invites).

Replaced both with the same text-only pattern used everywhere else in the app: build a plain-text summary (name + types + moves for the mid-draft share; the existing achievement-focused text for the gauntlet share) and show it through the shared `shareSheetEl` (dom.js) — the same WhatsApp/Copy/Close toast, same behavior, everywhere. Also noticed while doing this that `draftbattle.js` had its *own* local duplicate of `showShareSheet`, even though it was the original implementation `shareSheetEl` had been extracted *from* for online.js's/race.js's room sharing — it now calls the shared one instead of maintaining a second copy.

`shareMonCardImage`/`buildMonCardPlan`/`drawMonCardToCanvas` are left in `share.js`, still exported and still covered by `share.test.mjs` — nothing was deleted, just no longer called from these two spots. If you ever want a genuinely separate "save as image" feature (not bundled into the share flow), that infrastructure is still there to build on.

**Full test tally after this batch:** 696 unit + 433 smoke = 1129 assertions, all green.

### Files changed this batch
- `docs/js/modes/draftbattle.js`
- `tools/test/throne.smoke.mjs`
- `MANIFEST.md`, `CHANGE_TRACKER_v3.md`, `TESTING_CHECKLIST.md`

---

## Phase 6 continued — Elite 4 band narrowing, draft duplicates, grammar fix, throne history Inspect, stat-spread labels everywhere, Safari's endGame() crash

### Elite 4 stat bands narrowed (analytical decision — flag if you disagree)

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.15.0) |

Reduced the inter-tier gap from 50 BST to 30 BST: **Will 425–450 (unchanged), Koga 455–480 (was 475–500), Bruno 485–510 (was 525–550), Lance 515–540 (was 575–600).** Total Will-to-Lance span dropped from 175 to 115 (~34% narrower).

Reasoning, following up on the earlier investigation: the data showed the stat gap IS a real contributor (beating Koga given you'd already beaten Will only happened ~44% of the time in the original sample), but the type-matchup lottery was the larger one (29%–100% swing at a FIXED stat band). Narrowing by roughly a third knocks down the stat-driven component without pretending the matchup-lottery variance isn't still the bigger factor — "stats still matter, but the other things matter more," per what was asked for.

Verified by re-running the same 24-build sample against the new bands: "beat Will, lose to Koga" dropped from 42% to 12.5% of outcomes, and full sweeps roughly doubled (~8% → ~17%). The distribution is now spread more evenly across all five stopping points instead of clustering hard at one specific transition.

**If you want a different number, easy to adjust** — the four bands are four numbers in one array in `draftbattle.js`.

### Draft: no Pokémon can appear more than once in a single draft

| Location | Files |
|---|---|
| `docs/js/` | `draft.js` (0.9.0) |
| `tools/test/` | `draft.test.mjs`, `throne.smoke.mjs` |

`_speciesAt()` picked a species purely at random from the full pool every card, with no memory of what had already been shown — the same species could legitimately appear on two different cards in one draft. Fixed with a `_seenSpecies` set, populated the moment a card is displayed (a card you reroll past counts as "shown" too, not just one you took a pick from), and consulted as an exclusion filter on every subsequent pick.

This is a real behavior change for existing seeds, since it can shift which card gets shown from the point a repeat would have occurred onward — confirmed empirically: `WINNING_SEED` (the deterministic "sweeps every Elite-4 tier" seed used throughout the test suite) had drawn the same species twice under the old behavior, so once repeats were excluded, that seed's greedy draft produced a different final mon that no longer swept every tier. Re-searched and found a new one (seed 12 → Machamp).

**A genuine testing lesson from this pass:** the first version of the regression test used a 30-seed sample and it passed even with the fix completely reverted — not because the fix was wrong, but because 30 random seeds simply didn't happen to include a collision often enough to guarantee catching it (a rough birthday-paradox calculation puts it around an 18% chance per seed, and it's still probabilistic which seeds hit it). Widened to 150+61 seeds specifically so the revert-and-confirm-it-fails check would be reliable, not just "probably" reliable.

### Sharing grammar: "beat my Ash's Kangaskhan" → "beat my Kangaskhan"

| Location | Files |
|---|---|
| `docs/js/lib/` | `share.js` (1.5.1) |
| `tools/test/` | `share.test.mjs` |

`monName` is generally `"{playerName}'s {species}"`, and the "beat my ___" / "with my ___" phrases were plugging that whole string in verbatim — two possessives fighting each other. Added a small helper that strips the "PlayerName's " prefix specifically in those two phrases (gauntlet and throne kinds both had the identical issue, though only the gauntlet one is currently reachable in the live app — throne's own version is fixed too since it's still exported/tested code, and the same bug would resurface if it's ever wired back up). Other uses of `monName` that aren't a possessive clash (e.g. "My Elite 4 challenger: Ash's Kangaskhan") are left exactly as they were.

### Throne History: added the requested Inspect button

| Location | Files |
|---|---|
| `docs/js/modes/` | `draftbattle.js` (1.15.0) |
| `tools/test/` | `throne.smoke.mjs` |

Each row in a throne's History screen now has a 🔍 Inspect button, matching the Daily Draft's pattern exactly — same read-only card, same "← Back" return path. One prerequisite fix needed first: the history entries being pushed to Firebase never included `moves` at all (only name/types/baseStats), so there was nothing for Inspect to show for a historical champion's moveset — added it to both push call sites (the normal-claim path and the cascade-vacate path).

### Stat spread labels: fixed everywhere, not just Safari

| Location | Files |
|---|---|
| `docs/js/modes/` | `single.js` (1.2.3), `safari.js` (1.3.0, see below), `multiplayer.js` (1.3.3), `online.js` (1.6.1) |
| `tools/test/` | `modes.smoke.mjs`, `mp-cluemode.smoke.mjs`, `online.smoke.mjs` |

Reported for Safari specifically, but checking single.js and multiplayer.js (per your follow-up) turned up the identical gap in both. The "Reveal Full Stat Spread" clue was rendering as a bare `"63/60/60/130/50/65"` string in every mode's in-game clue card EXCEPT Victory Road's ribbon and single.js's own post-game summary screen — both of those already used the shared `statSpreadEl` (dom.js) for the labeled HP/Atk/Def/... version; the four in-game clue renderers (single, safari, multiplayer, online) just never had. Fixed all four the same way, keyed off `clue.field === 'fullStats'`, matching Victory Road's existing detection pattern.

### Safari Zone: a real, significant crash, plus the requested safeguard

| Location | Files |
|---|---|
| `docs/js/modes/` | `safari.js` (1.3.0) |
| `tools/test/` | `modes.smoke.mjs` |

You described three things together: the game not ending, no post-game summary, and the score missing from the leaderboard. Found the actual cause, and it explains all three at once: `endGame()`'s call to `submitScore(...)` referenced `done.caught`, `done.startPts`, and `ptsUsed` — but all three of those were declared with `const` further down in the *same function*, meaning every single call to `endGame()` threw a `ReferenceError` (JavaScript's temporal-dead-zone rule) before it ever reached the line that builds the summary screen. So: the summary never rendered (game looked stuck), and `submitScore()` never actually ran (the exception happened on that exact statement, before the call could execute) — one bug, three symptoms. Reordered the three declarations to come first.

Verified concretely, not just "doesn't throw": drove a real game to zero points and confirmed the summary screen appears with real Caught/Budget/Spent numbers (not `NaN`/`undefined`, which would indicate the ordering bug persisting in some other form), and confirmed via the test output that `submitScore()` now genuinely gets invoked (it fails inside the test environment for an unrelated, expected reason — no real Firebase available there — but critically, it now *reaches* that point at all, which it never did before).

**Also added the requested safeguard:** Bait and Rock (the two random-clue actions) now exclude any clue whose cost would leave less than 1 point of the shared budget, so a random reveal alone can never zero it out. Manual clue selection is untouched, matching what was specifically asked for (random clues only). This needed real care to test properly: with a fixed test RNG that always picks the pool's first entry, the "does it ever drop below 1" question only actually gets exercised when a clue's cost happens to exactly equal what's left — a narrow condition that a "test several budget levels and hope" approach didn't reliably hit. Ended up precisely engineering it instead: a throwaway probe session discovers the exact cost of the first Bait pick at a comfortable budget, then the real test drives the budget down to exactly that number before clicking Bait once, guaranteeing the exact edge case gets tested every run.

(Along the way, a couple of my own diagnostic scripts had bugs of their own — one searched for a button by the wrong label text, another accidentally left the safeguard reverted mid-investigation. Worth naming plainly rather than glossing over, since it's part of why this one took a few passes to pin down properly.)

### Victory Road: minor desktop text wrap (low priority, per your note)

| Location | Files |
|---|---|
| `docs/js/modes/` | `victoryroad.js` (1.4.1) |
| `docs/css/` | `styles.css` (1.14.4) |

Two small things, bundled together since both were about the same shared `.sf-intro` style:
- **The centering bug** you flagged on the Elite 4 status screen was actually general to `.sf-intro`: `max-width` without `margin:auto` for left/right meant the block sat left-aligned within any wider parent, even though its own text was `text-align:center`. Fixed at the CSS rule itself (`margin:auto` is a no-op for anything already narrower than its parent, so this can't have changed how it looks anywhere it wasn't visibly broken).
- **The Victory Road intro line wrapping unnecessarily on desktop** — you said not a big deal and mobile's the priority, so kept this deliberately minimal: removed the `max-width` constraint for just that one paragraph via an inline style override, leaving the shared CSS rule (and every other screen using it, including mobile) completely untouched.

**Full test tally after this batch:** 913 unit + 464 smoke = 1377 assertions, all green, stable across repeated runs.

### Files changed this batch
- `docs/js/lib/share.js`
- `docs/js/draft.js`
- `docs/js/modes/draftbattle.js`
- `docs/js/modes/single.js`
- `docs/js/modes/safari.js`
- `docs/js/modes/multiplayer.js`
- `docs/js/modes/online.js`
- `docs/js/modes/victoryroad.js`
- `docs/css/styles.css`
- `tools/test/share.test.mjs`
- `tools/test/draft.test.mjs`
- `tools/test/throne.smoke.mjs`
- `tools/test/modes.smoke.mjs`
- `tools/test/mp-cluemode.smoke.mjs`
- `tools/test/online.smoke.mjs`
- `MANIFEST.md`, `CHANGE_TRACKER_v3.md`, `TESTING_CHECKLIST.md`


