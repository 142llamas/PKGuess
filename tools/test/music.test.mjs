/**
 * @file tools/test/music.test.mjs
 * @version 2.0.0
 * Covers the pure/directly-testable pieces of the background-music system
 * (music.js 2.0.0): trackKeyForRoute(), transitionSfxForRoute(), the
 * TRACK_FILES/SFX_FILES completeness (every registered mode has its OWN file,
 * no more forced sharing), and loadWithFallback() — the runtime fallback
 * mechanism that swaps a failed <audio> src to a default and retries once.
 * The MusicManager itself (gesture-gating, crossfade timing, playGameStart())
 * needs a DOM and isn't exercised here — it was verified via standalone
 * jsdom lifecycle probes during development.
 */
import {
  trackKeyForRoute, TRACK_FILES, DEFAULT_TRACK_FILE,
  transitionSfxForRoute, TRANSITION_SFX_BY_DEST, SFX_FILES,
  loadWithFallback,
} from '../../docs/js/lib/music.js';
import { MODES } from '../../docs/js/modes.js';

// Minimal fake <audio>-like element for testing loadWithFallback() in isolation,
// without needing jsdom or a real MusicManager.
function makeFakeAudio() {
  return {
    _listeners: {},
    src: '',
    played: [],
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); },
    play() { this.played.push(this.src); return Promise.resolve(); },
    fireError() { (this._listeners.error || []).slice().forEach((fn) => fn()); },
  };
}

