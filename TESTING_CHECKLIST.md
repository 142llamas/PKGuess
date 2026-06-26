# PokéGuess Online — Testing Checklist

A practical, click-through QA pass for the whole app. Work top to bottom: the
**Setup** section gates everything else, then test each mode. Boxes are plain
Markdown checkboxes — tick them as you go.

> Run it locally first: `cd docs && python3 -m http.server 8000` then open
> `http://localhost:8000`. (Plain `file://` will break ES-module imports.)
> Re-run the automated tests before manual QA: `node tools/test/run.mjs`
> (expect **387 passed**) and `node tools/test/online.smoke.mjs` (expect **25**).

---

## 0. Setup & deploy gates

- [ ] `docs/.nojekyll` exists (GitHub Pages must not run Jekyll on the folder).
- [ ] GitHub Pages is set to serve the **`docs/`** folder of the repo.
- [ ] All paths are **case-correct** on disk (Pages is case-sensitive): `js/lib/…`, `js/modes/…`, `js/draft.js` and `js/sim.js` live in **`js/`**, not `js/lib/`.
- [ ] `docs/data/` contains: `config.json`, `gen1.json`, `gen2.json`, `movelist-gen1.json`, `movelist-gen2.json`, `movestats-gen1.json`, `movestats-gen2.json`, `typechart-gen1.json`, `typechart-gen2.json`.
- [ ] `docs/img/silhouettes/` contains `1.png … 251.png` (keyed by Pokédex number).
- [ ] Firebase: real project config is present in `js/lib/firebase.js` and the project has **Realtime Database** + **Anonymous Auth** enabled.
- [ ] Firebase: contents of `database.rules.json` are pasted into the RTDB **Rules** tab and published.
- [ ] Open the site: no red errors in the browser console; the mode-select menu renders all tiles (Draft Battle, Daily Challenge, Single Player, Safari, Victory Road, Multiplayer, **Online**, Pokédex, Leaderboard).

---

## 1. App shell / navigation

- [ ] Each tile launches its mode; the URL hash updates to `#/<mode>/<gen>`.
- [ ] Reloading the page on a deep hash (e.g. `#/single/2`) re-opens that mode.
- [ ] The in-mode **Back/Exit** returns to the menu and the hash resets.
- [ ] Gen switch (where offered) reloads the correct dataset (Gen I = 151 mons, Gen II = 251).
- [ ] First run prompts for / stores a **display name**; it persists across reloads.

---

## 2. Single Player (test on **Gen 1** and **Gen 2**)

- [ ] Start a game on **Normal**: 50 starting points, all 7 categories shown.
- [ ] Buy a cheap clue → points drop by its cost; the clue card shows its value.
- [ ] Buy a clue you can't afford → blocked / greyed.
- [ ] **Easy**: starts at 60 pts and grants 1 free random clue (≤4 pts).
- [ ] **Medium**: Habitat & Anime categories hidden; one summary line notes what's locked.
- [ ] **Hard**: Habitat/Evolution/Trainers/Anime locked, 2nd-type reveal locked.
- [ ] **Extreme**: 30 pts; type reveals locked; full-spread stat reveal locked.
- [ ] Multi-buy clues (Weaknesses / Resistances / Egg Moves) reveal a *new* value each time and **rise in cost** per purchase.
- [ ] Prerequisite clues enforced (e.g. "Reveal Second Type" needs "Reveal One Type" first; "Highest Stat with Value" needs "Highest Base Stat").
- [ ] Wrong guess deducts the guess cost (default 1) and lets you continue.
- [ ] Correct guess ends the round; **score = points remaining**; summary screen appears.
- [ ] Guess-mode variants behave: **Anytime**, **Forced Reveal–Choose**, **Forced Reveal–Random**.
- [ ] Category-diversity options behave: **Free**, **Force Different**, **Cycle All**.
- [ ] "Submit to leaderboard" writes an entry (verify in Leaderboard / Firebase).

## 3. Safari Zone

- [ ] One shared budget spans multiple Pokémon.
- [ ] Catching (correct guess) moves to the next mon without resetting the budget.
- [ ] Running out of budget ends the run; **score = number caught**.
- [ ] Final summary lists the caught mons.

## 4. Victory Road

- [ ] Endless streak: each correct answer advances to the next.
- [ ] Higher tiers reveal **fewer** clues / get harder as described.
- [ ] One wrong answer (or budget-out, per rules) ends the streak.
- [ ] Final streak length is recorded; leaderboard submit works.

## 5. Multiplayer — hot-seat (pass-and-play)

- [ ] Set up 2–4 named players; color badges assigned (gold/blue/green/red).
- [ ] Shared **point pool** per round; clue costs deduct from the pool, not a player.
- [ ] **RTG**: each turn is reveal → guess. **GTR**: guess → (if wrong) reveal.
- [ ] **Choose** clues vs **Random** clues both work; random favours cheaper clues and avoids the just-used category.
- [ ] Correct guess: that player earns the **remaining pool**; winner rotates to the end of the order next round.
- [ ] First to the **win target** ends the match; podium + per-player stats + round history show.

## 6. Online Multiplayer 🌐 (needs **two browser tabs/devices**)

> Open the site in two tabs (ideally one normal + one incognito so they get
> different anonymous identities). Call them **A** and **B**.

