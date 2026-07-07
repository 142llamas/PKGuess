# PokéGuess Online — Testing Checklist

Work through this at your own pace — it's organized by feature area, so you can
tackle a section at a time. For each item, do the action and confirm you see
the expected result. If something's off, jot down which numbered item it was
(e.g. "8.6 — the toast never showed up") — that's exactly the detail a new
chat will need to fix it fast.

**Tip:** most sections need a second device/browser (or an incognito window)
to properly test multiplayer — one tab alone can't show you what a second
player sees.

---

## 1. Single Player, Pokédex, Safari, Victory Road

- [ ] 1.1 Start a Single Player game on Easy — confirm you get 1 free clue and all 7 categories are available.
- [ ] 1.2 Try Medium through Extreme — confirm the locked categories (Habitat, Anime, etc.) are hidden with a summary line, not just greyed out.
- [ ] 1.3 Set **Clue Picking → Random** — confirm clue cards are read-only and a "Reveal a random clue" button appears instead.
- [ ] 1.4 Set **Clue Picking → By Category** — confirm clicking a category *header* reveals a random clue from that category, and individual cards aren't clickable.
- [ ] 1.5 Set **Category Diversity → Force Different** — confirm you can't reveal two clues from the same category back-to-back (the card/header should show why it's blocked).
- [ ] 1.6 Set **Category Diversity → Cycle All** — confirm you must touch every category once before repeating any.
- [ ] 1.7 Reveal "Reveal One Weakness" (or another multi-use clue) more than once — confirm it shows `#1`, `#2`, etc. with different values, not just once.
- [ ] 1.8 Play a full game, guess correctly or run out of points — go to the **Pokédex**, find that Pokémon, and confirm it now shows as **Caught** (or **Seen** if you lost).
- [ ] 1.9 In the Pokédex, toggle **Seen** and **Caught** filters independently, then both together — confirm both-on shows the *union* (anything Seen OR Caught), not just one or the other.
- [ ] 1.10 Play a round of **Safari Zone** — confirm bait/rock reveal a clue at normal cost, and manually clicking a clue costs double.
- [ ] 1.11 Play a round of **Victory Road** — confirm it plays as an endless streak with fewer clues at higher tiers.
- [ ] 1.12 Check the tier boundaries — Tier 1 should last through your **5th** correct guess (streak 0–5), Tier 2 through your **10th**, etc. — one more Pokémon per tier than before.
- [ ] 1.13 On Tiers 1–4, confirm **"Has an Immunity"** is pre-revealed. On Tiers 3–8, confirm a combined **weakness/resistance** reveal is pre-revealed (up to 6 at Tier 3, shrinking by 1 each tier down to 1 at Tier 8) — labeled "Weak:" / "Resist:" in one chip. On Tier 7, confirm Highest/Lowest Base Stat (just the stat name, no number) are pre-revealed.
- [ ] 1.14 Confirm the two type clues show on **one line** in one chip (e.g. "Fire / Flying"), egg moves show as **one chip listing all of them** (not one chip per move), and weakness/resistance show together in **one chip**, clearly labeled which is which.

## 2. Multiplayer (Hot-seat, same device)

- [ ] 2.1 Start a 2+ player game, try **Reveal → Guess** and **Guess → Reveal** — confirm the turn order matches (reveal first vs. guess first).
- [ ] 2.2 Set **Clue Picking → Random** and **→ By Category** — same checks as 1.3/1.4 above, but in hot-seat.
- [ ] 2.3 Set a **Category Diversity** option in the hot-seat setup screen — confirm it's actually enforced (this used to silently do nothing).
- [ ] 2.4 Open **⚙️ Clue Availability** in setup, uncheck a few clues — confirm those clues never show up as random/category picks during the game.
- [ ] 2.5 Reveal a Pokémon's Evolution Stage or Can Evolve clue — confirm any logically-implied evolution clues auto-reveal for free right after.
- [ ] 2.6 A wrong guess, a round ending, and someone quitting mid-game — confirm the Pokédex Caught/Seen status updates correctly for the mystery each time (pairs with 1.8/1.9).
- [ ] 2.7 In **Guess → Reveal** mode, guess wrong — confirm you're forced into exactly **one** reveal (no "skip guess" or "skip reveal" option anywhere), then the turn passes to the next player automatically.

## 3. Online Multiplayer

