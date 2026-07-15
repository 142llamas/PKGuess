/**
 * @file tools/test/music.test.mjs
 * @version 1.0.0
 * New file — covers the one pure, directly-testable piece of the background-
 * music system (music.js 1.0.0): trackKeyForRoute(), the route -> track-key
 * mapping. The MusicManager itself drives <audio>/localStorage and needs a DOM,
 * so it isn't exercised here; this suite pins the mapping every mode depends on,
 * including the deliberate track-sharing (Draft+Daily, all Multiplayer modes)
 * and the null/unknown -> 'menu' fallbacks.
 */
import { trackKeyForRoute, TRACK_KEY_BY_MODE, TRACK_FILES } from '../../docs/js/lib/music.js';
import { MODES } from '../../docs/js/modes.js';

export default function (t) {
  t.section('music.js — trackKeyForRoute: menu / fallback');
  {
    t.eq(trackKeyForRoute(null), 'menu', 'null (main menu) maps to the menu track');
    t.eq(trackKeyForRoute(undefined), 'menu', 'undefined maps to the menu track');
    t.eq(trackKeyForRoute(''), 'menu', 'empty string maps to the menu track');
    t.eq(trackKeyForRoute('nonexistent-mode'), 'menu', 'an unknown mode id falls back to the menu track, not undefined');
  }

  t.section('music.js — trackKeyForRoute: per-mode mapping');
  {
    t.eq(trackKeyForRoute('single'), 'guess', 'Single Player -> guess');
    t.eq(trackKeyForRoute('safari'), 'safari', 'Safari -> safari');
    t.eq(trackKeyForRoute('victoryroad'), 'victoryroad', 'Victory Road -> victoryroad');
    t.eq(trackKeyForRoute('pokedex'), 'pokedex', 'Pokédex -> pokedex');
    t.eq(trackKeyForRoute('leaderboard'), 'leaderboard', 'Leaderboard -> leaderboard');
  }

  t.section('music.js — trackKeyForRoute: deliberate track sharing');
  {
    // Draft Battle and Daily Challenge are the same core gameplay, so they
    // intentionally share one track. If someone splits these later this test
    // should be updated alongside the mapping — it's here to make the sharing
    // a conscious decision rather than an accident.
    t.eq(trackKeyForRoute('draftbattle'), 'draft', 'Draft Battle -> draft');
    t.eq(trackKeyForRoute('dailychallenge'), 'draft', 'Daily Challenge shares the draft track');
    t.ok(trackKeyForRoute('draftbattle') === trackKeyForRoute('dailychallenge'), 'Draft Battle and Daily Challenge share one track');

    // All three Multiplayer modes share one track for the same reason.
    t.eq(trackKeyForRoute('multiplayer'), 'multiplayer', 'Hotseat -> multiplayer');
    t.eq(trackKeyForRoute('online'), 'multiplayer', 'Online shares the multiplayer track');
    t.eq(trackKeyForRoute('race'), 'multiplayer', 'Cycling Road shares the multiplayer track');
  }

  t.section('music.js — every real mode resolves, and every mapped key has a file');
  {
    // No registered mode should ever fall through to 'menu' by accident — if a
    // new mode is added to modes.js without a music entry this catches it.
    for (const m of MODES) {
      const key = trackKeyForRoute(m.id);
      t.ok(TRACK_KEY_BY_MODE[m.id] !== undefined,
        `mode "${m.id}" has an explicit track mapping (resolved to "${key}")`);
    }
    // Every track key referenced by the mapping must have a corresponding file
    // path defined, or that mode would silently never play anything.
    const keysInUse = new Set(['menu', ...Object.values(TRACK_KEY_BY_MODE)]);
    for (const key of keysInUse) {
      t.ok(typeof TRACK_FILES[key] === 'string' && TRACK_FILES[key].endsWith('.mp3'),
        `track key "${key}" maps to an .mp3 file path`);
    }
  }
}
