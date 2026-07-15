/**
 * @file        docs/js/lib/music.js
 * @version     2.1.0
 * @updated     2026-07-15
 * @changelog
 *   2.1.0 — Transition SFX no longer overlap the track they precede.
 *           `TRANSITIONS_ENABLED` (a plain exported const, edit this file to
 *           flip it) now gates the transition sound entirely: OFF (the new
 *           default, per request) skips the transition sound completely and
 *           switches tracks immediately, exactly like before transition SFX
 *           ever existed. ON defers the new track until the transition sound
 *           actually finishes playing — via the real `ended` event on the SFX
 *           element, so the wait matches that specific sound's real length
 *           rather than a guessed/hardcoded number — with a safety timeout
 *           (`SFX_TRANSITION_TIMEOUT_MS`, 3s) so a missing/broken SFX file
 *           can never hang navigation. A staleness guard skips starting the
 *           deferred track if the player has already navigated somewhere else
 *           again while the transition sound was still playing. None of this
 *           touches `playGameStart()` — the game-start cue is a separate,
 *           always-on, non-track-changing overlay regardless of this toggle.
 *   2.0.0 — Reworked around a more robust "every slot has a default" model,
 *           per user request:
 *           (a) MUSIC: every registered game mode now gets its OWN dedicated
 *           track file (no more forced sharing groups) — Hotseat, Online, and
 *           Daily Challenge each split off from the mode they used to share
 *           with. If a specific mode's file doesn't exist (or fails to load),
 *           playback falls back to ONE shared `default.mp3` automatically —
 *           so adding a new mode later, or not having gotten around to a
 *           track yet, never breaks anything or goes silent by accident. The
 *           fallback is a real runtime check (an `error` listener that swaps
 *           the `<audio>` src to the default and retries once), not just a
 *           lookup-table default.
 *           (b) TRANSITION SFX get the same treatment: 'enterGuess'/'toMenu'
 *           each fall back to the shared 'generic' transition sound if their
 *           own file is missing, and 'generic' itself IS the ultimate
 *           default (nothing falls back further than that).
 *           (c) NEW: a "game start" SFX, played via the new public
 *           `music.playGameStart()` — independent of setRoute()/crossfade
 *           entirely. Call it from a mode's actual "Start"-type button; it
 *           layers a quick one-shot sound over whatever's already playing
 *           without touching the track. Wired into every mode with a real
 *           start action (draftbattle/dailychallenge via startDraft(), single,
 *           safari, victoryroad, multiplayer, online's first round, race).
 *   1.2.0 — Every navigation now bridges with SOME transition sound — no
 *           destination is silent-by-omission anymore. `transitionSfxForRoute()`
 *           still returns the SPECIFIC sound for the named destinations
 *           (entering single / safari / victoryroad / multiplayer-hotseat /
 *           online plays 'enterGuess'; returning to the main menu plays
 *           'toMenu' — online added to the enterGuess group this version) —
 *           but every OTHER destination (draftbattle, dailychallenge, race,
 *           pokedex, leaderboard, and any future mode with no explicit entry)
 *           now falls back to one shared 'generic' transition sound
 *           (DEFAULT_TRANSITION_SFX) instead of playing nothing. The function
 *           never returns null anymore.
 *   1.1.0 — (a) Cycling Road (the `race` mode) now has its OWN music track
 *           instead of sharing the multiplayer track — its own key 'race'
 *           (./audio/music/cycling-road.mp3). (b) Transition sound effects:
 *           when the music changes on navigation, a short one-shot SFX now
 *           bridges the switch so it isn't a jarring cut. Two transitions are
 *           mapped (pure, unit-tested `transitionSfxForRoute()`): entering a
 *           guess mode (single / safari / victoryroad / multiplayer-hotseat)
 *           plays 'enterGuess'; returning to the main menu plays 'toMenu'.
 *           Other destinations just crossfade with no SFX. SFX obey the same
 *           mute toggle and gesture-gating as the music, and a missing SFX
 *           file fails silently just like a missing track.
 *   1.0.0 — Initial background-music manager. Maps the current route (a mode
 *           id, or null for the main menu) to a track key via the pure
 *           `trackKeyForRoute()` (unit-tested separately from the DOM/Audio
 *           side), crossfades between tracks using two alternating <audio>
 *           elements, and persists a mute preference in localStorage. Works
 *           around browser autoplay restrictions: playback is only ever
 *           started from inside a real user-gesture handler (the toggle
 *           button, or the first click/keydown/touchstart anywhere on the
 *           page), never from a bare `.play()` call at load time. Missing or
 *           not-yet-supplied audio files fail silently — same "degrades
 *           gracefully without the asset" convention as the silhouette
 *           sprites (see MANIFEST.md) — so the game is fully playable before
 *           any music files are ever dropped in.
 * ---------------------------------------------------------------------------
 * HOW TO ADD/CHANGE TRACKS
 *   1. Drop an .mp3 into docs/audio/music/ using one of the filenames in
 *      TRACK_FILES below (or add a new key + filename for a new mode).
 *   2. Nothing else needs to change — if a mode's file is missing, it just
 *      plays default.mp3 instead of breaking or going silent.
 *   To make two modes intentionally sound the same, just use identical audio
 *   content for both of their files (or point one's TRACK_FILES entry at the
 *   other's path).
 */

