/**
 * @file        docs/js/lib/music.js
 * @version     1.0.0
 * @updated     2026-07-14
 * @changelog
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
 *      TRACK_FILES below (or add a new key + filename).
 *   2. If you want a *mode* to use a different track than its current
 *      group-mate, add/change its entry in TRACK_KEY_BY_MODE.
 *   That's it — nothing else in the app needs to change.
 */

// ---- pure route -> track-key mapping (unit-tested) -------------------------
// Several modes intentionally SHARE a track by default (e.g. all three
// Multiplayer modes, and Draft Battle + Daily Challenge, which are the same
// core gameplay with a different entry point). Split any of these later by
// giving that mode id its own key here — no other code needs to change.
export const TRACK_KEY_BY_MODE = {
  draftbattle: 'draft',
  dailychallenge: 'draft',
  single: 'guess',
  safari: 'safari',
  victoryroad: 'victoryroad',
  multiplayer: 'multiplayer',
  online: 'multiplayer',
  race: 'multiplayer',
  pokedex: 'pokedex',
  leaderboard: 'leaderboard',
};

/** Pure function: modeId (string) or null/undefined (main menu) -> track key.
 *  Unknown/future mode ids fall back to 'menu' rather than throwing, so a
 *  newly-added mode that hasn't been assigned a track yet just plays the
 *  menu music instead of erroring or falling silent. */
export function trackKeyForRoute(modeId) {
  if (!modeId) return 'menu';
  return TRACK_KEY_BY_MODE[modeId] || 'menu';
}

// ---- track key -> file path -------------------------------------------------
// Paths are relative to docs/index.html (the site root once deployed), same
// convention as the ./data/*.json fetches in main.js.
export const TRACK_FILES = {
  menu: './audio/music/menu.mp3',
  draft: './audio/music/draft-battle.mp3',
  guess: './audio/music/guess.mp3',
  safari: './audio/music/safari.mp3',
  victoryroad: './audio/music/victory-road.mp3',
  multiplayer: './audio/music/multiplayer.mp3',
  pokedex: './audio/music/pokedex.mp3',
  leaderboard: './audio/music/leaderboard.mp3',
};

const MUTE_KEY = 'pkguess:musicMuted';
const VOLUME = 0.5;          // base volume once faded in
const FADE_MS = 900;         // crossfade duration
const FADE_STEPS = 18;

function loadMutePref() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function saveMutePref(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
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
    this._onToggle = new Set();  // listeners for mute-state changes (UI button)
  }

  init() {
    if (this._players[0]) return; // already initialized
    this._players = [0, 1].map(() => {
      const a = new Audio();
      a.loop = true;
      a.preload = 'none';
      a.volume = 0;
      a.addEventListener('error', () => { /* missing/broken file — ignore */ });
      return a;
    });
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
    if (key === this._currentKey) return; // already on the right track
    this._currentKey = key;
    if (this._unlocked && !this._muted) this._playCurrent();
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

  _playCurrent() {
    const src = TRACK_FILES[this._currentKey];
    if (!src) return;
    const nextIdx = 1 - this._activeIdx;
    const incoming = this._players[nextIdx];
    const outgoing = this._players[this._activeIdx];
    if (!incoming) return;
    try {
      incoming.src = src;
      incoming.currentTime = 0;
      incoming.volume = 0;
      // play() may reject a promise (autoplay blocked) OR throw synchronously
      // in some environments — handle both so neither can bubble up and break
      // navigation. A failure here just means "no music", never a broken app.
      const playPromise = incoming.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => { /* blocked or file missing — stay silent */ });
      }
      this._activeIdx = nextIdx;
      this._crossfade(incoming, outgoing);
    } catch { /* play()/src threw — stay silent, leave state unchanged */ }
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
