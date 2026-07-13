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
- [ ] 1.10 Play a round of **Safari Zone** — confirm bait/rock reveal a clue at normal cost, and manually clicking a clue costs double. Play until points run out — confirm a **post-game summary screen actually appears** (Caught/Budget/Spent, no NaN/undefined) and doesn't leave you stuck on the game screen. Afterward, check that a leaderboard entry was recorded for Safari.
- [ ] 1.10a On that same summary screen, confirm it lists **every Pokémon caught** and **every Pokémon run from**, by name — not just the counts. Deliberately let the game end from a wrong guess or a clue purchase (not clicking "Run") — confirm that mon still shows up in the "Ran From" list, not silently dropped from the summary.
- [ ] 1.10b Spam **Bait**/**Rock** repeatedly near the end of a Safari game — confirm the shared budget never drops to 0 from a random clue alone (at least 1 point should always remain after Bait/Rock; it's fine for a **manual** clue pick to hit 0).
- [ ] 1.10c On Safari's starting screen, confirm the points input allows values as low as **1** (not 50) — the range no longer needs to be documented anywhere in the UI.
- [ ] 1.11 Play a round of **Victory Road** — confirm it plays as an endless streak with fewer clues at higher tiers.
- [ ] 1.12 Check the tier boundaries — Tier 1 should last through your **5th** correct guess (streak 0–5), Tier 2 through your **10th**, etc. — one more Pokémon per tier than before.
- [ ] 1.13 On Tiers 1–4, confirm **"Has an Immunity"** is pre-revealed. On Tiers 3–8, confirm a combined **weakness/resistance** reveal is pre-revealed (up to 6 at Tier 3, shrinking by 1 each tier down to 1 at Tier 8) — labeled "Weak:" / "Resist:" in one chip. On Tier 7, confirm Highest/Lowest Base Stat (just the stat name, no number) are pre-revealed.
- [ ] 1.14 Confirm the two type clues show on **one line** in one chip (e.g. "Fire / Flying"), egg moves show as **one chip listing all of them** (not one chip per move), and weakness/resistance show together in **one chip**, clearly labeled which is which.
- [ ] 1.15 Before starting Victory Road, tap a tier row on the **preview screen** to expand it — confirm Tiers 3–8 each show a "Weakness/Resistance (up to N)" entry in the clue list (it was previously missing from the preview entirely, even though it always appeared during actual play).
- [ ] 1.16 During an actual game (Tier 3 or higher, so weakness/resistance is present), look at the order the pre-revealed clues appear in — confirm they're grouped logically: Habitat/Generation, then Evolution Stage, then the type-matchup group (Weakness/Resistance, Has an Immunity, Type — all next to each other), then the stat clues together, then Trainer Usage, then Moves, then Anime last. It should read as organized categories, not a scattered mix.
- [ ] 1.16a On a **wide/desktop window**, confirm Victory Road's revealed-clue chips actually pack multiple per row when they're short enough to fit (not every chip taking its own full row regardless of length) — this was a real CSS bug (two conflicting layout rules), now fixed. On mobile this should look the same as before (full-width chips), since mobile was never affected.
- [ ] 1.17 Buy/reveal **"Reveal Full Stat Spread"** in Single Player, hot-seat Multiplayer, Online, and Safari Zone — confirm all four show labeled stats (HP/Atk/Def/SpA/SpD/Spe above the numbers), not a bare "63/60/60/130/50/65" string.
- [ ] 1.18 Buy/reveal **"Reveal One Example Moveset"** a few times on a few different Pokémon (Mr. Mime is a known real example) — confirm no single reveal ever shows the same move twice.
- [ ] 1.19 Buy/reveal the **"Has an Immunity"** clue and the **"Used by Elite Four / Red / Rival"** clue — confirm each shows a plain **"Yes"** or **"No"**, not the longer "Yes — has at least one immunity" / "No — not used by Elite Four, Red, or Rival" text.
- [ ] 1.20 On the main mode-select screen, confirm there is **no "Build skeleton v1.0.0"** text at the bottom anymore (it was removed).

## 2. Multiplayer (Hot-seat, same device)

- [ ] 2.1 Start a 2+ player game, try **Reveal → Guess** and **Guess → Reveal** — confirm the turn order matches (reveal first vs. guess first).
- [ ] 2.2 Set **Clue Picking → Random** and **→ By Category** — same checks as 1.3/1.4 above, but in hot-seat.
- [ ] 2.3 Set a **Category Diversity** option in the hot-seat setup screen — confirm it's actually enforced (this used to silently do nothing).
- [ ] 2.4 Open **⚙️ Clue Availability** in setup, uncheck a few clues — confirm those clues never show up as random/category picks during the game.
- [ ] 2.5 Reveal a Pokémon's Evolution Stage or Can Evolve clue — confirm any logically-implied evolution clues auto-reveal for free right after.
- [ ] 2.6 A wrong guess, a round ending, and someone quitting mid-game — confirm the Pokédex Caught/Seen status updates correctly for the mystery each time (pairs with 1.8/1.9).
- [ ] 2.7 In **Guess → Reveal** mode, guess wrong — confirm you're forced into exactly **one** reveal (no "skip guess" or "skip reveal" option anywhere), then the turn passes to the next player automatically.
- [ ] 2.8 Type something that **isn't a real Pokémon name** (e.g. "asdf") into the guess box and submit it — confirm it's rejected with "Pick a Pokémon from the list," and that it does NOT count as a turn, does NOT advance to the next player, and does NOT deduct from the shared point pool.

## 3. Online Multiplayer

- [ ] 3.1 Create a room on one device, join from a second — confirm both see each other in the lobby.
- [ ] 3.2 Repeat items 2.2–2.5 above (clue picking, diversity, exclusions, evolution deduction) — confirm **online now matches hot-seat** feature-for-feature.
- [ ] 3.3 Play to a win — on the results screen, confirm you see a **rematch toggle**, not the old one-click "Play again."
- [ ] 3.4 Have both players tap "Want a rematch?" — confirm the host's "Start rematch" button enables only once someone *else* has also opted in, and a 5-second countdown starts.
- [ ] 3.5 Let the countdown finish — confirm a fresh game starts with scores reset to 0.
- [ ] 3.6 Try it again but have only the host opt in — confirm the host sees an error and returns to the main menu instead of starting a 1-player game.
- [ ] 3.7 In **Guess → Reveal** mode, let a turn expire then guess wrong — confirm you're forced into exactly **one** reveal (no skip option), then control passes back automatically — you should never get stuck revealing indefinitely.
- [ ] 3.8 **Host-disconnect resilience**: with 2+ players in a room, have the host close their tab/browser (or otherwise go offline) before starting the game — confirm the remaining player(s) see a banner saying the host disconnected and who's now in control, and that player can start the game (the room should never be permanently stuck waiting for a host who's gone). Repeat after a game has started, and again in the post-game rematch lobby.
- [ ] 3.9 **Room sharing**: in the lobby, tap **"📤 Share Room"** — confirm the message says "Join my PokeGuess Online game!" plus the gen, RTG/GTR, and win target, then a link. Send that link to a second device/browser and open it — confirm it goes straight to the "Join a room" screen with the code **already typed in** (just tap Join, no typing needed).
- [ ] 3.10 Type something that **isn't a real Pokémon name** into the guess box and submit it — same as 2.8, confirm it's rejected without counting as a turn or costing anything from the pool.
- [ ] 3.11 **Round-transition countdown (was frozen):** after a correct guess, a brief summary screen shows "Next round in X seconds…". Confirm on **both** devices that this number actually **counts down** each second (it used to sit frozen at its starting value on every device until the round advanced).
- [ ] 3.12 **RTG turn-timer sync (was ~1–2s off):** in RTG mode, watch the per-turn timer on **both** devices at the same time — confirm they show the same value (within a second) and count down together, rather than drifting apart. Best checked with the two devices side by side.
- [ ] 3.13 **Rematch countdown sync:** trigger a rematch countdown with two devices — confirm the 5→0 countdown reaches 0 at essentially the same time on both, rather than one device finishing seconds ahead of the other.

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
- [ ] 5.11 **Room sharing**: in the lobby, tap **"📤 Share Room"** — confirm the message says "Join my Cycling Road game!" plus the gen and target Pokémon count, then a link (and does NOT mention Team Mode, since this is an individual room). Open that link on a second device — confirm it lands on the join screen with the code pre-filled.
- [ ] 5.12 **Rematch countdown sync (was "stuck"):** in the post-game lobby, have both players opt in and the host start the rematch countdown. Confirm the 5→0 countdown behaves the same on **both** devices — it should reach 0 and start the new game together, NOT sit stuck (e.g. never dropping below 2s) on one device while the other has already entered the game. Worth checking with a phone + a desktop specifically, since that's where the clock difference showed up.

## 6. Cycling Road — Team Mode

- [ ] 6.1 Create a room with **Team Mode** turned on — confirm a team-builder lobby appears (Unassigned / Team Red / Team Blue).
- [ ] 6.2 Manually assign players to teams, then try **Randomize Teams** — confirm it splits evenly (or as close to even as possible for an odd number).
- [ ] 6.3 Start the game — confirm only **one** team member (the first in line) sees the guess box; teammates see "waiting for X to answer" but still see the same clues.
- [ ] 6.4 Have that member guess correctly — confirm the answering turn **rotates** to the next teammate.
- [ ] 6.5 Confirm the standings show **two team bars**, not one per player.
- [ ] 6.6 Finish a team race — confirm results are ranked by team, not by individual.
- [ ] 6.7 On the results screen, confirm rematch requires **every single player** to opt in (not just two) before the host can start it.
- [ ] 6.8 **Host-disconnect resilience**: same as 5.10, but with Team Mode — have the host disconnect before teams are even assigned, and confirm someone else can take over assigning teams and starting the game.
- [ ] 6.9 **Room sharing**: same as 5.11, but confirm the Team Mode invite text explicitly mentions "Team Mode" this time.
- [ ] 6.10 **Rematch countdown sync:** same as 5.12 — team mode shares the same countdown code, so confirm its rematch countdown also reaches 0 together on both devices rather than sticking on one.

## 7. Draft Battle — drafting

- [ ] 7.1 Draft a Pokémon — confirm you can take stats, types (including "—" for mono-type from a mono card only), and moves as described.
- [ ] 7.2 Check a few of your drafted moves against the [banned list](#banned-moves-reference) below — confirm none of them ever show up as options anymore.
- [ ] 7.3 Set your screen name (via the profile pill) BEFORE drafting — confirm your drafted mon's name uses it (e.g. "Ash's Feraligatr"), not the literal word "Player's ...".
- [ ] 7.4 On the Draft Complete screen, tap **"📤 Share My Pokémon"** — confirm it opens the same WhatsApp/Copy/Close text share sheet used everywhere else in the app (mentions the mon's name, types, and moves), and that no image file gets downloaded and no native OS share sheet appears.
- [ ] 7.5 Draft through several cards, including a couple of Pokémon-rerolls — confirm you never see the same Pokémon shown twice in one draft (rerolled-past cards shouldn't reappear later either).

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
- [ ] 9.3 Confirm there's exactly **one Claim** button (for the highest spot you reached) and **one Share** button, not a separate prompt after every individual win. Tap Share — confirm it opens the same WhatsApp/Copy/Close text share sheet used everywhere else in the app (no image, no file download, no native OS share sheet), and reads "...beat my {Pokémon name}" — NOT "...beat my {your screen name}'s {Pokémon name}" (that "my X's Y" double-possessive was a grammar bug).
- [ ] 9.4 Check that Will/Koga/Bruno/Lance's NPC opponents *feel* progressively harder as you go up the tiers, but with a gentler jump than before between Will and Koga specifically (the stat bands were narrowed — Koga/Bruno/Lance all moved down some). Beating Will but losing to Koga is still a common outcome, just less of a hard wall than before.
- [ ] 9.5 Note your best-ever progress badge ("🏅 Your best") on the draft screen — confirm it's purely informational and doesn't block you from starting a fresh gauntlet at Will again.
- [ ] 9.6 **The core rule: one Pokémon can only hold one spot, but a player can hold as many spots as they want.** Claim a throne (say Will) with one mon, then draft a genuinely *different* mon and claim a *different* throne (say Bruno) with it — confirm this succeeds and you end up holding **both** at once, each with its own mon. (This was broken — it used to incorrectly say you already held the higher spot and block the claim.)
- [ ] 9.7 Now test the part that's supposed to still restrict things: if the *same* mon (not a new draft) somehow ends up eligible for two different spots, confirm claiming the higher one vacates the lower one for that same mon — a single Pokémon still can't hold two spots at once.
- [ ] 9.8 If you can arrange it with a second account: have someone else hold a throne, then take it from them with a mon that also holds a *different*, higher throne — confirm the person you beat either gets bumped down to the vacated lower spot (if they're human) or it reverts to a fresh NPC (if they were the NPC).
- [ ] 9.9 From the Elite 4 status screen, tap **"History"** on any throne — confirm each row has a **🔍 Inspect** button showing that historical champion's types/stats/moves read-only, same as the Daily Draft's Inspect feature.
- [ ] 9.10 On the Elite 4 status screen, check that the descriptive paragraph at the top ("Challenge the Elite 4 battles Will, Koga...") is actually centered on the screen on a wide/desktop window, not just centered within its own narrower text box off to one side.

## 10. Daily Puzzle

- [ ] 10.1 Play today's daily challenge, submit your entry — confirm the results screen ranks you against **Cal** (renamed from "Daily Rival" — that old name should never appear anywhere) and anyone else who's played. Confirm the "Build" column shows your build using your real screen name (e.g. "Ash's Feraligatr"), not "Player's ...".
- [ ] 10.2 Tap **"See Yesterday's Results"** — confirm the date and results actually change to the previous day, and there's a way back to today.
- [ ] 10.3 Try playing the daily a second time the same day — confirm you're blocked (one attempt per day).
- [ ] 10.4 Tap **Share** on the daily results — confirm the shared text starts with a link that, when opened, takes you straight into today's Daily Challenge, followed by your name (or a "Player_" fallback if you haven't set one), your rank, and your win percentage.
- [ ] 10.5 With at least one other entry (a real second player, or just Cal) on the board, confirm every row has a **📊 (Matchups)** button and a **🔍 (Inspect)** button.
- [ ] 10.6 Tap **📊** on your own row — confirm you see one row per OTHER entrant (never yourself), each showing Won/Lost and a win percentage against that specific opponent, and that **Cal appears in the list like any other opponent**.
- [ ] 10.7 Tap **▶ Watch** on one of those matchup rows — confirm it plays out move-by-move like a normal battle, and that the final winner **matches** what the matchups list already said (not a different result — it should be replaying the same computed outcome, not recalculating a fresh one). Tap "← Back to Results" — confirm it returns to the matchups list, not the main results table.
- [ ] 10.8 Tap **📊** on **Cal's** row (not your own) — confirm you can see Cal's matchups against everyone else too, the same way you can see your own.
- [ ] 10.9 Tap **🔍** on any row (yours, another player's, or Cal's) — confirm you see that Pokémon's types, full stat spread, and moves, with just a plain **"← Back"** button — no Submit/Challenge/Share buttons (those are only for your own in-progress draft, not for inspecting someone else's finished one).
- [ ] 10.10 On a phone-sized screen, check the daily results table with the new 📊/🔍 buttons — confirm it's not uncomfortably cramped (this is a new 5th column that hasn't been checked on a real device yet).

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