// ---- pure route -> track-key mapping (unit-tested) -------------------------
// Every mode now gets its OWN key (no more forced sharing groups) — the key IS
// the mode id itself. This function exists mainly so callers never hardcode
// "null means menu" themselves, and to leave room for exceptions later.
export function trackKeyForRoute(modeId) {
  return modeId || 'menu';
}

// ---- track key -> file path -------------------------------------------------
// Paths are relative to docs/index.html (the site root once deployed), same
// convention as the ./data/*.json fetches in main.js. Every currently
// registered mode has its own entry; a mode added later with no entry here
// (or whose file 404s) automatically falls back to DEFAULT_TRACK_FILE.
export const TRACK_FILES = {
  menu: './audio/music/menu.mp3',
  draftbattle: './audio/music/draft-battle.mp3',
  dailychallenge: './audio/music/daily-challenge.mp3',
  single: './audio/music/guess.mp3',
  safari: './audio/music/safari.mp3',
  victoryroad: './audio/music/victory-road.mp3',
  multiplayer: './audio/music/multiplayer.mp3',
  online: './audio/music/online.mp3',
  race: './audio/music/cycling-road.mp3',
  pokedex: './audio/music/pokedex.mp3',
  leaderboard: './audio/music/leaderboard.mp3',
};

// The universal fallback: used whenever a resolved key has no TRACK_FILES
// entry at all, AND (via a runtime `error` listener, not just a lookup
// default) whenever that key's own file fails to load.
export const DEFAULT_TRACK_FILE = './audio/music/default.mp3';

// ---- transition-sound on/off switch -----------------------------------------
// Edit this one line to turn transition SFX back on. OFF (current default):
// setRoute() switches tracks immediately with no bridging sound at all — same
// as if transition SFX never existed. ON: the transition sound plays to its
// own real, variable length BEFORE the new track starts (see
// _playSfxThen/SFX_TRANSITION_TIMEOUT_MS below) so the two never overlap.
// playGameStart() is unaffected either way — it's a separate overlay cue, not
// a track change.
export const TRANSITIONS_ENABLED = false;

// ---- transition sound effects (unit-tested) --------------------------------
// A short one-shot SFX played over the music crossfade so a track change is
// NEVER a jarring cut. Keyed by DESTINATION. Every navigation gets a
// transition sound: entering a guess mode plays a specific "start guessing"
// sound, returning to the main menu plays a specific "back home" sound, and
// every OTHER destination shares one generic transition sound. 'generic' is
// also the ultimate fallback file if 'enterGuess' or 'toMenu' hasn't been
// supplied yet — nothing falls back further than 'generic'.
export const TRANSITION_SFX_BY_DEST = {
  single: 'enterGuess',
  safari: 'enterGuess',
  victoryroad: 'enterGuess',
  multiplayer: 'enterGuess', // hotseat
  online: 'enterGuess',
};

/** Pure function: destination modeId (or null for the main menu) -> transition
 *  SFX key. Never returns null — every destination gets SOME transition sound
 *  (the specific one if listed, otherwise the shared generic one). Unit-tested. */
export function transitionSfxForRoute(modeId) {
  if (!modeId) return 'toMenu';               // returning to the main menu
  return TRANSITION_SFX_BY_DEST[modeId] || 'generic';
}

export const SFX_FILES = {
  enterGuess: './audio/sfx/enter-guess.mp3',
  toMenu: './audio/sfx/to-menu.mp3',
  gameStart: './audio/sfx/game-start.mp3',
  generic: './audio/sfx/transition.mp3', // ALSO the fallback for the other keys above
};

const MUTE_KEY = 'pkguess:musicMuted';
const VOLUME = 0.5;          // base music volume once faded in
const SFX_VOLUME = 0.6;      // transition/one-shot SFX volume (a touch louder to cut through)
const FADE_MS = 900;         // crossfade duration
const FADE_STEPS = 18;
// Safety ceiling for the deferred-track wait when TRANSITIONS_ENABLED is true:
// if the transition SFX's 'ended' event never fires (missing/broken file, or
// something unexpected), the new track starts anyway after this long rather
// than navigation hanging silently forever.
const SFX_TRANSITION_TIMEOUT_MS = 3000;