- [ ] 3.1 Create a room on one device, join from a second — confirm both see each other in the lobby.
- [ ] 3.2 Repeat items 2.2–2.5 above (clue picking, diversity, exclusions, evolution deduction) — confirm **online now matches hot-seat** feature-for-feature.
- [ ] 3.3 Play to a win — on the results screen, confirm you see a **rematch toggle**, not the old one-click "Play again."
- [ ] 3.4 Have both players tap "Want a rematch?" — confirm the host's "Start rematch" button enables only once someone *else* has also opted in, and a 5-second countdown starts.
- [ ] 3.5 Let the countdown finish — confirm a fresh game starts with scores reset to 0.
- [ ] 3.6 Try it again but have only the host opt in — confirm the host sees an error and returns to the main menu instead of starting a 1-player game.
- [ ] 3.7 In **Guess → Reveal** mode, let a turn expire then guess wrong — confirm you're forced into exactly **one** reveal (no skip option), then control passes back automatically — you should never get stuck revealing indefinitely.
- [ ] 3.8 **Host-disconnect resilience**: with 2+ players in a room, have the host close their tab/browser (or otherwise go offline) before starting the game — confirm the remaining player(s) see a banner saying the host disconnected and who's now in control, and that player can start the game (the room should never be permanently stuck waiting for a host who's gone). Repeat after a game has started, and again in the post-game rematch lobby.

## 4. Identity & Leaderboards

- [ ] 4.1 Tap the profile pill in the header — confirm you can set/change your name.
- [ ] 4.2 Protect your name with a 4-digit PIN — confirm it's marked 🔒 Protected afterward.
- [ ] 4.3 Try setting a name that's already claimed by someone else — confirm it's blocked with a clear message, not silently allowed.
- [ ] 4.4 Submit a good score to a leaderboard — confirm it appears correctly ranked.
- [ ] 4.5 On the Leaderboard screen, confirm you see links to **Elite 4 Standings** and **Daily Challenge Results** near the top, and that tapping each takes you to the right screen.

## 5. Cycling Road — Individual

- [ ] 5.1 Create a room (pick a target, e.g. 5 Pokémon), join from a second device, start the race.
- [ ] 5.2 Confirm the **first clue appears immediately**, then a **new one every 5 seconds** automatically (no clicking needed).
- [ ] 5.3 Solve a mystery on one device — confirm the *other* player sees a small "X has advanced to round N" message, and that you *don't* see that message about yourself.
- [ ] 5.4 Confirm each player advances **independently** — one player being ahead doesn't block or wait for the other.
- [ ] 5.5 Let the room run past its time limit (target × 2 minutes) without everyone finishing — confirm the game ends anyway and shows results.
- [ ] 5.6 Mid-race, tap Quit — confirm you get a warning that you won't see the results if you leave.
- [ ] 5.7 Finish a race — confirm the results screen ranks players by total time and highlights the fastest/slowest split *per Pokémon* in green/red.
- [ ] 5.8 After results, confirm you're in a **persistent lobby** (not kicked to the main menu) with a rematch toggle, matching items 3.3–3.6 above.
- [ ] 5.9 Try joining a room that already has 12 players — confirm you're told the room is full.
- [ ] 5.10 **Host-disconnect resilience**: with 2+ players, have the host disconnect before starting — confirm someone else can still start the race, with a banner explaining what happened. Try it again mid-race (the room-wide time cap should still fire on schedule) and in the post-game lobby (someone else should be able to trigger the rematch countdown).

## 6. Cycling Road — Team Mode

- [ ] 6.1 Create a room with **Team Mode** turned on — confirm a team-builder lobby appears (Unassigned / Team Red / Team Blue).
- [ ] 6.2 Manually assign players to teams, then try **Randomize Teams** — confirm it splits evenly (or as close to even as possible for an odd number).
- [ ] 6.3 Start the game — confirm only **one** team member (the first in line) sees the guess box; teammates see "waiting for X to answer" but still see the same clues.
- [ ] 6.4 Have that member guess correctly — confirm the answering turn **rotates** to the next teammate.
- [ ] 6.5 Confirm the standings show **two team bars**, not one per player.
- [ ] 6.6 Finish a team race — confirm results are ranked by team, not by individual.
- [ ] 6.7 On the results screen, confirm rematch requires **every single player** to opt in (not just two) before the host can start it.
- [ ] 6.8 **Host-disconnect resilience**: same as 5.10, but with Team Mode — have the host disconnect before teams are even assigned, and confirm someone else can take over assigning teams and starting the game.

## 7. Draft Battle — drafting

