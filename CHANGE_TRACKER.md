# 25-Point Change Tracker

Status of every feedback item and the files each one touches. The "Files to
upload" list at the bottom is the complete set to copy into the repo.

Status key: ✅ done · ⚠️ done with a note

## Draft / Elite 4 / Daily / Share

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | "Daily Rival" dummy to compete against | ✅ | `docs/js/modes/draftbattle.js` |
| 2 | Daily entries not saving | ✅ write verified + errors surfaced | `docs/js/modes/draftbattle.js` |
| 3 | Throne "offline" banner | ✅ reflects real connection now | `docs/js/modes/draftbattle.js` |
| 4 | Rename thrones → Elite 4 | ✅ | `docs/js/modes/draftbattle.js` |
| 5 | Remove "501 sims" wording | ✅ | `docs/js/modes/draftbattle.js` |
| 6 | Reset cadences | ✅ verified + copy clarified | `docs/js/modes/draftbattle.js` |
| 7 | Champion history per tier | ✅ Firebase + History view | `docs/js/modes/draftbattle.js`, `database.rules.json` |
| 8 | ①②③④ / 👑 badges (no robot) | ✅ | `docs/js/modes/draftbattle.js` |
| 9 | Share unrenderable boxes | ✅ plain ASCII | `docs/js/lib/share.js` |
| 10 | Share → "I beat ___", no meter | ✅ | `docs/js/lib/share.js`, `docs/js/modes/draftbattle.js` |

## Main menu / structure

| # | Item | Status | Files |
|---|------|--------|-------|
| 11 | Cards 3 columns wide | ✅ (3→2→1 responsive) | `docs/css/styles.css` |
| 12 | Multiplayer own section; "Hotseat" | ✅ | `docs/js/modes.js` |
| 13 | "Race – coming soon" card | ✅ | `docs/js/modes.js` |
| 16 | Show generation clearly everywhere | ✅ gen label/toggle on Single, Safari, Victory Road, Pokédex (list + card); Hotseat/Online already show it | `docs/js/lib/dom.js` (`genBar`), the four modes, `docs/css/styles.css` |

## Single-player UX

| # | Item | Status | Files |
|---|------|--------|-------|
| 15 | Guesses from the list only | ✅ engine rejects unknown (no penalty) + on-screen message | `docs/js/lib/engine.js`, `single.js`, `safari.js`, `victoryroad.js` |
| 19 | "Enter the Safari Zone" | ✅ | `docs/js/modes.js`, `docs/js/modes/safari.js` |
| 20 | Revealed-clue list (gold = latest, resets per mon) | ✅ Single (existing) + Safari (added); VR shows its tier ribbon | `docs/js/modes/safari.js`, `docs/css/styles.css` |
| 21 | List of guessed Pokémon | ✅ Single + Safari. ⚠️ Victory Road is one-guess-per-mon, so a list doesn't apply | `docs/js/modes/safari.js` |
| 22 | Safari bait −1 / rock −2 discount + explanation | ✅ | `docs/js/modes/safari.js`, `docs/css/styles.css` |
| 23 | Victory Road new-tier banner + clues lost | ✅ | `docs/js/modes/victoryroad.js`, `docs/css/styles.css` |

## Pokédex

| # | Item | Status | Files |
|---|------|--------|-------|
| 17 | Remove duplicated yellow stat spread | ✅ | `docs/js/modes/pokedex.js` |
| 18 | Toggle Gen 1/2 without returning to menu | ✅ Pokédex list + the three single-player intros | `docs/js/lib/dom.js`, `pokedex.js`, `single.js`, `safari.js`, `victoryroad.js`, `docs/js/main.js` |

## Online / Hotseat polish

| # | Item | Status | Files |
|---|------|--------|-------|
| 24 | Online create-form header spacing | ✅ | `docs/css/styles.css` |
| 25 | Hotseat player 1 = signed-in name | ✅ | `docs/js/modes/multiplayer.js` |

## Notes / decisions
- Google sign-in: not adding now (anon + name/PIN covers cross-device). Logged as a future enhancement.
- #21 Victory Road: intentionally omitted (single guess per Pokémon). The #15 fix also means a typo no longer ends a Victory Road run.

## Files to upload (complete cumulative set)
**docs/js:** `main.js` (1.2.0), `modes.js` (1.4.0), `lib/dom.js` (1.1.0), `lib/engine.js` (1.1.0), `lib/share.js` (1.1.0), `modes/draftbattle.js` (1.4.0), `modes/single.js`, `modes/safari.js`, `modes/victoryroad.js`, `modes/pokedex.js`, `modes/multiplayer.js`
**docs/css:** `styles.css` (1.8.0)
**repo root:** `database.rules.json` (re-paste into Firebase), `GUESS_LOGIC.md`, `MANIFEST.md`, `CHANGE_TRACKER.md`
**tools/test:** `engine.test.mjs`, `mp-rules.test.mjs`, `run.mjs`, `online.smoke.mjs`, `modes.smoke.mjs`

Tests: `node tools/test/run.mjs` → **402 passed**; dev smokes — `modes.smoke.mjs` 9/9, `online.smoke.mjs` 25/25, draft `smoke`/`smoke2`/`smoke-daily` all green.
