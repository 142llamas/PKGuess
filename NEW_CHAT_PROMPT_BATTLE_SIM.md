# PokéGuess — Battle Simulator: New Chat Prompt

This is the prompt to paste as your **first message** into a fresh chat, along
with the files listed below, when you want a session focused **only** on
`sim.js` (the Draft Battle simulator) — not the guessing games, not Cycling
Road, not identity/leaderboards. Keeping the scope narrow means the chat
doesn't have to load context it doesn't need, and won't accidentally touch
unrelated files.

---

## The prompt to paste

```
This chat is dedicated SOLELY to the battle simulator in my PokéGuess project
— the file docs/js/sim.js, which decides Draft Battle / Elite 4 / Daily Puzzle
outcomes. Do not touch the guessing games (engine.js), Cycling Road (race.js),
online multiplayer (online.js), identity, or leaderboards — those are out of
scope for this chat.

I've attached: sim.js itself, draft.js and draft-adapter.js (the drafting
logic that feeds sim.js and shares its move-ban list), draftbattle.js (the UI
that calls the simulator and renders its battle log — many past bugs were the
simulator computing something correctly but the UI silently failing to show
it), the four data files sim.js reads (movestats, typechart, pokedex, and the
draft movepool overrides), the existing test suites (sim.test.mjs,
sim-status.test.mjs, run.mjs, _harness.mjs), and MANIFEST.md +
CHANGE_TRACKER_v3.md for full current-state and history context.

Please start by reading MANIFEST.md's entries for sim.js/draft.js/
draftbattle.js and the "Known, disclosed gaps" section at the bottom, so
you're caught up on what's already been fixed, what's a deliberate
simplification, and what's still open — then tell me you're ready and ask what
I'd like to work on.

Conventions to follow (already established in this project):
- Every code file has an @file/@version/@updated/@changelog header — versions
  live IN the file, never in the filename. Bump it on every change.
- Before calling any fix done: write or extend a real test, run the full
  suite, then REVERT your fix and confirm the test actually fails, then
  restore the fix and confirm it passes again. Don't skip the revert-check —
  it's caught real false-positive tests in this project before.
- After a batch of changes, update MANIFEST.md (current-state row per file)
  and CHANGE_TRACKER_v3.md (append a new dated section explaining what changed
  and why) — and tell me EXACTLY which files changed so I know what to
  re-upload, since files I don't re-upload stay on old versions.
- Full test command: `npm test` (unit) and, if a fake-Firebase draft/throne
  smoke test is relevant, `npm run test:smoke`. sim.js itself has no Firebase
  dependency — pure logic — so sim.test.mjs / sim-status.test.mjs via
  `node tools/test/run.mjs` is usually all you need for a sim-only change.
```

---

## Files to include

### Essential — the simulator and what directly feeds it

