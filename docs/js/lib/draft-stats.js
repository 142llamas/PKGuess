/**
 * @file        js/lib/draft-stats.js
 * @version     1.0.0
 * @updated     2026-07-21
 * @changelog
 *   1.0.0 — New: per-player Draft Battle stat profiles (requested). Pure
 *           logic only (no Firebase, no DOM) so every accumulation and
 *           derivation is unit-testable in isolation. draftbattle.js does the
 *           read-modify-write against /draft/stats/{uid}; this module just
 *           defines the shape and the pure transforms.
 *
 * Schema (persisted at /draft/stats/{uid}):
 *   {
 *     e4: {
 *       draftCount,                      // every E4 gauntlet run (claimed or not)
 *       spots: { day, week, month, year, all },  // times a spot was actually claimed/held
 *       moves: { [moveName]: count },    // every drafted move, tallied (favorite = mode)
 *       types: { [typeName]: count },    // every drafted type, tallied
 *       bstSum, bstCount, bstMax,        // base-stat-total accumulators (avg + highest)
 *     },
 *     daily: {
 *       days: { [dateStr]: { vsCal, vsPlayers, rank, total, isFirst, hasPlayers } },
 *     },
 *   }
 *
 * Daily is stored PER DAY (keyed by dateStr) rather than as running counters,
 * so re-viewing a day's results — or refreshing as more players enter — simply
 * overwrites that day's record idempotently instead of double-counting. The
 * profile aggregates across days on read.
 */

export const TIER_KEYS = ['day', 'week', 'month', 'year', 'all'];

/** Deep-ish clone of a raw stats blob into the canonical shape, tolerating
 *  missing/partial data (older records, first-ever write, offline reads). */
export function normalizeStats(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const e4 = r.e4 && typeof r.e4 === 'object' ? r.e4 : {};
  const daily = r.daily && typeof r.daily === 'object' ? r.daily : {};
  const spotsIn = e4.spots && typeof e4.spots === 'object' ? e4.spots : {};
  const spots = {};
  for (const k of TIER_KEYS) spots[k] = num(spotsIn[k]);
  return {
    // The player's display name is carried on the stats blob (written on each
    // update) so the leaderboard can show it without a second lookup — the
    // stats are keyed only by uid otherwise. Derivations ignore it.
    name: typeof r.name === 'string' ? r.name : '',
    e4: {
      draftCount: num(e4.draftCount),
      spots,
      moves: cloneCounts(e4.moves),
      types: cloneCounts(e4.types),
      bstSum: num(e4.bstSum),
      bstCount: num(e4.bstCount),
      bstMax: num(e4.bstMax),
    },
    daily: {
      days: cloneDays(daily.days),
    },
  };
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function cloneCounts(obj) {
  const out = {};
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (k) out[k] = num(v); }
  return out;
}
function cloneDays(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const [d, rec] of Object.entries(obj)) {
      if (!d || !rec || typeof rec !== 'object') continue;
      out[d] = {
        vsCal: clamp01(rec.vsCal),
        vsPlayers: rec.vsPlayers == null ? null : clamp01(rec.vsPlayers),
        rank: rec.rank == null ? null : num(rec.rank),
        total: rec.total == null ? null : num(rec.total),
        isFirst: !!rec.isFirst,
        hasPlayers: !!rec.hasPlayers,
      };
    }
  }
  return out;
}
function clamp01(v) { const n = Number(v); if (!isFinite(n)) return 0; return n < 0 ? 0 : n > 1 ? 1 : n; }

/**
 * Record one E4 gauntlet run (any outcome — claimed or not). Mutates and
 * returns `stats` (already normalized). `moves`/`types` are the drafted mon's,
 * `bst` its base-stat total.
 */
export function applyE4Draft(stats, { moves = [], types = [], bst = 0 } = {}) {
  const e4 = stats.e4;
  e4.draftCount += 1;
  for (const m of moves) { const key = String(m || '').trim(); if (key) e4.moves[key] = (e4.moves[key] || 0) + 1; }
  for (const t of types) { const key = String(t || '').trim(); if (key) e4.types[key] = (e4.types[key] || 0) + 1; }
  const b = num(bst);
  if (b > 0) { e4.bstSum += b; e4.bstCount += 1; if (b > e4.bstMax) e4.bstMax = b; }
  return stats;
}

/** Record that the player actually claimed/held `tierKey` on a run. */
export function applyE4Claim(stats, tierKey) {
  if (TIER_KEYS.includes(tierKey)) stats.e4.spots[tierKey] += 1;
  return stats;
}

/**
 * Idempotently record the player's result for a single daily challenge day.
 * Keyed by dateStr, so calling it again for the same day (a refresh, or a
 * later view once more players have entered) overwrites rather than stacking.
 */
