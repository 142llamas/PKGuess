# PokeGuess Online

A single static website (vanilla JS ES modules, no build step) hosting three
games over Gens I & II:

- **Gen 1 Guess** and **Gen 2 Guess** — buy clues to identify a mystery Pokémon.
  Single Player, Pokédex, Safari Zone, and Victory Road (an endless streak
  gauntlet, 8 tiers, fewer clues as the streak climbs). Multiplayer comes in
  two forms: hot-seat pass-and-play, and real-time **Online** rooms (Firebase-
  backed, RTG/GTR turn modes, By-Category/Random clue selection, category
  diversity). **Cycling Road** is a separate synced-timer race mode (solo or
  2-team) where every player in a room races the same predetermined mystery
  sequence independently, with live standings and a persistent post-game
  rematch lobby. All online modes (Online guess multiplayer, Cycling Road)
  survive the room host disconnecting — a fallback leader (the earliest-joined
  still-connected player) transparently takes over host duties, with a banner
  telling everyone when this has happened.
- **Draft Battle (Gen 2)** — draft a "Frankenstein" Pokémon two attributes at a
  time, then battle: a free-play **Elite 4 gauntlet** (auto-battles Will →
  Koga → Bruno → Lance → the All-Time Champion, stopping at your first loss)
  and a once-a-day **Daily Challenge** ranked by average win %. The battle
  simulator models real Gen 1/2 move mechanics (multi-hit, two-turn/recharge
  moves, status effects, stat stages, and move-specific special cases like
  Curse, Belly Drum, and Leech Seed) rather than plain damage-only combat.

Identity, leaderboards, online rooms, thrones, and the daily are backed by
**Firebase Realtime Database** + **Anonymous Auth**, loaded lazily so offline
modes never fetch the SDK.

---

## Repository layout

GitHub Pages serves the **`docs/`** folder. Keep this structure exactly
(paths are case-sensitive):

```
<repo root>/
├─ MANIFEST.md                 # authoritative file inventory (versions live in files)
├─ README.md                   # this file
├─ CHANGE_TRACKER_v3.md         # decision history — start here in a new chat
├─ TESTING_CHECKLIST.md        # hands-on QA checklist, kept in sync with the app
├─ database.rules.json         # Firebase RTDB security rules (paste into console)
├─ tools/                      # build + test scripts (NOT served)
│   ├─ generate-data.mjs
│   ├─ generate-movestats.mjs
│   ├─ apply-movestats.mjs
│   └─ test/                   # zero-dependency unit tests + jsdom smoke tests
│       ├─ run.mjs  _harness.mjs                    # unit runner
│       ├─ sim.test.mjs  sim-status.test.mjs        # battle simulator
│       ├─ draft.test.mjs  engine.test.mjs  mp-rules.test.mjs
│       ├─ identity.test.mjs  catch-tracker.test.mjs  share.test.mjs
│       └─ *.smoke.mjs                              # jsdom UI smokes (see "Run the tests")
└─ docs/                       # ← GitHub Pages root
    ├─ index.html
    ├─ .nojekyll               # empty; stops Pages stripping js/-prefixed paths
    ├─ css/styles.css
    ├─ js/
    │   ├─ main.js  modes.js
    │   ├─ draft.js  sim.js    # ← in docs/js/ (NOT lib/); the adapter imports ../draft.js
    │   ├─ lib/                # shared logic
    │   │   ├─ dom.js  engine.js  firebase.js  mp-rules.js
    │   │   ├─ identity.js  identity-ui.js  catch-tracker.js  pokeinfo.js
    │   │   ├─ leaderboard-data.js  share.js  draft-adapter.js
    │   └─ modes/              # one controller per screen
    │       ├─ single.js  pokedex.js  safari.js  victoryroad.js
    │       ├─ multiplayer.js  online.js  race.js
    │       ├─ leaderboard.js  draftbattle.js
    ├─ data/                   # JSON generated from the Excel workbook
    │   ├─ config.json  gen1.json  gen2.json
    │   ├─ movelist-gen{1,2}.json  movestats-gen{1,2}.json
    │   ├─ typechart-gen{1,2}.json  draftpool-gen2.json
    └─ img/silhouettes/        # {num}.png — 1.png … 251.png (see "Silhouettes")
```

**Two things people get wrong:**
1. `draft.js` and `sim.js` live in **`docs/js/`**, not `docs/js/lib/`. The adapter
   imports them as `../draft.js` / `../sim.js`. Move them into `lib/` and every
   draft/battle import breaks.
2. `database.rules.json` and `MANIFEST.md` stay at the **repo root**, outside
   `docs/`. The rules file is never served — you paste it into Firebase.

---

## Run locally

ES modules require HTTP (not `file://`). From the repo root:

```bash
cd docs
python3 -m http.server 8000      # or: npx serve .   /   php -S localhost:8000
```

Open <http://localhost:8000>. Online features (leaderboards, thrones, daily)
need the Firebase config in `docs/js/lib/firebase.js`; everything else (guessing
games, drafting, battles vs NPC champions) works fully offline.

