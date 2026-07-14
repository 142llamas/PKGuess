/**
 * @file tools/test/leaderboard-data.test.mjs
 * @version 1.0.0
 * New file — leaderboard-data.js previously had no dedicated unit suite.
 * Covers rankEntries' new sort-by-metric behavior (requested: Safari ranks by
 * catch-per-100-points, Victory Road offers a time-per-catch sort toggle),
 * added in leaderboard-data.js 1.1.0. submitScore/topEntries themselves need a
 * live/fake Firebase and aren't covered here — rankEntries is the pure,
 * directly-testable piece the sort logic actually lives in.
 */
import { rankEntries } from '../../docs/js/lib/leaderboard-data.js';

export default function (t) {
  t.section('leaderboard-data.js — rankEntries: default score sort (unchanged behavior)');
  {
    const raw = {
      k1: { uid: 'u1', name: 'A', score: 10, at: 100 },
      k2: { uid: 'u2', name: 'B', score: 30, at: 200 },
      k3: { uid: 'u3', name: 'C', score: 20, at: 50 },
    };
    const ranked = rankEntries(raw, 10);
    t.eq(ranked.map((e) => e.name).join(','), 'B,C,A', 'default sort is by score descending (30, 20, 10)');
    t.eq(ranked[0]._key, 'k2', 'the _key from the object is preserved on each entry');

    // tie-break by earliest `at` (first to reach that score wins the tie)
    const tied = {
      k1: { uid: 'u1', name: 'Later', score: 10, at: 200 },
      k2: { uid: 'u2', name: 'Earlier', score: 10, at: 100 },
    };
    const rankedTied = rankEntries(tied, 10);
    t.eq(rankedTied[0].name, 'Earlier', 'a score tie is broken by earliest `at` (unchanged tie-break behavior)');
  }

  t.section('leaderboard-data.js — rankEntries: sortBy "metric", higher-is-better (Safari\u2019s catch/100pts)');
  {
    const raw = {
      k1: { uid: 'u1', name: 'LowMetricHighScore', score: 50, metric: 10, at: 1 },
      k2: { uid: 'u2', name: 'HighMetricLowScore', score: 5,  metric: 90, at: 2 },
      k3: { uid: 'u3', name: 'MidMetric',          score: 20, metric: 40, at: 3 },
    };
    const ranked = rankEntries(raw, 10, { sortBy: 'metric' });
    t.eq(ranked.map((e) => e.name).join(','), 'HighMetricLowScore,MidMetric,LowMetricHighScore', 'sortBy:"metric" ranks by the metric value, NOT the score (a low-score/high-metric entry ranks first)');
  }

  t.section('leaderboard-data.js — rankEntries: sortBy "metric", metricAsc (Victory Road\u2019s time/catch \u2014 lower is better)');
  {
    const raw = {
      k1: { uid: 'u1', name: 'Slow', score: 30, metric: 5000, at: 1 },
      k2: { uid: 'u2', name: 'Fast', score: 10, metric: 1200, at: 2 },
      k3: { uid: 'u3', name: 'Mid',  score: 20, metric: 3000, at: 3 },
    };
    const ranked = rankEntries(raw, 10, { sortBy: 'metric', metricAsc: true });
    t.eq(ranked.map((e) => e.name).join(','), 'Fast,Mid,Slow', 'metricAsc:true ranks the LOWEST metric first (fastest average time wins)');

    // Without metricAsc (defaults to false / higher-is-better), the same data
    // should rank in the opposite order.
    const rankedDesc = rankEntries(raw, 10, { sortBy: 'metric' });
    t.eq(rankedDesc.map((e) => e.name).join(','), 'Slow,Mid,Fast', 'omitting metricAsc defaults to higher-is-better (the opposite order)');
  }

  t.section('leaderboard-data.js — rankEntries: entries without a metric sink to the bottom under a metric sort');
  {
    const raw = {
      k1: { uid: 'u1', name: 'NoMetric', score: 100, at: 1 },              // no metric field at all
      k2: { uid: 'u2', name: 'HasMetric', score: 5, metric: 50, at: 2 },
    };
    const ranked = rankEntries(raw, 10, { sortBy: 'metric' });
    t.eq(ranked[0].name, 'HasMetric', 'an entry WITH a metric ranks above one without, even with a much lower score');
    t.eq(ranked[1].name, 'NoMetric', 'the metric-less entry sinks to the bottom rather than crashing or sorting arbitrarily');

    // all metric-less: falls back to score order among themselves
    const allNoMetric = {
      k1: { uid: 'u1', name: 'Low', score: 5, at: 1 },
      k2: { uid: 'u2', name: 'High', score: 50, at: 2 },
    };
    const rankedAllNo = rankEntries(allNoMetric, 10, { sortBy: 'metric' });
    t.eq(rankedAllNo[0].name, 'High', 'when NO entries have a metric, a metric sort falls back to score order rather than leaving order undefined');
  }

  t.section('leaderboard-data.js — rankEntries: respects the `n` limit and filters out malformed entries');
  {
    const raw = {
      k1: { uid: 'u1', name: 'A', score: 10, at: 1 },
      k2: { uid: 'u2', name: 'B', score: 20, at: 2 },
      k3: { uid: 'u3', name: 'C', score: 30, at: 3 },
      k4: { uid: 'u4', name: 'NoScore', at: 4 },          // missing score entirely
      k5: { uid: 'u5', name: 'BadScore', score: 'oops', at: 5 }, // non-numeric score
    };
    const ranked = rankEntries(raw, 2);
    t.eq(ranked.length, 2, 'the `n` limit is respected');
    t.ok(!ranked.some((e) => e.name === 'NoScore' || e.name === 'BadScore'), 'entries with a missing or non-numeric score are filtered out entirely, not crashing the sort');
  }
}
