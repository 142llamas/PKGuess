/**
 * @file        js/lib/draft-adapter.js
 * @version     1.3.0
 * @updated     2026-07-05
 * @changelog
 *   1.3.0 — re-export isTierUnlocked + nextProgressRank (#12/#13).
 *   1.2.0 — re-export resolveThroneCascade + TIER_RANK (#14a).
 *   1.1.0 — re-export autoDraftScaled (#7).
 *   1.0.0 — Thin re-export shim. The vetted draft.js and sim.js live in
 *           docs/js/ (not in lib/) because they were spec-locked as provided
 *           files. This adapter lets mode controllers import them cleanly
 *           from lib/ without modifying the vetted source.
 */

export {
  DraftSession,
  autoDraft,
  autoDraftScaled,
  resolveThroneCascade,
  TIER_RANK,
  isTierUnlocked,
  nextProgressRank,
  buildSpeciesList,
  buildLearnsetMap,
  normalizeSpecies,
  parseBaseStats,
  STAT_KEYS,
} from '../draft.js';

export { toRealStats, moveId, simulateBattle, runMatch } from '../sim.js';