export function recordDailyDay(stats, dateStr, { vsCal, vsPlayers, rank, total, isFirst, hasPlayers } = {}) {
  if (!dateStr) return stats;
  stats.daily.days[dateStr] = {
    vsCal: clamp01(vsCal),
    vsPlayers: vsPlayers == null ? null : clamp01(vsPlayers),
    rank: rank == null ? null : num(rank),
    total: total == null ? null : num(total),
    isFirst: !!isFirst,
    hasPlayers: !!hasPlayers,
  };
  return stats;
}

/** Favorite (most-tallied) key in a {key:count} map. Ties break alphabetically
 *  for determinism. Returns { name, count } or null when empty. */
export function topEntry(counts) {
  let best = null;
  for (const [k, v] of Object.entries(counts || {})) {
    const c = num(v);
    if (c <= 0) continue;
    if (!best || c > best.count || (c === best.count && k < best.name)) best = { name: k, count: c };
  }
  return best;
}

/** Derive the display-ready E4 summary from a normalized stats object. */
export function deriveE4(stats) {
  const e4 = normalizeStats(stats).e4;
  const favMove = topEntry(e4.moves);
  const favType = topEntry(e4.types);
  return {
    draftCount: e4.draftCount,
    spots: { ...e4.spots },
    spotsTotal: TIER_KEYS.reduce((s, k) => s + e4.spots[k], 0),
    favoriteMove: favMove ? favMove.name : null,
    favoriteMoveCount: favMove ? favMove.count : 0,
    favoriteType: favType ? favType.name : null,
    favoriteTypeCount: favType ? favType.count : 0,
    avgBst: e4.bstCount ? e4.bstSum / e4.bstCount : 0,
    maxBst: e4.bstMax,
  };
}

/** Derive the display-ready daily summary from a normalized stats object. */
export function deriveDaily(stats) {
  const days = normalizeStats(stats).daily.days;
  const recs = Object.values(days);
  const plays = recs.length;
  const firstCount = recs.filter((r) => r.isFirst).length;
  const calVals = recs.map((r) => r.vsCal).filter((v) => typeof v === 'number');
  const playerVals = recs.filter((r) => r.hasPlayers && typeof r.vsPlayers === 'number').map((r) => r.vsPlayers);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    plays,
    firstCount,
    avgVsCal: mean(calVals),          // null if never played
    avgVsPlayers: mean(playerVals),   // null if never faced another human
    daysVsPlayers: playerVals.length,
  };
}

/** Flatten one player's stats into a single leaderboard row. Pure. */
export function summarizeForBoard(uid, stats) {
  const s = normalizeStats(stats);
  const e4 = deriveE4(s);
  const daily = deriveDaily(s);
  return {
    uid,
    name: s.name || 'Anonymous',
    e4Drafts: e4.draftCount,
    spotsTotal: e4.spotsTotal,
    avgBst: e4.avgBst,
    maxBst: e4.maxBst,
    favoriteMove: e4.favoriteMove,
    favoriteType: e4.favoriteType,
    dailyPlays: daily.plays,
    dailyFirsts: daily.firstCount,
    avgVsCal: daily.avgVsCal,
    avgVsPlayers: daily.avgVsPlayers,
  };
}

// The metrics a Draft Stats leaderboard can rank by (all higher-is-better).
export const DRAFT_STAT_METRICS = {
  dailyFirsts: { label: 'Daily #1s', get: (r) => r.dailyFirsts },
  dailyPlays:  { label: 'Daily plays', get: (r) => r.dailyPlays },
  e4Drafts:    { label: 'E4 drafts', get: (r) => r.e4Drafts },
  spotsTotal:  { label: 'E4 spots held', get: (r) => r.spotsTotal },
  maxBst:      { label: 'Highest BST', get: (r) => r.maxBst },
};

/**
 * Rank a raw {uid: statsBlob} map into board rows. Pure (no I/O). Rows with a
 * zero value for the chosen metric are dropped (a player who's never done the
 * relevant activity shouldn't pad the board). Ties break by total activity
 * then name, for a stable order.
 */
export function rankDraftStats(rawByUid, { sortBy = 'dailyFirsts', n = 20 } = {}) {
  const metric = DRAFT_STAT_METRICS[sortBy] || DRAFT_STAT_METRICS.dailyFirsts;
  const rows = Object.entries(rawByUid || {})
    .map(([uid, blob]) => summarizeForBoard(uid, blob))
    .map((r) => ({ ...r, _metric: metric.get(r) || 0 }))
    .filter((r) => r._metric > 0);
  rows.sort((a, b) =>
    b._metric - a._metric
    || (b.e4Drafts + b.dailyPlays) - (a.e4Drafts + a.dailyPlays)
    || String(a.name).localeCompare(String(b.name)));
  return rows.slice(0, n);
}
