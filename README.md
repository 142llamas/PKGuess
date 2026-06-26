# PokeGuess Online

A single static website (vanilla JS ES modules, no build step) hosting three
games over Gens I & II:

- **Gen 1 Guess** and **Gen 2 Guess** — buy clues to identify a mystery Pokémon
  (Single Player, Pokédex, Safari Zone, Victory Road, hot-seat Multiplayer,
  Leaderboards).
- **Draft Battle (Gen 2)** — draft a "Frankenstein" Pokémon two attributes at a
  time, then battle: free-play **Throne** challenges and a once-a-day **Daily
  Challenge** ranked by average win %.

Identity, leaderboards, thrones and the daily are backed by **Firebase Realtime
Database** + **Anonymous Auth**, loaded lazily so offline modes never fetch the
SDK.

---

## Repository layout

GitHub Pages serves the **`docs/`** folder. Keep this structure exactly
(paths are case-sensitive):

```
<repo root>/
├─ MANIFEST.md                 # authoritative file inventory (versions live in files)
├─ README.md                   # this file
├─ database.rules.json         # Firebase RTDB security rules (paste into console)
├─ tools/                      # build + test scripts (NOT served)
│   ├─ generate-data.mjs
│   ├─ generate-movestats.mjs
│   ├─ apply-movestats.mjs
│   └─ test/                   # zero-dependency unit tests
│       ├─ run.mjs  _harness.mjs  sim.test.mjs  draft.test.mjs  engine.test.mjs
└─ docs/                       # ← GitHub Pages root
    ├─ index.html
    ├─ .nojekyll               # empty; stops Pages stripping js/-prefixed paths
    ├─ css/styles.css
    ├─ js/
    │   ├─ main.js  modes.js
    │   ├─ draft.js  sim.js    # ← in docs/js/ (NOT lib/); the adapter imports ../draft.js
    │   ├─ lib/                # shared logic
    │   │   ├─ dom.js  draft-adapter.js  engine.js  firebase.js
    │   │   ├─ identity.js  leaderboard-data.js  share.js
    │   └─ modes/              # one controller per screen
    │       ├─ single.js  pokedex.js  safari.js  victoryroad.js
    │       ├─ multiplayer.js  leaderboard.js  draftbattle.js
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

Pure logic (engine / battle sim / draft engine) has zero-dependency Node tests:

```bash
node tools/test/run.mjs          # exits non-zero on any failure (CI-friendly)
```

Covers `sim.js` (stat conversion, determinism, win accounting, type immunity),
`draft.js` (two-picks-per-card sourced from the correct card, type-twice→mono,
"—" picks, completion with zero mis-sourced picks, daily determinism, weighted
move reroll, autoDraft) and `engine.js` (round setup, clue purchase, scoring).

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