---

## Run the tests

Two layers, both zero-dependency-beyond-`jsdom` and CI-friendly (non-zero exit
on any failure):

```bash
npm install                      # one-time; installs jsdom for the smoke tests
npm test                         # pure-logic unit tests — node tools/test/run.mjs
npm run test:smoke               # jsdom UI smokes — every tools/test/*.smoke.mjs
```

**Unit tests** (`npm test`) cover pure logic with no DOM: `sim.js` (stat
conversion, determinism, win accounting, type immunity, real move mechanics —
multi-hit, two-turn/recharge, status effects, stat stages, Curse/Belly Drum/
Rest/Pain Split/Leech Seed), `draft.js` (card sourcing, mono-type picks,
daily determinism, weighted move reroll, autoDraft, Elite 4 stat-band scaling,
the one-throne-per-Pokémon cascade), `engine.js` (round setup, clue purchase,
scoring, category diversity), `mp-rules.js` (seed determinism, reveal/guess
outcomes, turn rotation, `leaderUid` host-disconnect resilience), `identity.js`,
`catch-tracker.js`, and `share.js` (summary-card text, deep links, the mon
share-card canvas layout).

**Smoke tests** (`npm run test:smoke`) drive the real controllers through
jsdom — clicking actual buttons, typing into actual inputs, reading actual
rendered text — rather than calling internal functions directly. This is what
catches UI-wiring bugs the unit tests can't see. Notably: `race.smoke.mjs` and
`race-teams.smoke.mjs` (Cycling Road, individual and Team Mode) and
`online.smoke.mjs` (Online guess multiplayer) each drive **multiple
simulated clients sharing one fake Firebase**, including host-disconnect
scenarios (marking a player's `connected` flag false mid-test and confirming
the room recovers); `victoryroad.smoke.mjs` drives a full multi-round session
with a deterministic shuffle; `throne.smoke.mjs` covers the Elite 4 gauntlet
end-to-end.

---

## Regenerate the data (only when the Excel changes)

You don't need this to play. To re-import from the workbook:

```bash
npm install xlsx                 # one-time
node tools/generate-data.mjs     # Excel → docs/data/*.json (cleans the move list,
                                 #          fixes known typos, writes _data-report.json)
node tools/generate-movestats.mjs   # bootstrap movestats + review CSVs (PokeAPI)
node tools/apply-movestats.mjs      # apply curated CSVs → movestats-gen{1,2}.json
```

Review `docs/data/_data-report.json` for rescued/unresolved move cells.

---

## Deploy to GitHub Pages

1. Commit the tree above to your default branch (e.g. `main`).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch = `main`, folder = **`/docs`**. Save.
3. The site publishes at `https://<user>.github.io/<repo>/`. (The empty
   `docs/.nojekyll` file is required.)

All asset paths in `index.html` are relative, so it works from a project
sub-path without changes.

---

## Firebase setup

A project config is already baked into `docs/js/lib/firebase.js`. To use your
own project instead:

1. Create a Firebase project; add a **Web app**; copy its config into
   `docs/js/lib/firebase.js` (`apiKey`, `authDomain`, `databaseURL`,
   `projectId`, …).
2. **Authentication → Sign-in method → Anonymous → Enable.**
3. **Realtime Database → Create database.**
4. **Realtime Database → Rules →** paste the contents of `database.rules.json`
   and publish.

### What the rules enforce
- `/players/{uid}` and daily entries are writable only by their owning `uid`.
- `/leaderboard/{gen}/{mode}` entries are shape- and bounds-validated
  (name ≤ 16 chars, score 0–10000) and writable only under your own uid.
- `/draft/throne/{tier}` (tier = day|week|month|year|all) requires
  `holderUid`, `holderName`, `takenAt` (the client also stores `mon` + `period`,
  which the rules permit).
- `/draft/daily/{dateCT}/seed` is **read-only** — the daily seed is derived
  client-side from the Central-Time date (so it needs no server write and is the
  same for everyone).
- `/draft/daily/{dateCT}/entries/{uid}` is **immutable once written** and only
  by the owning uid → one attempt per identity per day.

---

## Silhouettes

The draft/battle screens look up a silhouette by **Pokédex number**:
`docs/img/silhouettes/<num>.png` — `1.png` (Bulbasaur) … `251.png`. Missing
images degrade gracefully (a fallback is shown), so you can add them anytime.
If you have a single archive, extract it so each file lands at that path.

---

## Time & determinism

- Throne/daily resets use **Central Time** (DST-correct via `Intl`, zone
  `America/Chicago`) — see `docs/js/lib/share.js`.
- The daily draft seed, the all-pairs ranking seeds, and the NPC throne
  champions are deterministic functions of the date/tier, so every player sees
  the same puzzle and the same vacated-throne champion.
- Battles are decided by `runMatch` over **N = 501** silent simulations
  ("beat" = strict majority); one sample battle is replayed step-by-step in the
  UI while the verdict is the win %.

See `MANIFEST.md` for the per-file version/status inventory.