| File | Why it's needed |
|---|---|
| `docs/js/sim.js` | The simulator itself. Everything lives here: damage formula, type effectiveness, crits, status effects (burn/poison/toxic/paralysis/freeze/sleep/confusion), stat stages (including accuracy/evasion), priority & turn order, multi-hit, two-turn/charge moves, recharge, Reflect/Light Screen, and every move-specific special case (Curse, Belly Drum, Rest, Pain Split, Leech Seed, Jump Kick crash, OHKO, etc.) via the `MOVE_EFFECTS` table. |
| `docs/js/draft.js` | Vetted drafting engine (`DraftSession`, `autoDraft`, `autoDraftScaled`, `resolveThroneCascade`, `buildLearnsetMap`). Relevant to sim work because it owns the **banned-move list** (moves excluded from the draftable pool — several were banned specifically because they don't fit a switchless 1v1 sim) and because `autoDraftScaled` generates the Elite 4 NPCs' stats that `sim.js` then battles against. |
| `docs/js/lib/draft-adapter.js` | Thin re-export shim — lets `draftbattle.js` import the spec-locked `draft.js`/`sim.js` without editing the originals directly. Small, but you'll see it in every import chain. |
| `docs/js/modes/draftbattle.js` | The UI controller: calls `runMatch`/`simulateBattle` and **narrates the battle log**. Genuinely important for sim work — this project has repeatedly found cases where the simulator computed an effect correctly but the renderer's `default: continue` silently dropped the event, so nothing appeared on screen even though the mechanic worked underneath. Any new sim.js event type needs a matching narration case added here. |

### Essential — data sim.js reads

| File | Why it's needed |
|---|---|
| `docs/data/movestats-gen2.json` | Every move's base power, accuracy, type, category, PP, priority — the actual numbers the simulator's formulas use. (Gen 1 mirrors Gen 2 for this data.) |
| `docs/data/typechart-gen2.json` | Type-effectiveness multipliers, consulted by the damage formula. |
| `docs/data/gen2.json` | Pokémon base stats/types — used to build the two combatants at the start of a battle. |
| `docs/data/draftpool-gen2.json` | Draft-specific movepool overrides (e.g. Smeargle's special case). |

### Essential — tests

| File | Why it's needed |
|---|---|
| `tools/test/sim.test.mjs` | Broad mechanic coverage: stat conversion, moveId, recoil/drain/multi-hit/two-turn/recharge/OHKO/high-crit/fixed-damage/guaranteed-status, and all the special-cased moves. |
| `tools/test/sim-status.test.mjs` | **Exact-value** verification (not just "it happened") for status effects, stat-stage math, sleep/Reflect/Light-Screen/accuracy/evasion/speed — the harness pattern here (mono-move specs, round HP=400 for clean fractions, seed-sweeping for probabilistic effects) is the one to follow for any new test. |
| `tools/test/run.mjs` | The test runner — imports every suite and prints one summary. Run via `node tools/test/run.mjs`. |
| `tools/test/_harness.mjs` | Defines the `t.section`/`t.ok`/`t.eq`/`t.note` helpers both test files use. |

### Recommended — project state & history

| File | Why it's needed |
|---|---|
| `MANIFEST.md` | The authoritative **current-state** snapshot — version + a description of what each file does right now, including every disclosed simplification (Magnitude/Return/Frustration's flat power, Jump Kick's crash-damage estimate, the Fairy-type historical retag) in its "Known, disclosed gaps" section at the bottom. Read this FIRST in any new chat. |
| `CHANGE_TRACKER_v3.md` | Full chronological history of **why** things changed. It's large (covers the whole project, not just the sim), but the sim-specific batches are easy to find by searching for "sim.js" or "battle" — worth keeping for context on decisions already made (e.g. why OHKO/Tri Attack/Magnitude were fixed the way they were), so you don't re-litigate settled questions. |

### Optional — only if the specific task touches these

| File | When you'd need it |
|---|---|
| `tools/test/draft.test.mjs` | Only if the change touches `draft.js` itself (drafting mechanics, `autoDraftScaled`, throne cascade) rather than `sim.js`'s battle math — it doesn't import `sim.js` at all. |
| `tools/test/throne.smoke.mjs` | Drives a real Elite-4 gauntlet through the actual UI (fake Firebase). Useful if you want to verify the battle-log **playback UI** end-to-end (not just the simulator's internal event log) — this is how the Reflect/Light Screen narration gap would have been caught earlier. Heavier and slower than the pure-logic tests above. |
| `tools/test/daily.smoke.mjs` | Same idea, but drives the Daily Puzzle's matchup-replay flow instead of the gauntlet. Only needed if the task touches how battle playback is *triggered* (matchup rows, "Watch" buttons) rather than the simulator itself. |

---

## What NOT to include

Leave out anything guess-mode-related (`engine.js`, `GUESS_LOGIC.md`,
`single.js`/`safari.js`/`victoryroad.js`/`multiplayer.js`/`online.js`), Cycling
Road (`race.js`), identity/leaderboard files, and `styles.css`/`main.js` —
none of them touch the simulator, and including them just adds noise a
sim-only chat doesn't need.

## One thing worth flagging

`MANIFEST.md` and `TESTING_CHECKLIST.md` both reference a `NEW_CHAT_GUIDE.md`
("how to hand off to a fresh chat without losing context") that doesn't
actually exist in the current repo — it's a stale reference from an earlier
round that was apparently never created or got dropped. Not a sim issue, just
noting it here since you're thinking about new-chat hand-offs right now; worth
either creating it or removing the references, whenever's convenient.
