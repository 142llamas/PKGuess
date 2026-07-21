/**
 * @file tools/test/draft-stats.test.mjs
 * New — unit coverage for the pure per-player Draft Battle stats module
 * (accumulation + idempotent daily records + derivations).
 */
import {
  normalizeStats, applyE4Draft, applyE4Claim, recordDailyDay,
  topEntry, deriveE4, deriveDaily, summarizeForBoard, rankDraftStats,
} from '../../docs/js/lib/draft-stats.js';

export default function (t) {
  t.section('draft-stats.js — normalizeStats tolerates missing/partial/garbage input');
  {
    const empty = normalizeStats(null);
    t.eq(empty.e4.draftCount, 0, 'null input → zeroed e4');
    t.eq(Object.keys(empty.e4.spots).length, 5, 'all five spot keys are present');
    t.eq(empty.e4.spots.all, 0, 'each spot starts at 0');
    t.eq(Object.keys(empty.daily.days).length, 0, 'no daily days');
    const partial = normalizeStats({ e4: { draftCount: 3, spots: { week: 2 }, bstMax: 500 } });
    t.eq(partial.e4.draftCount, 3, 'keeps a provided draftCount');
    t.eq(partial.e4.spots.week, 2, 'keeps a provided spot count');
    t.eq(partial.e4.spots.day, 0, 'fills missing spot keys with 0');
    t.eq(partial.e4.bstMax, 500, 'keeps bstMax');
    const garbage = normalizeStats({ e4: { draftCount: 'xyz', moves: { Tackle: 'NaN', '': 5 } } });
    t.eq(garbage.e4.draftCount, 0, 'non-numeric draftCount coerces to 0');
    t.eq(garbage.e4.moves.Tackle, 0, 'non-numeric move count coerces to 0');
    t.ok(!('' in garbage.e4.moves), 'empty-string move key is dropped');
  }

  t.section('draft-stats.js — applyE4Draft accumulates draft count, move/type tallies, and BST stats');
  {
    let s = normalizeStats(null);
    s = applyE4Draft(s, { moves: ['Surf', 'Ice Beam', 'Surf', 'Recover'], types: ['Water', 'Ice'], bst: 480 });
    s = applyE4Draft(s, { moves: ['Surf', 'Toxic'], types: ['Water'], bst: 520 });
    t.eq(s.e4.draftCount, 2, 'two runs → draftCount 2');
    t.eq(s.e4.moves.Surf, 3, 'Surf tallied across both runs (2 + 1)');
    t.eq(s.e4.moves['Ice Beam'], 1, 'Ice Beam tallied once');
    t.eq(s.e4.types.Water, 2, 'Water type tallied twice');
    t.eq(s.e4.types.Ice, 1, 'Ice type tallied once');
    t.eq(s.e4.bstSum, 1000, 'BST sum accumulates (480 + 520)');
    t.eq(s.e4.bstCount, 2, 'BST count tracks number of contributing drafts');
    t.eq(s.e4.bstMax, 520, 'BST max is the highest single draft');
    // A zero/absent BST is ignored so it can't drag the average toward 0.
    const before = { ...s.e4 };
    s = applyE4Draft(s, { moves: ['Splash'], types: [], bst: 0 });
    t.eq(s.e4.bstCount, before.bstCount, 'a 0 BST does not count toward the average');
    t.eq(s.e4.draftCount, 3, 'but the draft itself still counts');
    t.eq(s.e4.moves.Splash, 1, 'and its moves are still tallied');
  }

  t.section('draft-stats.js — applyE4Claim increments only real tier keys');
  {
    let s = normalizeStats(null);
    s = applyE4Claim(s, 'week');
    s = applyE4Claim(s, 'week');
    s = applyE4Claim(s, 'all');
    s = applyE4Claim(s, 'bogus'); // ignored
    t.eq(s.e4.spots.week, 2, 'week claimed twice');
    t.eq(s.e4.spots.all, 1, 'all claimed once');
    t.eq(s.e4.spots.day, 0, 'unclaimed spot stays 0');
    t.eq(deriveE4(s).spotsTotal, 3, 'a bogus tier key is ignored (total is 3, not 4)');
  }

  t.section('draft-stats.js — recordDailyDay is idempotent per date (no double counting on refresh)');
  {
    let s = normalizeStats(null);
    s = recordDailyDay(s, '2026-07-20', { vsCal: 0.6, vsPlayers: 0.5, rank: 2, total: 4, isFirst: false, hasPlayers: true });
    // Same day again with updated numbers (as more players entered) — overwrites.
    s = recordDailyDay(s, '2026-07-20', { vsCal: 0.6, vsPlayers: 0.55, rank: 3, total: 6, isFirst: false, hasPlayers: true });
    s = recordDailyDay(s, '2026-07-21', { vsCal: 0.8, vsPlayers: 0.9, rank: 1, total: 5, isFirst: true, hasPlayers: true });
    t.eq(Object.keys(s.daily.days).length, 2, 'two distinct days recorded (the repeat did not add a third)');
    t.eq(s.daily.days['2026-07-20'].vsPlayers, 0.55, 'the later write for a day wins (idempotent overwrite)');
    t.eq(s.daily.days['2026-07-20'].total, 6, 'updated total reflects the latest view');
  }

  t.section('draft-stats.js — topEntry picks the mode, breaking ties alphabetically');
  {
    t.eq(topEntry({ Surf: 3, Tackle: 1 }).name, 'Surf', 'highest count wins');
    t.eq(topEntry({ Zap: 2, Amnesia: 2 }).name, 'Amnesia', 'ties break alphabetically (Amnesia < Zap)');
    t.eq(topEntry({}), null, 'empty map → null');
    t.eq(topEntry({ X: 0 }), null, 'a zero-count entry is not "top"');
  }

  t.section('draft-stats.js — deriveE4 produces display-ready summary');
  {
    let s = normalizeStats(null);
    s = applyE4Draft(s, { moves: ['Surf', 'Surf', 'Ice Beam', 'Recover'], types: ['Water', 'Water'], bst: 400 });
    s = applyE4Draft(s, { moves: ['Surf'], types: ['Ice'], bst: 600 });
    s = applyE4Claim(s, 'all');
    const d = deriveE4(s);
    t.eq(d.draftCount, 2, 'draftCount surfaced');
    t.eq(d.favoriteMove, 'Surf', 'favorite move is the mode');
    t.eq(d.favoriteType, 'Water', 'favorite type is the mode');
    t.eq(d.avgBst, 500, 'average BST = (400 + 600) / 2');
    t.eq(d.maxBst, 600, 'highest BST surfaced');
    t.eq(d.spots.all, 1, 'spot counts surfaced');
    t.eq(d.spotsTotal, 1, 'spotsTotal summed');
  }

  t.section('draft-stats.js — deriveDaily averages vs-Cal and vs-players separately, counts plays & #1 finishes');
  {
    let s = normalizeStats(null);
    s = recordDailyDay(s, 'd1', { vsCal: 0.4, vsPlayers: 0.6, isFirst: true, hasPlayers: true });
    s = recordDailyDay(s, 'd2', { vsCal: 0.8, vsPlayers: 0.4, isFirst: false, hasPlayers: true });
    // A solo day (only Cal, no other humans): counts as a play and toward the
    // vs-Cal average, but NOT toward the vs-players average.
    s = recordDailyDay(s, 'd3', { vsCal: 0.6, vsPlayers: null, isFirst: false, hasPlayers: false });
    const d = deriveDaily(s);
    t.eq(d.plays, 3, 'three days played');
    t.eq(d.firstCount, 1, 'one #1 finish');
    t.ok(Math.abs(d.avgVsCal - 0.6) < 1e-9, 'avg vs Cal = (0.4 + 0.8 + 0.6) / 3 = 0.6');
    t.ok(Math.abs(d.avgVsPlayers - 0.5) < 1e-9, 'avg vs players = (0.6 + 0.4) / 2 = 0.5 (solo day excluded)');
    t.eq(d.daysVsPlayers, 2, 'only two days had other human players');
    const empty = deriveDaily(normalizeStats(null));
    t.eq(empty.avgVsCal, null, 'never played → null vs-Cal average (not 0)');
    t.eq(empty.avgVsPlayers, null, 'never faced a human → null vs-players average');
  }

  t.section('draft-stats.js — normalizeStats preserves the display name for the leaderboard');
  {
    t.eq(normalizeStats({ name: 'Ash' }).name, 'Ash', 'a provided name is kept');
    t.eq(normalizeStats(null).name, '', 'missing name defaults to empty string, never undefined');
    t.eq(normalizeStats({ name: 42 }).name, '', 'a non-string name is ignored');
  }

  t.section('draft-stats.js — summarizeForBoard flattens a profile into one row');
  {
    let s = normalizeStats({ name: 'Ash' });
    s = applyE4Draft(s, { moves: ['Surf'], types: ['Water'], bst: 500 });
    s = applyE4Claim(s, 'all');
    s = recordDailyDay(s, 'd1', { vsCal: 0.7, vsPlayers: 0.6, isFirst: true, hasPlayers: true });
    const row = summarizeForBoard('uidAsh', s);
    t.eq(row.uid, 'uidAsh', 'carries the uid');
    t.eq(row.name, 'Ash', 'carries the name');
    t.eq(row.e4Drafts, 1, 'e4 draft count flattened');
    t.eq(row.spotsTotal, 1, 'spots total flattened');
    t.eq(row.maxBst, 500, 'max BST flattened');
    t.eq(row.dailyFirsts, 1, 'daily #1 count flattened');
    t.eq(row.favoriteType, 'Water', 'favorite type flattened');
  }

  t.section('draft-stats.js — rankDraftStats ranks, filters zeroes, and honors the sort metric');
  {
    const mk = (name, fn) => { let s = normalizeStats({ name }); fn(s); return s; };
    const raw = {
      a: mk('Alice', (s) => { recordDailyDay(s, 'd1', { vsCal: 0.5, vsPlayers: 0.5, isFirst: true, hasPlayers: true }); recordDailyDay(s, 'd2', { vsCal: 0.5, vsPlayers: 0.5, isFirst: true, hasPlayers: true }); }),
      b: mk('Bob', (s) => { recordDailyDay(s, 'd1', { vsCal: 0.5, vsPlayers: 0.5, isFirst: true, hasPlayers: true }); applyE4Draft(s, { moves: ['X'], types: ['Fire'], bst: 400 }); applyE4Draft(s, { moves: ['X'], types: ['Fire'], bst: 400 }); applyE4Draft(s, { moves: ['X'], types: ['Fire'], bst: 400 }); }),
      c: mk('Carol', () => { /* no activity at all */ }),
    };
    const byFirsts = rankDraftStats(raw, { sortBy: 'dailyFirsts' });
    t.eq(byFirsts.length, 2, 'a player with zero of the ranked metric is filtered out (Carol has no activity)');
    t.eq(byFirsts[0].name, 'Alice', 'Alice (2 daily #1s) ranks above Bob (1)');
    t.eq(byFirsts[0]._metric, 2, 'the metric value is exposed on the row');
    const byDrafts = rankDraftStats(raw, { sortBy: 'e4Drafts' });
    t.eq(byDrafts[0].name, 'Bob', 'switching the metric to E4 drafts puts Bob (3) on top');
    t.eq(byDrafts.length, 1, 'only Bob has any E4 drafts, so Alice (0) is filtered out under that metric');
  }
}
