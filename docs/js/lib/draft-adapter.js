/**
 * @file        js/lib/draft-adapter.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Thin re-export shim. The vetted draft.js and sim.js live in
 *           docs/js/ (not in lib/) because they were spec-locked as provided
 *           files. This adapter lets mode controllers import them cleanly
 *           from lib/ without modifying the vetted source.
 */

export {
  DraftSession,
  autoDraft,
  buildSpeciesList,
  buildLearnsetMap,
  normalizeSpecies,
  parseBaseStats,
  STAT_KEYS,
} from '../draft.js';

export { toRealStats, moveId, simulateBattle, runMatch } from '../sim.js';
