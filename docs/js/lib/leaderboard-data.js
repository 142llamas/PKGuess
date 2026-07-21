/**
 * @file        js/lib/leaderboard-data.js
 * @version     1.1.0
 * @updated     2026-07-12
 * @changelog
 *   1.1.0 — Added an optional numeric secondary metric (+ metricLabel) to
 *           submitScore, stored alongside score. rankEntries/topEntries gained
 *           a sort option ({ sortBy:'metric', metricAsc }) so a board can rank
 *           by the metric instead of score. Backs Safari's catch-per-100-points
 *           ranking and Victory Road's optional time-per-catch sort. Entries
 *           without a metric sink to the bottom under a metric sort.
 *   1.0.0 — Pure data helpers for leaderboards (no UI, no DOM). Matches the
 *           SPEC §6 interface: submitScore, topEntries, rankEntries.
 *           Schema (SPEC §9):
 *             /leaderboard/{gen}/{mode}/{id} = { uid, name, score, detail, at }
 *           Boards: gen = 'gen1'|'gen2', mode = 'single'|'victoryroad'|'safari'
 *           Draft boards live under /draft/... and are handled by draftbattle.js.
 *
 * Usage:  await submitScore('gen2', 'single', { score: 42, detail: '...' });
 *         const top = await topEntries('gen2', 'single', 10);
 */

import { getFirebase } from './firebase.js';
import { getIdentity } from './identity.js';
import { rankDraftStats } from './draft-stats.js';

const VALID_GENS  = new Set(['gen1', 'gen2']);
const VALID_MODES = new Set(['single', 'victoryroad', 'safari']);

/**
 * Submit a score entry. Silently no-ops if Firebase is unavailable.
 * @param {'gen1'|'gen2'} gen
 * @param {'single'|'victoryroad'|'safari'} mode
 * @param {{ score:number, detail?:string }} entry
 */
export async function submitScore(gen, mode, entry) {
  if (!VALID_GENS.has(gen) || !VALID_MODES.has(mode)) return;
  try {
    const [fb, id] = await Promise.all([getFirebase(), getIdentity()]);
    const name = (id.name || 'Anonymous').slice(0, 16);
    const record = {
      uid:    id.uid,
      name,
      score:  Number(entry.score) || 0,
      detail: String(entry.detail || '').slice(0, 200),
      at:     Date.now(),
    };
    // Optional numeric secondary metric (e.g. Safari catch-per-100-pts, or
    // Victory Road time-per-catch). Stored so the board can display AND sort
    // by it without re-parsing the free-text `detail`. Omitted entirely (not
    // written as undefined — RTDB rejects that) when not provided.
    if (entry.metric != null && isFinite(Number(entry.metric))) {
      record.metric = Number(entry.metric);
      if (entry.metricLabel) record.metricLabel = String(entry.metricLabel).slice(0, 24);
    }
    await fb.push(`/leaderboard/${gen}/${mode}`, record);
  } catch (e) {
    console.warn('leaderboard submit failed:', e);
  }
}

/**
 * Read top N entries for a board, sorted by score descending.
 * Returns [] on any error.
 * @param {'gen1'|'gen2'} gen
 * @param {'single'|'victoryroad'|'safari'} mode
 * @param {number} n
 * @returns {Promise<Array<{uid,name,score,detail,at,_key}>>}
 */
export async function topEntries(gen, mode, n = 10, opts = {}) {
  if (!VALID_GENS.has(gen) || !VALID_MODES.has(mode)) return [];
  try {
    const fb = await getFirebase();
    const raw = await fb.get(`/leaderboard/${gen}/${mode}`);
    if (!raw) return [];
    return rankEntries(raw, n, opts);
  } catch (e) {
    console.warn('leaderboard read failed:', e);
    return [];
  }
}

/**
 * Read the Draft Battle per-player stat profiles and rank them for a board.
 * Reads /draft/stats (a {uid: statsBlob} map) and delegates ranking to the
 * pure rankDraftStats(). Returns [] on any error.
 * @param {number} n
 * @param {{ sortBy?: string }} opts
 */
export async function topDraftStats(n = 20, opts = {}) {
  try {
    const fb = await getFirebase();
    const raw = await fb.get('/draft/stats');
    if (!raw) return [];
    return rankDraftStats(raw, { sortBy: opts.sortBy || 'dailyFirsts', n });
  } catch (e) {
    console.warn('draft stats read failed:', e);
    return [];
  }
}
export function rankEntries(obj, n = 10, opts = {}) {
  const { sortBy = 'score', metricAsc = false } = opts;
  const rows = Object.entries(obj || {})
    .map(([_key, v]) => ({ ...v, _key }))
    .filter((e) => typeof e.score === 'number');
  if (sortBy === 'metric') {
    // Sort by the numeric secondary metric. Entries without a metric sink to
    // the bottom regardless of direction. metricAsc = lower-is-better (e.g.
    // fastest average time per catch); default = higher-is-better.
    rows.sort((a, b) => {
      const am = typeof a.metric === 'number' ? a.metric : null;
      const bm = typeof b.metric === 'number' ? b.metric : null;
      if (am == null && bm == null) return b.score - a.score || a.at - b.at;
      if (am == null) return 1;
      if (bm == null) return -1;
      return (metricAsc ? am - bm : bm - am) || b.score - a.score || a.at - b.at;
    });
  } else {
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
  }
  return rows.slice(0, n);
}
