# Sound effects: transitions + game start

Two kinds of short one-shot sound live here:

1. **Transition sounds** — bridge a music change when you move between
   screens.
2. **The game-start sound** — plays when a round actually *begins* (clicking
   "Start game" / "Enter the Safari Zone" / etc. inside a mode), layered over
   whatever music is already playing. Opening a mode's menu does **not**
   trigger this — only actually starting play does, so it doesn't double up
   with the transition sound you just heard arriving at the menu.

**Transition sounds are currently turned OFF** (see below) — music switches
tracks instantly with no bridging sound at all, which is how the game plays
right now regardless of whether these files exist. The game-start sound is
unaffected by this and always plays normally.

The app works fine with any or all of these files missing — a missing file
just means no sound for that moment, never an error, and (for the two grouped
transition sounds below) missing ones fall back sensibly instead of going
silent. Drop `.mp3` files here.

## Turning transition sounds on/off

Open `docs/js/lib/music.js` and find this line near the top:

```js
export const TRANSITIONS_ENABLED = false;
```

Change `false` to `true` to turn transition sounds back on. When they're on,
the new track waits for the transition sound to actually finish playing
before it starts — it uses that sound's real length, not a guess, so a 2-
second sound and a 500ms sound both work correctly with no overlap. If a
transition sound is missing or broken, the new track still starts after a
short safety delay rather than navigation hanging.

## Filenames (exact)

| File               | Plays when… (once transitions are turned back on)                 |
|--------------------|--------------------------------------------------------------------|
| `enter-guess.mp3`  | Entering a guess mode: Single Player, Safari Zone, Victory Road, Hotseat, or Online multiplayer |
| `to-menu.mp3`      | Returning to the main menu from anywhere                           |
| `transition.mp3`   | Every OTHER track change: Draft Battle, Daily Challenge, Cycling Road, Pokédex, Leaderboard, and any future mode with no specific sound — **also the fallback if `enter-guess.mp3` or `to-menu.mp3` is missing** |
| `game-start.mp3`   | A round/battle/draft actually starting (see the mode-by-mode list below) — **plays regardless of the transitions toggle above** |

**If `enter-guess.mp3` or `to-menu.mp3` isn't there yet**, that navigation
automatically uses `transition.mp3` instead of playing nothing — so the site
is never silently jarring, even with just one sfx file in this whole folder.
`transition.mp3` itself is the true floor: if even that's missing, the
navigation is silent (but still works perfectly fine).

**If `game-start.mp3` isn't there yet**, starting a round currently plays
`transition.mp3` as a stand-in (same "always something, never silent"
principle) until you add a dedicated one.

### Where `game-start.mp3` is wired in

| Mode | Fires on |
|---|---|
| Draft Battle / Daily Challenge / Draft Again | the moment a draft actually kicks off (`startDraft()`, shared by all three) |
| Single Player | clicking "Start game" |
| Safari Zone | clicking "Enter the Safari Zone" |
| Victory Road | clicking "Enter Victory Road" |
| Hotseat | clicking "Start Multiplayer" |
| Online | the leader clicking "Start game" for round 1 |
| Cycling Road | clicking "Start" (either the teams or no-teams lobby) |

Pokédex and Leaderboard are reference screens with no "round" to start, so
they don't call this.

## Adding your own sound for a specific mode

Right now the transition sounds are grouped (guess modes share one, everything
else shares another). To give a mode a genuinely different transition sound of
its own, add an entry to `TRANSITION_SFX_BY_DEST` (and, if it's a new sound
file, add it to `SFX_FILES`) in `docs/js/lib/music.js`.

## Notes

- Keep these **short** — think a half-second to ~1.5s "whoosh", "chime", or
  "blip". They play once, overlapping whatever's already happening.
- They obey the same 🔊/🔇 mute toggle as the music (muted = no SFX at all)
  and, like the music, only start after your first interaction with the page
  (browser autoplay rules) — except the game-start cue, which is itself
  triggered by a real click, so it also works as a "first interaction" if
  someone somehow reaches a Start button before clicking anything else.
- A missing file is skipped (or falls back, per the table above) — never an
  error — so you can add these whenever, in any order.
- Legal note: these should be your own or royalty-free/CC sounds, not clips
  ripped from the official games (see the music README).