export default function (t) {
  t.section('music.js — trackKeyForRoute: every mode gets its OWN key (no sharing)');
  {
    t.eq(trackKeyForRoute(null), 'menu', 'null (main menu) -> menu');
    t.eq(trackKeyForRoute(undefined), 'menu', 'undefined -> menu');
    t.eq(trackKeyForRoute(''), 'menu', 'empty string -> menu');
    // The key IS the mode id now — no grouping/sharing map to look up.
    t.eq(trackKeyForRoute('draftbattle'), 'draftbattle', 'Draft Battle -> its own key');
    t.eq(trackKeyForRoute('dailychallenge'), 'dailychallenge', 'Daily Challenge -> its own key (NOT draftbattle\u2019s)');
    t.ok(trackKeyForRoute('draftbattle') !== trackKeyForRoute('dailychallenge'),
      'Draft Battle and Daily Challenge are DIFFERENT keys now (used to share \u2018draft\u2019)');
    t.eq(trackKeyForRoute('multiplayer'), 'multiplayer', 'Hotseat -> its own key');
    t.eq(trackKeyForRoute('online'), 'online', 'Online -> its own key (NOT multiplayer\u2019s)');
    t.ok(trackKeyForRoute('multiplayer') !== trackKeyForRoute('online'),
      'Hotseat and Online are DIFFERENT keys now (used to share \u2018multiplayer\u2019)');
    t.eq(trackKeyForRoute('race'), 'race', 'Cycling Road -> its own key');
    t.eq(trackKeyForRoute('an-unregistered-future-mode'), 'an-unregistered-future-mode',
      'an unknown mode id resolves to ITSELF as a key (no crash) — TRACK_FILES lookup then falls back to default');
  }

  t.section('music.js — TRACK_FILES: every current mode has its own dedicated file');
  {
    for (const m of MODES) {
      t.ok(typeof TRACK_FILES[m.id] === 'string' && TRACK_FILES[m.id].endsWith('.mp3'),
        `mode "${m.id}" has its own TRACK_FILES entry`);
    }
    t.ok(typeof TRACK_FILES.menu === 'string', 'menu has its own TRACK_FILES entry');
    // Sanity: no two modes accidentally point at the exact same file path
    // (that would silently recreate the old sharing behaviour by accident).
    const paths = MODES.map((m) => TRACK_FILES[m.id]);
    t.eq(new Set(paths).size, paths.length, 'no two modes share an identical file path (sharing is opt-in only, via TRACK_FILES, not automatic)');
    t.ok(typeof DEFAULT_TRACK_FILE === 'string' && DEFAULT_TRACK_FILE.endsWith('.mp3'), 'DEFAULT_TRACK_FILE is a real .mp3 path');
    t.ok(!Object.values(TRACK_FILES).includes(DEFAULT_TRACK_FILE), 'no mode\u2019s specific file IS the default file (so fallback is meaningfully distinct)');
  }

  t.section('music.js — transitionSfxForRoute: entering guess modes (including Online)');
  {
    t.eq(transitionSfxForRoute('single'), 'enterGuess', 'Single Player -> enterGuess');
    t.eq(transitionSfxForRoute('safari'), 'enterGuess', 'Safari Zone -> enterGuess');
    t.eq(transitionSfxForRoute('victoryroad'), 'enterGuess', 'Victory Road -> enterGuess');
    t.eq(transitionSfxForRoute('multiplayer'), 'enterGuess', 'Hotseat -> enterGuess');
    t.eq(transitionSfxForRoute('online'), 'enterGuess', 'Online -> enterGuess');
  }

  t.section('music.js — transitionSfxForRoute: returning to menu');
  {
    t.eq(transitionSfxForRoute(null), 'toMenu', 'null (main menu) -> toMenu');
    t.eq(transitionSfxForRoute(undefined), 'toMenu', 'undefined (main menu) -> toMenu');
  }

  t.section('music.js — transitionSfxForRoute: unlisted destinations share ONE generic transition sound');
  {
    for (const id of ['draftbattle', 'dailychallenge', 'race', 'pokedex', 'leaderboard']) {
      t.eq(transitionSfxForRoute(id), 'generic', `${id} -> the shared generic transition sound (not silent)`);
    }
    t.eq(transitionSfxForRoute('nonexistent-mode'), 'generic', 'an unknown mode id -> the shared generic transition sound, not null');
    t.ok(transitionSfxForRoute('draftbattle') !== null, 'sanity: transitionSfxForRoute never returns null for a real destination');
    for (const m of MODES) {
      t.ok(transitionSfxForRoute(m.id) !== null, `mode "${m.id}" resolves to a non-null transition sound`);
    }
  }

  t.section('music.js — SFX_FILES: every transition key has a file, including the new gameStart sound');
  {
    const sfxKeysInUse = new Set(['toMenu', 'generic', 'gameStart', ...Object.values(TRANSITION_SFX_BY_DEST)]);
    for (const key of sfxKeysInUse) {
      t.ok(typeof SFX_FILES[key] === 'string' && SFX_FILES[key].endsWith('.mp3'),
        `transition SFX key "${key}" maps to an .mp3 file path`);
    }
    t.ok(SFX_FILES.gameStart !== SFX_FILES.generic, 'the new game-start SFX is its own distinct file, not just an alias for generic');
  }

  t.section('music.js — loadWithFallback(): the runtime "swap to default on error" mechanism');
  {
    // Case 1: primary loads fine — no fallback needed, no error ever fires.
    let el = makeFakeAudio();
    loadWithFallback(el, 'primary.mp3', 'default.mp3');
    t.eq(el.src, 'primary.mp3', 'primary succeeds: src stays on the primary file');
    t.eq(JSON.stringify(el.played), JSON.stringify(['primary.mp3']), 'primary succeeds: played exactly once, the primary file');

    // Case 2: primary 404s (browser fires `error`) — swaps to the fallback and retries once.
    el = makeFakeAudio();
    loadWithFallback(el, 'missing.mp3', 'default.mp3');
    el.fireError();
    t.eq(el.src, 'default.mp3', 'primary fails: src swaps to the fallback');
    t.eq(JSON.stringify(el.played), JSON.stringify(['missing.mp3', 'default.mp3']), 'primary fails: attempted the primary, then the fallback');

    // Case 3: BOTH primary and fallback fail — stays put, no infinite retry loop.
    el = makeFakeAudio();
    loadWithFallback(el, 'missing.mp3', 'also-missing.mp3');
    el.fireError(); // primary fails -> swap to fallback
    el.fireError(); // fallback ALSO fails -> should be a no-op (listener already removed)
    t.eq(JSON.stringify(el.played), JSON.stringify(['missing.mp3', 'also-missing.mp3']),
      'both fail: exactly 2 attempts total, no runaway retries');

    // Case 4: no distinct fallback to offer (already on the default) — no listener attached at all.
    el = makeFakeAudio();
    loadWithFallback(el, 'default.mp3', null);
    t.eq((el._listeners.error || []).length, 0, 'no fallback available: no error listener is attached');

    // Case 5: repeated calls on the SAME element (crossfade reuses two alternating
    // elements across many navigations) never stack up listeners.
    el = makeFakeAudio();
    loadWithFallback(el, 'a.mp3', 'default.mp3');
    loadWithFallback(el, 'b.mp3', 'default.mp3');
    loadWithFallback(el, 'c.mp3', 'default.mp3');
    t.eq((el._listeners.error || []).length, 1, 'repeated calls on one element leave exactly ONE error listener, not one per call');
  }
}