- [ ] **A** → Online → *Create a room*; pick Gen / RTG-or-GTR / Choose-or-Random / win target / pool / guess cost → *Create*.
- [ ] A sees a **6-character room code** and a lobby with A listed (👑 host).
- [ ] **B** → Online → *Join with a code*; enter the code → B appears in **both** lobbies within a second or two.
- [ ] Host **Start game** is disabled until 2+ players, then starts the match for both.
- [ ] On A's turn (RTG): A reveals a clue → the **same clue + value appears for B** (answer derived locally, never sent).
- [ ] Pool, scores, and "whose turn" stay in sync across both tabs.
- [ ] A wrong guess passes the turn to the next player; the guess shows in both guess logs.
- [ ] A **correct** guess: round-over overlay shows the answer + standings; **auto-advances after ~5s** to the next round; the winner is rotated to act last.
- [ ] **Turn timer** counts down from **60s**; let a turn expire untouched → it auto-skips to the next player.
- [ ] Close tab B mid-game → B shows as **disconnected** in A's player list; the game keeps going (B's turns are skipped at the timer).
- [ ] Reach the **win target** → game-over **podium**; "Play again" (host) restarts.
- [ ] **Verification:** if you ever see a "couldn't be verified" banner, that device disagreed with a posted result — expected only if a client was tampered with.
- [ ] Joining a code that's already **playing** is refused with a clear message.
- [ ] Joining a **bad/short** code shows an error, not a crash.

## 7. Draft Battle (free-play, Gen 2)

- [ ] A draft starts: current species name + silhouette shown; stats are **blind** (hidden numbers).
- [ ] Per card you may keep up to **2** picks across the 6 stats / 2 types / 4 moves, and **both picks read the same card** (pick two stats → they belong to the shown species).
- [ ] Picking a 2nd type that equals the first (or the "—/no 2nd type" option on a mono card) yields a **mono** type.
- [ ] Moves: 10 shown from the full movepool; reroll resamples (favouring unseen); Hidden Power never appears; Ditto/Unown never draftable.
- [ ] Reroll limits: **3 Pokémon + 3 move** rerolls in free-play.
- [ ] "Skip" appears only when a card offers nothing useful (stuck).
- [ ] Finishing the draft runs a battle: **N = 501** sims; "beat" = strict majority; verdict shows the win %.
- [ ] Battle **playback** steps through one sample log (play / step / skip to verdict).
- [ ] **Thrones** (Day/Week/Month/Year/All-Time): beating the throne's champion lets you **claim** it; your name shows as holder.

## 8. Daily Challenge (Gen 2)

- [ ] Everyone gets the **same draft** for the day (same silhouette/options).
- [ ] **One attempt** per identity — after submitting, re-entry shows your result, not a new draft.
- [ ] Reroll limits are the daily **1 + 1**.
- [ ] After submitting, the results page ranks all entrants by **average win %** (all-pairs battle).
- [ ] **Share** produces a summary card (clipboard / WhatsApp) without revealing others' picks improperly.
- [ ] Rolls over at **midnight Central Time** (spot-check the date key if testing near midnight).

## 9. Pokédex (reference)

- [ ] Browse all mons; silhouette → reveal shows the full data (types, stats, habitat, evolution, moves, etc.).
- [ ] Gen switch filters to 151 vs 251.
- [ ] Search / quiz behaves as designed; no missing-image (broken `img`) icons.

## 10. Leaderboard

- [ ] Boards exist per gen per mode (Gen 1 guess / Gen 2 guess / Draft).
- [ ] A score you submitted in Single/Safari/Victory Road appears, ranked correctly.
- [ ] Entry shows name (≤16 chars) + score + the settings badges.
- [ ] Names over the limit or odd shapes are rejected (validated by the DB rules).

---

## 11. Firebase data spot-checks (RTDB console)

- [ ] `/players/{uid}` holds your `{ name, createdAt }`.
- [ ] Playing online creates `/rooms/{CODE}` with `players`, `turnOrder`, `revealedClueIds`, etc., and **no plaintext answer** anywhere in the room.
- [ ] Leaderboard writes land under `/leaderboard/{gen}/{mode}/…`.
- [ ] Draft daily/throne writes land under `/draft/…`.
- [ ] Try writing to another uid's node from the console as an anon user → **denied** by the rules.

## 12. Cross-cutting / regression

- [ ] No uncaught console errors in any mode.
- [ ] Lazy-loading: modes that don't need the network (Single, Pokédex, Draft free-play) work with **Firebase blocked** / offline.
- [ ] Mobile width (~380px): menus, clue grid, online lobby, and draft cards are usable and not clipped.
- [ ] Switching modes mid-session and back doesn't leak old UI or timers (the online turn timer stops when you leave the room).
- [ ] Names with apostrophes/periods/hyphens (Farfetch'd, Mr. Mime, Ho-Oh, Nidoran-F) are accepted exactly when guessing.

---

### Known v1 limitations to expect (not bugs)
- Online MP has **no per-clue exclusion panel** and **no evolution auto-deduction** yet (hot-seat has both).
- Online anti-cheat is **detect-and-flag**, not server-enforced (serverless design).
- Turn-timer skips rely on device clocks; a few seconds of skew between players is normal.