- [ ] 7.1 Draft a Pokémon — confirm you can take stats, types (including "—" for mono-type from a mono card only), and moves as described.
- [ ] 7.2 Check a few of your drafted moves against the [banned list](#banned-moves-reference) below — confirm none of them ever show up as options anymore.

## 8. Draft Battle — the simulator itself

This is the big one — the battle log now narrates a lot more than it used to,
so actually *read* the log lines here, not just the win/loss result.

- [ ] 8.1 Battle enough times to see a **burn** — confirm the log says something like "X is hurt by burned" each turn, and that a burned Pokémon's physical moves look weaker.
- [ ] 8.2 See a **poison** and a **badly poisoned (toxic)** — confirm toxic damage visibly *increases* turn over turn, while regular poison stays flat.
- [ ] 8.3 See a **paralysis** — confirm you sometimes see "X is fully paralyzed!" (can't move), and that a paralyzed Pokémon seems to act after who it used to out-speed.
- [ ] 8.4 See a **freeze** — confirm the frozen Pokémon can't act, and eventually see a "thawed out!" message.
- [ ] 8.5 See a **confusion** — confirm occasional "hurt itself in confusion" messages, and eventually a "snapped out of confusion" message.
- [ ] 8.6 Watch a Pokémon use **Swords Dance**, **Curse**, **Growl**, or similar — confirm the log actually shows "X's Attack rose!" / "fell!" (this used to show nothing at all even though the boost was applied).
- [ ] 8.7 Watch **Fly** or **Dig** — confirm there's a "charging" turn where the user can't be hit, then it attacks for real the turn after.
- [ ] 8.8 Watch **Hyper Beam** connect without fainting the target — confirm the user is forced to "recharge" and skips its next turn.
- [ ] 8.9 Watch a multi-hit move (**Doubleslap**, **Fury Swipes**, **Double Kick**) — confirm the log says how many times it hit.
- [ ] 8.10 Watch **Guillotine**, **Horn Drill**, or **Fissure** connect a few times across battles — confirm it's an instant KO when it lands (this was completely broken before — worth specifically checking).
- [ ] 8.11 Watch **Belly Drum**, **Rest**, **Pain Split**, or **Leech Seed** if they come up — confirm each shows a sensible log line for what it's doing (cost paid, HP equalized, drain each turn, etc.).
- [ ] 8.12 Watch **Magnitude** land a few times — confirm the power visibly varies between uses (it's a real random 4–10 roll now, not a fixed value every time).
- [ ] 8.13 Watch **Tri Attack**'s secondary effect proc a few times across battles — confirm you see a mix of paralysis, burn, *and* freeze (not paralysis every single time).
- [ ] 8.14 Watch **Charm** land — confirm the target's Attack visibly drops (it used to do nothing at all).
- [ ] 8.15 Check **Charm**, **Sweet Kiss**, and **Moonlight**'s type in the Pokédex/movelist (e.g. via a "Reveal One Egg Move" or TM/HM clue that surfaces one of them) — confirm none of them show as "Fairy" anymore (Fairy didn't exist in Gen 1/2; Charm/Sweet Kiss are now Normal, Moonlight is now Dark).

## 9. Elite 4 Gauntlet

- [ ] 9.1 Draft a Pokémon, then tap **"Challenge the Elite 4"** — confirm it auto-battles Will → Koga → Bruno → Lance → the All-Time Champion in one action, always starting fresh at Will, and stops at your first loss.
- [ ] 9.2 On the results screen, confirm you see **one row per matchup** you actually played (not one screen per tier), each with an on-demand **"▶ Watch"** replay button.
- [ ] 9.3 Confirm there's exactly **one Claim** button (for the highest spot you reached) and **one Share** button (a consolidated summary + canvas card image), not a separate prompt after every individual win.
- [ ] 9.4 Check that Will/Koga/Bruno/Lance's NPC opponents *feel* noticeably harder as you go up the tiers (Lance should be a serious wall compared to Will).
- [ ] 9.5 Note your best-ever progress badge ("🏅 Your best") on the draft screen — confirm it's purely informational and doesn't block you from starting a fresh gauntlet at Will again.
- [ ] 9.6 If you can arrange it with a second account: claim a lower throne (say Koga), then later run a gauntlet that reaches a higher one (say Bruno) — confirm you keep Bruno, and Koga either gets handed to whoever held it (if human) or reverts to a fresh NPC (if it was an NPC).
- [ ] 9.7 Try the reverse — hold a higher throne (Lance), then have a gauntlet run reach a lower one (Will) — confirm you keep Lance and don't end up holding both.

## 10. Daily Puzzle

- [ ] 10.1 Play today's daily challenge, submit your entry — confirm the results screen ranks you against the Daily Rival (and anyone else who's played).
- [ ] 10.2 Tap **"See Yesterday's Results"** — confirm the date and results actually change to the previous day, and there's a way back to today.
- [ ] 10.3 Try playing the daily a second time the same day — confirm you're blocked (one attempt per day).
- [ ] 10.4 Tap **Share** on the daily results — confirm the shared text starts with a link that, when opened, takes you straight into today's Daily Challenge, followed by your name (or a "Player_" fallback if you haven't set one), your rank, and your win percentage.

---

## Banned Moves Reference

These should **never** appear in a draftable movepool anymore: Attract,
Self-Destruct, Explosion, Baton Pass, Mirror Move, Skull Bash, Rage, Teleport,
Perish Song, Conversion, Disable, Encore, False Swipe, Foresight, Mean Look,
Metronome, Mimic, Mind Reader, Mist, Roar, Whirlwind, Sketch, Sky Attack,
Snore, Spite, Spikes, Spider Web, Sweet Scent, Thief, Transform.

---

## When you find something off

Note the **section number** (e.g. "8.6") and what you actually saw vs.
expected. That's the single most useful thing to bring into a new chat — see
`NEW_CHAT_GUIDE.md` for exactly how to do that.