function loadMutePref() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function saveMutePref(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

/**
 * Set an <audio> element's source and play it, with a ONE-HOP fallback: if
 * `primarySrc` fails to load (404, bad format, etc. — the browser fires an
 * `error` event on the element), swap to `fallbackSrc` and try once more. If
 * the fallback ALSO fails, stays silent — no loop, no repeated retries. If
 * `fallbackSrc` is null or equal to `primarySrc` there's nothing to fall back
 * to, so no listener is attached at all.
 * Exported (rather than a private method) so it can be unit-tested directly
 * against a real <audio>-like element without spinning up a MusicManager.
 */
export function loadWithFallback(el, primarySrc, fallbackSrc) {
  if (!el) return;
  // Clear any fallback listener left over from a previous call on this same
  // element (crossfade reuses two alternating elements across many track
  // changes), so listeners never stack up across repeated navigations.
  if (el._musicFallbackHandler) {
    el.removeEventListener('error', el._musicFallbackHandler);
    el._musicFallbackHandler = null;
  }
  const attemptPlay = () => {
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay-blocked or decode failure — swallow */ });
    } catch { /* some environments throw synchronously — swallow either way */ }
  };
  if (fallbackSrc && fallbackSrc !== primarySrc) {
    const handler = () => {
      el.removeEventListener('error', handler);
      el._musicFallbackHandler = null;
      try { el.src = fallbackSrc; } catch { /* ignore */ }
      attemptPlay();
    };
    el._musicFallbackHandler = handler;
    el.addEventListener('error', handler, { once: true });
  }
  try { el.src = primarySrc; } catch { /* ignore */ }
  attemptPlay();
}

/** Manages two alternating <audio> elements for click-free crossfades between
 *  tracks, gesture-gated playback, and a persisted mute toggle. Safe to call
 *  every method before any user gesture or before any audio files exist —
 *  everything here fails silently rather than throwing or logging noisily. */
class MusicManager {
  constructor() {
    this._muted = loadMutePref();
    this._unlocked = false;      // becomes true after the first user gesture
    this._currentKey = null;     // track key currently playing (or intended)
    this._players = [null, null];
    this._activeIdx = 0;
    this._fadeTimer = null;
    this._sfx = null;            // dedicated one-shot element for transition/game-start SFX
    this._pendingSfxCleanup = null; // cleans up a still-waiting _playSfxThen() call, if any
    // Captured as an instance field (rather than reading the module const
    // directly everywhere) so a test/probe can flip this one instance's
    // behavior without fighting `const` export semantics.
    this._transitionsEnabled = TRANSITIONS_ENABLED;
    this._onToggle = new Set();  // listeners for mute-state changes (UI button)
  }

