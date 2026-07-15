# Background music

Drop `.mp3` files here to give each part of the game its own looping track.
The app works fine with this folder empty — any missing file is simply skipped,
so you can add tracks one at a time.

## Filenames (exact)

| File                     | Plays on                                   |
|--------------------------|--------------------------------------------|
| `menu.mp3`               | Main menu (and any screen with no track)   |
| `draft-battle.mp3`       | Draft Battle **and** Daily Challenge        |
| `guess.mp3`              | Single Player                              |
| `safari.mp3`             | Safari Zone                                |
| `victory-road.mp3`       | Victory Road                               |
| `multiplayer.mp3`        | Hotseat, Online, **and** Cycling Road       |
| `pokedex.mp3`            | Pokédex                                     |
| `leaderboard.mp3`        | Leaderboard                                |

The route → track mapping lives in `docs/js/lib/music.js`. To give a mode its
own track instead of sharing (e.g. split Cycling Road off from the other
multiplayer modes), add a new filename to `TRACK_FILES` there and point that
mode at it in `TRACK_KEY_BY_MODE`.

## Format notes

- **MP3** is the safe choice (plays everywhere). `.ogg` also works in most
  browsers but not older Safari, so stick with mp3 unless you have a reason.
- Tracks loop seamlessly, so pick/export loops with matching start & end.
- Keep files reasonably small (a minute or two, looped) so the page stays light.
- Volume is set in code (0.5) with a short crossfade between screens.
