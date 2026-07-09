/**
 * @file tools/test/share.test.mjs
 * @version 1.0.0
 * Unit tests for docs/js/lib/share.js. New file — share.js previously had no
 * dedicated unit suite. Covers the #14/#15 share-card infrastructure
 * (buildMonCardPlan, typeColor/typeTextColor, drawMonCardToCanvas against a
 * recording fake context, draftBattleLink, buildSummaryText's new 'gauntlet'
 * kind) plus the pre-existing CT date/period/seed helpers.
 */
import {
  centralDateParts, centralDateStr, centralPeriodKey, seedFromString, seedFromDate,
  buildSummaryText, buildMonCardPlan, typeColor, typeTextColor, drawMonCardToCanvas,
  draftBattleLink, dailyChallengeLink, stablePlayerFallbackName,
} from '../../docs/js/lib/share.js';

export default function (t) {
  t.section('share.js — centralDateStr / centralPeriodKey basics');
  {
    const d = new Date('2026-07-04T12:00:00Z');
    const s = centralDateStr(d);
    t.ok(/^\d{4}-\d{2}-\d{2}$/.test(s), `centralDateStr returns YYYY-MM-DD (got ${s})`);
    t.eq(centralPeriodKey('all'), 'all', "'all' tier period is the constant 'all' (never resets)");
    t.eq(centralPeriodKey('day', d), centralDateStr(d), "'day' period equals the CT date string");
  }

  t.section('share.js — seedFromString / seedFromDate determinism');
  {
    t.eq(seedFromString('x'), seedFromString('x'), 'same string \u2192 same seed');
    t.ok(seedFromString('x') !== seedFromString('y'), 'different strings \u2192 different seeds');
    t.eq(seedFromDate('2026-07-04'), seedFromDate('2026-07-04'), 'same date string \u2192 same daily seed');
  }

  t.section('share.js — buildSummaryText: gauntlet kind (#15)');
  {
    const withPlacement = buildSummaryText({ kind: 'gauntlet', placementLabel: '3rd', monName: "Player's Kangaskhan" });
    t.ok(withPlacement.includes('3rd'), 'includes the placement label');
    t.ok(withPlacement.includes('Kangaskhan'), 'includes the mon\u2019s species name');
    t.ok(!withPlacement.includes("Player's Kangaskhan"), 'the "PlayerName\u2019s " prefix is stripped from the "beat my ___" phrase — "beat my Player\u2019s Kangaskhan" was a grammatical clash of two possessives');
    t.ok(withPlacement.includes('beat my Kangaskhan'), 'reads as "beat my Kangaskhan", not "beat my Player\u2019s Kangaskhan"');
    t.ok(withPlacement.toLowerCase().includes('see if you can beat'), 'uses the specified challenge phrasing');

    const noPossessive = buildSummaryText({ kind: 'gauntlet', placementLabel: 'Champion', monName: 'Kangaskhan' });
    t.ok(noPossessive.includes('beat my Kangaskhan'), 'a monName with no "X\u2019s " prefix at all is left untouched, not mangled');

    const withLink = buildSummaryText({ kind: 'gauntlet', placementLabel: 'Champion', monName: 'X', link: 'https://example.com/#/draftbattle/2' });
    t.ok(withLink.endsWith('https://example.com/#/draftbattle/2'), 'a supplied link is appended as the final line');

    const noPlacement = buildSummaryText({ kind: 'gauntlet', monName: 'X' });
    t.ok(!noPlacement.toLowerCase().includes('undefined'), 'no placement label never renders literal "undefined"');
    const noPlacementPrefixed = buildSummaryText({ kind: 'gauntlet', monName: "Brock's Onix" });
    t.ok(noPlacementPrefixed.includes("Brock's Onix"), 'the OTHER monName usage ("My Elite 4 challenger: X") is NOT stripped — it\u2019s not a possessive clash, so the full name is still shown there');
  }

  t.section('share.js — buildSummaryText: daily kind (#1) — exact spec\u2019d format + leading link');
  {
    const daily = buildSummaryText({ kind: 'daily', dateStr: '2026-07-04', playerName: 'Ash', rank: 2, total: 5, winPct: 0.634, link: 'https://example.com/#/dailychallenge/2' });
    const lines = daily.split('\n');
    t.eq(lines[0], 'https://example.com/#/dailychallenge/2', '#1: the deep link is the FIRST line, not trailing');
    t.eq(lines[1], 'PokeGuess Daily Draft \u2013 2026-07-04', '#1: title line matches the exact spec\u2019d wording and en-dash');
    t.eq(lines[2], 'Ash', '#1: 2nd line is the PLAYER\u2019s name');
    t.eq(lines[3], 'Ranked 2 of 5', '#1: "Ranked x of y" line');
    t.eq(lines[4], '63% Overall Win Rate', '#1: win-rate line uses "Overall Win Rate" wording (rounded %)');
    t.ok(!daily.toLowerCase().includes('my pick'), '#1: no longer shows the mon name / "My pick" line');

    const noLink = buildSummaryText({ kind: 'daily', dateStr: '2026-07-04', playerName: 'Ash' });
    t.eq(noLink.split('\n')[0], 'PokeGuess Daily Draft \u2013 2026-07-04', 'omitting link simply omits that line, title still comes first');

    const noName = buildSummaryText({ kind: 'daily', dateStr: '2026-07-04' });
    t.ok(noName.includes('Player'), '#1: a missing playerName still renders a sane fallback line, never blank/undefined');
  }

  t.section('share.js — stablePlayerFallbackName / dailyChallengeLink (#1)');
  {
    t.eq(stablePlayerFallbackName('uid123'), stablePlayerFallbackName('uid123'), 'same uid \u2192 same fallback name every time (does not change per share)');
    t.ok(/^Player_\d+$/.test(stablePlayerFallbackName('uid123')), 'matches the "Player_[whole number]" format');
    t.ok(stablePlayerFallbackName('uidA') !== stablePlayerFallbackName('uidB'), 'different uids get different fallback names');
    t.eq(typeof dailyChallengeLink(), 'string', 'dailyChallengeLink always returns a string, even without a browser `location`');
  }

  t.section('share.js — buildSummaryText: throne kind unaffected by the #1 daily changes (regression)');
  {
    const throne = buildSummaryText({ kind: 'throne', beatName: 'Koga', monName: 'Gengar', winPct: 0.7 });
    t.ok(throne.includes('Koga') && throne.includes('Gengar') && throne.includes('won'), 'throne kind still renders as before');
    const thronePrefixed = buildSummaryText({ kind: 'throne', beatName: 'Koga', monName: "Misty's Gengar", winPct: 0.7 });
    t.ok(thronePrefixed.includes('with my Gengar') && !thronePrefixed.includes("Misty's Gengar"), 'throne kind gets the same possessive-clash fix as gauntlet ("with my X\u2019s Y" \u2192 "with my Y")');
  }

  t.section('share.js — typeColor / typeTextColor mirror styles.css exactly');
  {
    // Spot-check against the literal values in docs/css/styles.css — if either
    // drifts from the other, the share card will visually mismatch the app.
    t.eq(typeColor('fire'), '#e85020', 'Fire color matches styles.css');
    t.eq(typeColor('water'), '#2878e8', 'Water color matches styles.css');
    t.eq(typeColor('FIRE'), typeColor('fire'), 'case-insensitive');
    t.eq(typeColor('not-a-real-type'), '#666666', 'unknown type falls back to a neutral gray rather than throwing');
    t.eq(typeTextColor('electric'), '#222222', 'Electric uses dark text (matches styles.css color:#222)');
    t.eq(typeTextColor('fire'), '#ffffff', 'Fire uses light text (matches styles.css color:#fff)');
  }

  t.section('share.js — buildMonCardPlan (#14): pure layout data');
  {
    const plan = buildMonCardPlan({ name: "Ash's Kangaskhan", types: ['Normal', 'Psychic', null], baseStats: { hp: 105, atk: 95, def: 100, spa: 100, spd: 50, spe: 55 }, moves: ['High Jump Kick', 'Return', 'Headbutt', 'Earthquake', 'Extra Move Should Be Dropped'] });
    t.eq(plan.title, "Ash's Kangaskhan", 'title is the mon\u2019s full name');
    t.eq(plan.types.length, 2, 'null/falsy types are filtered out');
    t.eq(plan.stats.length, 6, 'all six stats are present, in order');
    t.eq(plan.stats[0].key, 'hp', 'stats are in HP/Atk/Def/SpA/SpD/Spe order');
    t.eq(plan.stats[0].value, 105, 'stat values come from baseStats');
    t.eq(plan.moves.length, 4, 'moves are capped at 4 even if more are supplied');
    t.eq(plan.moves[0], 'High Jump Kick', 'move order is preserved');

    const empty = buildMonCardPlan({});
    t.eq(empty.title, 'Mystery Pok\u00e9mon', 'a missing name falls back to a sane default rather than "undefined"');
    t.eq(empty.stats.length, 6, 'missing baseStats still produces all six stat rows (as 0)');
    t.eq(empty.stats[0].value, 0, 'a missing stat value defaults to 0, not NaN');
  }

  t.section('share.js — drawMonCardToCanvas (#14): draws against an injected context');
  {
    // jsdom has no real canvas 2D implementation, and this project avoids
    // adding a canvas-polyfill dependency just for pixel tests \u2014 so verify
    // the RIGHT draw calls happen via a lightweight recording fake context
    // that mirrors the small subset of the CanvasRenderingContext2D surface
    // drawMonCardToCanvas actually uses.
    const calls = { fillText: [], fillRect: 0, strokeRect: 0 };
    const fakeCtx = {
      set fillStyle(v) {}, get fillStyle() { return ''; },
      set strokeStyle(v) {}, get strokeStyle() { return ''; },
      set lineWidth(v) {}, get lineWidth() { return 0; },
      set font(v) {}, get font() { return ''; },
      set textAlign(v) {}, get textAlign() { return ''; },
      fillRect() { calls.fillRect++; },
      strokeRect() { calls.strokeRect++; },
      fillText(text) { calls.fillText.push(text); },
    };
    const plan = buildMonCardPlan({ name: 'Test Mon', types: ['Fire', 'Flying'], baseStats: { hp: 80, atk: 70, def: 60, spa: 90, spd: 85, spe: 100 }, moves: ['Flamethrower', 'Fly'] });
    drawMonCardToCanvas(fakeCtx, plan);
    t.ok(calls.fillText.includes('Test Mon'), 'draws the mon\u2019s title');
    t.ok(calls.fillText.some((s) => s === 'FIRE'), 'draws an uppercased type label for Fire');
    t.ok(calls.fillText.some((s) => s === 'FLYING'), 'draws an uppercased type label for Flying');
    t.ok(calls.fillText.includes('Flamethrower') && calls.fillText.includes('Fly'), 'draws every move');
    t.ok(calls.fillText.some((s) => s === '80'), 'draws the HP stat value');
    t.ok(calls.fillRect > 10, 'draws a substantial number of filled rects (background + pills + stat bars + move chips)');
    t.ok(calls.strokeRect >= 1, 'draws the card border');

    // Never throws on a completely empty plan (defensive — e.g. a card with no moves yet).
    let threw = false;
    try { drawMonCardToCanvas(fakeCtx, buildMonCardPlan({})); } catch { threw = true; }
    t.ok(!threw, 'drawing an empty/default plan does not throw');
  }

  t.section('share.js — draftBattleLink (#14/#15): deep link back into Draft Battle');
  {
    // No `location` in this Node test environment \u2014 must degrade gracefully.
    const link = draftBattleLink();
    t.eq(typeof link, 'string', 'always returns a string, even without a browser `location`');
    const linkWithView = draftBattleLink('thrones');
    t.eq(typeof linkWithView, 'string', 'accepts an optional view segment without throwing');
  }
}