  init() {
    if (this._players[0]) return; // already initialized
    this._players = [0, 1].map(() => {
      const a = new Audio();
      a.loop = true;
      a.preload = 'none';
      a.volume = 0;
      a.addEventListener('error', () => { /* both primary+fallback failed — ignore, stay silent */ });
      return a;
    });
    // One-shot element for transition/game-start SFX (not looped, plays over
    // whatever music/crossfade is already happening).
    this._sfx = new Audio();
    this._sfx.preload = 'none';
    this._sfx.volume = SFX_VOLUME;
    this._sfx.addEventListener('error', () => { /* both primary+fallback failed — ignore */ });
    // Autoplay policies block audio started without a user gesture. Rather
    // than ever attempting an unprompted play() (which would just warn to the
    // console and do nothing), we wait for the first real interaction
    // anywhere on the page and start whatever track is current at that point.
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      if (this._currentKey && !this._muted) this._playCurrent();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** Call on every route change (mode id, or null for the main menu). */
  setRoute(modeId) {
    const key = trackKeyForRoute(modeId);
    if (key === this._currentKey) return; // already on the right track — no change, no SFX
    const prevKey = this._currentKey;
    this._currentKey = key;
    if (!this._unlocked || this._muted) return;
    // Bridge the music change with a transition SFX — but only when a track
    // was already playing (prevKey non-null), so the very first track after
    // load starts cleanly with no transition sound, AND only when transitions
    // are actually turned on.
    if (prevKey !== null && this._transitionsEnabled) {
      this._playSfxThen(transitionSfxForRoute(modeId), () => {
        // If the player has already navigated somewhere else again while the
        // transition sound was still playing, this callback is stale — the
        // newer setRoute() call already started (or will start) the right
        // track, so don't step on it.
        if (this._currentKey === key) this._playCurrent();
      });
    } else {
      this._playCurrent();
    }
  }

  /**
   * Play the "game start" one-shot SFX, layered over whatever music is
   * currently playing — this NEVER changes the track or touches the
   * crossfade, it's fully independent of setRoute(). Call this from a mode's
   * actual "Start"/"Begin"/"Enter" button, not on merely opening the mode's
   * menu screen. Obeys mute + the same first-gesture gating as everything
   * else; a no-op before either.
   */
  playGameStart() {
    if (this._unlocked && !this._muted) this._playSfx('gameStart');
  }

  isMuted() { return this._muted; }

  toggleMute() {
    this._muted = !this._muted;
    saveMutePref(this._muted);
    if (this._muted) {
      this._players.forEach((a) => a && a.pause());
    } else if (this._unlocked) {
      this._playCurrent();
    }
    for (const fn of this._onToggle) { try { fn(this._muted); } catch { /* ignore */ } }
    return this._muted;
  }

  /** Subscribe to mute-state changes (used by the toggle button's icon). */
  onToggle(fn) { this._onToggle.add(fn); return () => this._onToggle.delete(fn); }

  _playSfx(sfxKey) {
    if (!this._sfx) return;
    const primary = SFX_FILES[sfxKey] || SFX_FILES.generic;
    const fallback = primary === SFX_FILES.generic ? null : SFX_FILES.generic;
    try {
      this._sfx.currentTime = 0;
      loadWithFallback(this._sfx, primary, fallback);
    } catch { /* stay silent */ }
  }

  /**
   * Play a transition SFX to completion, then invoke `callback` — used only
   * when TRANSITIONS_ENABLED so the new track never overlaps the sound
   * announcing it. Waits for the real `ended` event (so the delay matches
   * that specific sound's actual length, not a guess), with a fixed safety
   * timeout in case the SFX can't play at all (missing file, autoplay
   * blocked, etc.) so navigation can never hang silently forever.
   */
  _playSfxThen(sfxKey, callback) {
    if (!this._sfx) { callback(); return; }
    // If a PRIOR call is still waiting (rapid back-to-back navigation before
    // the first transition sound finished), clean it up first so listeners
    // never pile up on the shared element — its own staleness guard in
    // setRoute() already makes this safe either way, but this keeps the
    // element's listener count bounded to at most one pending wait at a time.
    if (this._pendingSfxCleanup) { this._pendingSfxCleanup(); this._pendingSfxCleanup = null; }
    const primary = SFX_FILES[sfxKey] || SFX_FILES.generic;
    const fallback = primary === SFX_FILES.generic ? null : SFX_FILES.generic;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      this._sfx.removeEventListener('ended', onEnded);
      if (this._pendingSfxCleanup === cleanup) this._pendingSfxCleanup = null;
      callback();
    };
    const onEnded = () => finish();
    const cleanup = () => { clearTimeout(safetyTimer); this._sfx.removeEventListener('ended', onEnded); };
    this._pendingSfxCleanup = cleanup;
    this._sfx.addEventListener('ended', onEnded, { once: true });
    const safetyTimer = setTimeout(finish, SFX_TRANSITION_TIMEOUT_MS);
    try {
      this._sfx.currentTime = 0;
      loadWithFallback(this._sfx, primary, fallback);
    } catch {
      finish();
    }
  }

  _playCurrent() {
    const key = this._currentKey;
    const primary = TRACK_FILES[key] || DEFAULT_TRACK_FILE;
    const fallback = primary === DEFAULT_TRACK_FILE ? null : DEFAULT_TRACK_FILE;
    const nextIdx = 1 - this._activeIdx;
    const incoming = this._players[nextIdx];
    const outgoing = this._players[this._activeIdx];
    if (!incoming) return;
    try {
      incoming.currentTime = 0;
      incoming.volume = 0;
      loadWithFallback(incoming, primary, fallback);
      this._activeIdx = nextIdx;
      this._crossfade(incoming, outgoing);
    } catch { /* stay silent, leave state unchanged */ }
  }

  _crossfade(incoming, outgoing) {
    if (this._fadeTimer) clearInterval(this._fadeTimer);
    let step = 0;
    this._fadeTimer = setInterval(() => {
      step++;
      const t = Math.min(1, step / FADE_STEPS);
      incoming.volume = VOLUME * t;
      if (outgoing) outgoing.volume = VOLUME * (1 - t);
      if (t >= 1) {
        clearInterval(this._fadeTimer);
        this._fadeTimer = null;
        if (outgoing) outgoing.pause();
      }
    }, FADE_MS / FADE_STEPS);
  }
}

export const music = new MusicManager();
