# Background music

Drop `.mp3` files here to give each part of the game its own looping track.
**Every game mode — plus the main menu — has its own dedicated file slot,
with no sharing between modes by default.** The app works fine with none, some,
or all of these missing: any mode whose file is missing (or fails to load)
automatically falls back to the shared `default.mp3` instead of going silent —
so you can add tracks one at a time, in any order, and nothing ever breaks or
sounds wrong in the meantime.

## Filenames (exact)

| File                     | Plays on           |
|--------------------------|--------------------|
| `menu.mp3`               | Main menu          |
| `draft-battle.mp3`       | Draft Battle       |
| `daily-challenge.mp3`    | Daily Challenge (its own track, separate from Draft Battle) |
| `guess.mp3`              | Single Player      |
| `safari.mp3`             | Safari Zone        |
| `victory-road.mp3`       | Victory Road       |
| `multiplayer.mp3`        | Hotseat            |
| `online.mp3`             | Online (its own track, separate from Hotseat) |
| `cycling-road.mp3`       | Cycling Road       |
| `pokedex.mp3`            | Pokédex            |
| `leaderboard.mp3`        | Leaderboard        |
| `default.mp3`            | **The fallback** — plays for any mode whose own file above is missing/broken, and for any future mode added later with no file of its own |

**Want two modes to sound the same?** There's no "sharing" setting anymore —
just use the same audio content for both files (or don't bother making one of
them at all, so it falls back to `default.mp3`, and make sure the other mode's
own file is what you want everyone hearing there too).

**Transition sound effects** (short sounds played *between* tracks so a switch
isn't jarring) and the **game-start cue** (a quick sound layered over the music
when a round actually begins) live in a sibling folder, `../sfx/` — see its
README.

## How the fallback actually works

This isn't just "if you forgot a file, nothing plays." Each mode's music is
attempted first; if that specific file 404s (or was never added), the code
catches the real load failure and automatically retries with `default.mp3` —
so even a half-finished audio folder always plays *something* sensible rather
than going silent partway through your project. The route→file mapping lives
in `docs/js/lib/music.js` (`TRACK_FILES` + `DEFAULT_TRACK_FILE`) if you ever
want to point a mode at a different filename.

## Format notes

- **MP3** is the safe choice (plays everywhere). `.ogg` also works in most
  browsers but not older Safari, so stick with mp3 unless you have a reason.
- Tracks loop seamlessly, so pick/export loops with matching start & end.
- Keep files reasonably small (a minute or two, looped) so the page stays light.
- Volume is set in code (0.5) with a short crossfade between screens.
- Legal note: use your own or royalty-free/CC music, not tracks ripped from the
  official games — even short clips are copyrighted, and this is a live site.
