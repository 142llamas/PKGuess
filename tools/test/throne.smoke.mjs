// Draft Battle throne/gauntlet + daily smoke: exercises the REAL controller
// (docs/js/modes/draftbattle.js) end-to-end against a real (non-"offline")
// fake Firebase, via the params._getFirebase/_getIdentity test-injection seam
// (same pattern as race.smoke.mjs / online.smoke.mjs).
//
// Covers:
//   #14/#15 — the Elite-4 gauntlet: one "Challenge the Elite 4" button battles
//   Will→Koga→Bruno→Lance→All-Time in order, stopping at the first loss, with
//   ONE results screen (a row per matchup + placement message), ONE claim (of
//   the highest spot reached), and ONE share.
//   #12/#13 — the persisted "personal best" progress rank must survive the
//   #14a one-throne cascade AND a simulated cadence reset (a throne reverting
//   to NPC on its own no longer erases what the player already proved).
//   claimThrone()'s write-verification hardening is also covered.
//   #10 — re-opening daily results from the "already played today" gate must
//   show TODAY, never treat the click event as a date override.
//
// Run: node tools/test/throne.smoke.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const P = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://e.com/' });
const { window } = dom;
global.window = window; global.document = window.document;
for (const k of ['navigator', 'Node', 'HTMLElement', 'MouseEvent', 'location']) {
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch {}
}

const files = {
  'data/movelist-gen2.json': P('../../docs/data/movelist-gen2.json'),
  'data/movestats-gen2.json': P('../../docs/data/movestats-gen2.json'),
  'data/draftpool-gen2.json': P('../../docs/data/draftpool-gen2.json'),
  'data/typechart-gen2.json': P('../../docs/data/typechart-gen2.json'),
};
global.fetch = async (u) => { const p = files[u]; if (!p) return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => JSON.parse(readFileSync(p, 'utf8')) }; };
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

// ---- fake Firebase: mirrors real RTDB semantics that actually matter here --
function makeFakeFB({ throneWriteSilentlyFails = false } = {}) {
  const tree = {};
  const assertNoUndefined = (v, path) => {
    if (v === undefined) throw new Error(`undefined at ${path}`);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) assertNoUndefined(v[k], `${path}/${k}`);
  };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  function snap(path) { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return clone(n); }
  function setDeep(path, val) {
    const ks = parts(path);
    if (val === null) {
      let n = tree; for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) return; n = n[ks[i]]; }
      delete n[ks[ks.length - 1]];
      return;
    }
    let n = tree; for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) n[ks[i]] = {}; n = n[ks[i]]; }
    n[ks[ks.length - 1]] = clone(val);
  }
  let pushCounter = 0;
  return {
    async set(p, v) {
      if (v !== null) assertNoUndefined(v, p);
      if (throneWriteSilentlyFails && /^\/draft\/throne\/\w+$/.test(p)) return true; // reports success, never lands
      setDeep(p, v);
      return true;
    },
    async update(p, o) { assertNoUndefined(o, p); const cur = snap(p) || {}; setDeep(p, { ...cur, ...o }); return true; },
    async get(p) { return snap(p); },
    async push(p, v) { assertNoUndefined(v, p); const key = 'k' + (++pushCounter); setDeep(`${p}/${key}`, v); return { key }; },
    onValue(p, cb) { cb(snap(p)); return () => {}; },
    onDisconnectSet() {},
    auth: {},
    _dump: () => tree,
    _forceSet: (p, v) => setDeep(p, v), // test-only backdoor, bypasses the app entirely
  };
}

const { createDraftBattle } = await import('../../docs/js/modes/draftbattle.js');
const { centralPeriodKey } = await import('../../docs/js/lib/share.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelectorAll(s);
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const btn = (text) => [...q('button')].find((b) => b.textContent.trim().includes(text));

// Math.random must stay patched until AFTER draftbattle.js's own async
// Promise.all(...).then() chain actually calls startDraft() — restoring it
// right after createDraftBattle() returns is too early (still pending on a
// microtask). Learned the hard way while first building this harness.
const REAL_RANDOM = Math.random;
async function withDraftSeed(seedInt, fn) {
  Math.random = () => (seedInt + 0.5) / (2 ** 31);
  try { return await fn(); } finally { Math.random = REAL_RANDOM; }
}

// Self-healing seed discovery (replaces the old hardcoded WINNING_SEED). The
// Elite-4 NPCs are period-keyed by date and the greedy draft depends on the
// move roster, so a seed that sweeps today won't necessarily sweep tomorrow or
// after a move/draft-pool change — historically this needed manual re-finding
// (seed 7 → 12 → 3). Rather than hardcode a value that rots, we run the exact
// same greedy-draft-through-UI + gauntlet the test itself uses, scanning seeds
// until we find one that sweeps all five tiers (WINNING_SEED) and a DIFFERENT
// one that wins Will but loses Koga (WIN_THEN_LOSE_SEED). Discovery is fully
// deterministic for a given date (battle sims are string-seeded, the greedy
// draft is Math.random-seeded per candidate), so this finds the same seeds on
// every run. If NO seed sweeps, discovery throws loudly — that's a genuine
// balance regression signal, not a stale-seed nuisance.
let WINNING_SEED;         // assigned by discoverSeeds() below, before any test block
let WIN_THEN_LOSE_SEED;   // ditto

async function greedyDraftThroughUI() {
  let steps = 0;
  while (steps++ < 60) {
    let pend = q('.draft-stat-chip.pending,.draft-type-chip.pending,.draft-move-chip.pending').length, g = 0;
    while (pend < 2 && g++ < 12) {
      const a = [...q('.draft-stat-chip.available,.draft-type-chip.available,.draft-move-chip.available')];
      if (!a.length) break;
      click(a[0]);
      pend = q('.draft-stat-chip.pending,.draft-type-chip.pending,.draft-move-chip.pending').length;
    }
    const c = [...q('.draft-advance-btns button')].find((b) => !b.disabled);
    if (c) click(c);
    if (document.body.textContent.includes('Draft Complete')) break;
    await wait(0);
  }
}

async function draftFreshWithSeed(seed, fb, identity) {
  const ctrl = await withDraftSeed(seed, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(50);
    return c;
  });
  await greedyDraftThroughUI();
  return ctrl;
}

async function draftFresh(fb, identity) {
  return draftFreshWithSeed(WINNING_SEED, fb, identity);
}

/** Runs the gauntlet from the Draft Complete screen and returns the parsed
 *  results-table rows. Claiming the highest spot reached is now automatic —
 *  it happens before the results screen ever renders, so by the time this
 *  resolves (results table visible) the throne write has already completed;
 *  no button click is needed or offered any more. */
async function runGauntletFromDraftComplete() {
  click(btn('Challenge the Elite 4'));
  // Poll rather than a fixed wait: the gauntlet runs up to 5 sequential
  // N=501 battle simulations, which can occasionally take longer than a
  // short fixed delay under system load -- this was causing intermittent,
  // environment-dependent failures unrelated to any actual product bug.
  let guard = 0;
  while (!document.querySelector('.lb-table tbody tr') && !document.querySelector('.summary-card') && guard++ < 50) await wait(50);
  await wait(50); // settle
  const rows = [...q('.lb-table tbody tr')].map((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    return { tier: cells[0]?.textContent.trim(), opponent: cells[1]?.textContent.trim(), result: cells[2]?.textContent.trim() };
  });
  const summary = document.querySelector('.summary-score')?.textContent || '';
  return { rows, summary };
}

function statusBadge() {
  return [...q('.summary-card p, .summary-card div')].find((n) => n.textContent.includes('Your best'))?.textContent || null;
}

// Draft `seed` for `identity`, run the full gauntlet, claim, and read back the
// exact mon object the app persisted (name + baseStats + types + moves). Used
// to build the "same-mon cascade" pre-seed dynamically instead of hardcoding a
// mon that has to be re-captured every time WINNING_SEED changes.
async function captureMon(seed, identity) {
  document.getElementById('app').innerHTML = '';
  const fb = makeFakeFB();
  const ctrl = await draftFreshWithSeed(seed, fb, identity);
  await runGauntletFromDraftComplete(); // claim already happened automatically by the time this resolves
  await wait(30);
  const all = await fb.get('/draft/throne/all');
  ctrl.destroy();
  document.getElementById('app').innerHTML = '';
  return all && all.mon ? all.mon : null;
}

// Scan seeds for (a) one that sweeps all five tiers and (b) a DIFFERENT one
// that wins Will / loses Koga. Deterministic per date; see the big note above.
async function discoverSeeds({ maxSeed = 80 } = {}) {
  // The gauntlet battle seed bakes in the challenger mon's display name, which
  // is "<playerName>'s <species>" (draft.js line ~358). So a seed's win/lose
  // verdict is only reproducible under the SAME player name it was discovered
  // with. The scenarios that consume WINNING_SEED / WIN_THEN_LOSE_SEED all run
  // as "Ash", so discovery must scan as "Ash" too — scanning under a different
  // name (previously "Scan") produced a different battle seed, so a seed found
  // to lose-to-Koga during discovery could actually win under "Ash", flaking
  // the "matches the exact bug report shape" scenario on dates where seed 4's
  // Koga matchup happens to differ between the two names.
  const SCAN_ID = { uid: 'seedscan', name: 'Ash' };
  let sweepSeed = null, sweepMon = null, wl = null;
  for (let s = 1; s <= maxSeed; s++) {
    document.getElementById('app').innerHTML = '';
    const fb = makeFakeFB();
    const ctrl = await draftFreshWithSeed(s, fb, SCAN_ID);
    const monName = document.querySelector('.summary-mon')?.textContent || '';
    const { rows } = await runGauntletFromDraftComplete();
    ctrl.destroy();
    const won = rows.map((r) => r.result.includes('Won'));
    const isSweep = rows.length === 5 && won.every(Boolean);
    const isWinLose = rows.length >= 2 && rows[0].opponent === 'Will' && won[0]
      && rows[1].opponent === 'Koga' && rows[1].result.includes('Lost');
    if (isSweep && sweepSeed === null) { sweepSeed = s; sweepMon = monName; }
    if (isWinLose && wl === null) wl = { seed: s, mon: monName };
    if (sweepSeed !== null && wl !== null) {
      if (wl.mon !== sweepMon) break;   // both found, and they're genuinely different mons
      wl = null;                        // collision: keep scanning for a different-species win/lose seed
    }
  }
  document.getElementById('app').innerHTML = '';
  if (sweepSeed === null) throw new Error(`discoverSeeds: no seed in 1..${maxSeed} sweeps all five Elite-4 tiers for today (${new Date().toDateString()}). A clean sweep being impossible is a real balance regression, not a test bug — investigate the move roster / stat bands.`);
  if (wl === null) throw new Error(`discoverSeeds: found sweep seed ${sweepSeed} but no DISTINCT win-Will/lose-Koga seed in 1..${maxSeed}.`);
  return { winningSeed: sweepSeed, winThenLoseSeed: wl.seed };
}

({ winningSeed: WINNING_SEED, winThenLoseSeed: WIN_THEN_LOSE_SEED } = await discoverSeeds());
console.log(`\n[seed discovery] WINNING_SEED=${WINNING_SEED} (sweeps all 5), WIN_THEN_LOSE_SEED=${WIN_THEN_LOSE_SEED} (Will W / Koga L) for ${new Date().toDateString()}`);

// ============================================================================
console.log('\n— #14/#15: the Elite-4 gauntlet runs Will→Koga→Bruno→Lance→All-Time in one action —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player1', name: 'Ash' };
  const ctrl = await draftFresh(fb, identity);
  ok(document.body.textContent.includes('Draft Complete'), 'draft completes with a deterministic winning build');
  ok(document.body.textContent.includes('Ash\'s'), '#1 (bug): the drafted mon\u2019s name uses the player\u2019s actual screen name ("Ash\'s ...") — previously always said "Player\'s ..." regardless of who was playing, since startDraft() never passed playerName through at all');
  ok(!document.body.textContent.includes('Player\'s '), '#1: the literal fallback string "Player\'s" does not appear now that a real identity name is available');
  ok(!!btn('Challenge the Elite 4'), 'Draft Complete screen offers a single "Challenge the Elite 4" button');
  const shareMonBtn = btn('Share My Pokémon');
  ok(!!shareMonBtn, '#14: Draft Complete screen offers a "Share My Pokémon" button');
  // Text-only now (see draftbattle.js's changelog) — no canvas involved at
  // all anymore, so there's no graceful-degrade path left to exercise; this
  // just confirms the share sheet actually appears with useful content.
  let threwOnShare = false;
  try { click(shareMonBtn); await wait(30); } catch { threwOnShare = true; }
  ok(!threwOnShare, '#14: clicking "Share My Pokémon" does not throw');
  const shareToastText = document.querySelector('.draft-toast')?.textContent || '';
  ok(shareToastText.length > 0, 'a share sheet with real content appears (not blank, not an error)');
  ok(shareToastText.includes('drafted Pokémon'), 'the share text mentions the drafted mon');
  ok([...document.querySelectorAll('.draft-toast button')].some((b) => b.textContent.includes('WhatsApp')), 'the same WhatsApp/Copy/Close share sheet used everywhere else in the app is shown (not a native OS share sheet or a silent file download)');
  const closeBtn = [...document.querySelectorAll('.draft-toast button')].find((b) => b.textContent.includes('Close'));
  if (closeBtn) click(closeBtn);

  const { rows, summary } = await runGauntletFromDraftComplete();
  eq(rows.length, 5, 'the gauntlet attempts all five tiers when the challenger wins every matchup');
  ok(rows.every((r) => r.result.includes('Won')), 'every matchup is won with this deterministic build');
  ok(summary.includes('Champion'), 'the placement message names the top spot (Champion) after clearing All-Time');
  ok(summary.includes('claimed'), 'the summary itself reports the spot as already claimed \u2014 no separate Claim button is needed');
  ok(!btn('Claim'), 'the old separate "Claim the Xth spot" button is gone \u2014 claiming is automatic now');
  ok(!!btn('📤 Share'), '#15: a single consolidated Share button is offered on the results screen (not one per victory)');
  ok(!!btn('My Build') && !!btn('Elite 4 Status') && !!btn('Draft Again') && !!btn('Main Menu'),
    'the Gauntlet Results screen offers all four actions: My Build, Elite 4 Status, Draft Again, Main Menu');
  let threwOnGauntletShare = false;
  try { click(btn('📤 Share')); await wait(30); } catch { threwOnGauntletShare = true; }
  ok(!threwOnGauntletShare, '#15: clicking the gauntlet results Share button does not throw');
  const gauntletToastText = document.querySelector('.draft-toast')?.textContent || '';
  ok(gauntletToastText.includes('Champion') || gauntletToastText.includes('Elite 4'), 'the gauntlet share text mentions the achievement, not just a bare link');

  // #15 — watch an individual matchup on demand, then return to the SAME results screen.
  const watchBtn = [...q('table button')].find((b) => b.textContent.includes('Watch'));
  ok(!!watchBtn, 'each row offers an on-demand "Watch" replay button');
  click(watchBtn);
  await wait(20);
  ok(!!document.querySelector('.battle-log'), 'watching a row opens the battle-log playback UI');
  click(btn('Skip')); // jump to the end of playback — the "Back to Results" action only appears once atEnd
  await wait(20);
  click(btn('Back to Results'));
  await wait(20);
  ok(document.body.textContent.includes('Gauntlet Results'), 'returns to the SAME results screen after watching a battle');
  ok(document.querySelector('.summary-score')?.textContent.includes('claimed'), 'returning from a Watch replay still shows the already-claimed result (does not re-claim or lose it)');

  const dump = await fb.get('/draft/throne/all');
  ok(!!dump && dump.holderUid === 'player1', 'the automatic claim actually persisted the highest throne reached (All-Time), with no button click required');
  eq(await fb.get('/draft/progress/player1'), 5, 'persisted progress rank reaches the max (5) after the full climb');

  console.log('\n— Bug report: a player who already holds a HIGHER throne with a DIFFERENT mon must still be able to claim a lower one with a NEW mon —');
  {
    // player1 (from just above) already holds All-Time with their swept mon.
    // Draft a genuinely different, new mon (a different seed) that reaches
    // only Will and try to claim it. This should succeed outright — "a
    // single POKEMON can only hold one spot, but a player can hold as many
    // as they want" is the intended rule; the previous behavior compared
    // holderUid, which incorrectly treated "same player, different mon" the
    // same as "same mon, lower tier" and blocked the claim.
    // WIN_THEN_LOSE_SEED was discovered above for TODAY specifically (see the
    // discoverSeeds note near the top): it wins Will and loses Koga, and drafts
    // a genuinely different species than WINNING_SEED — which is exactly what
    // this section needs (a new, different mon that clears only the lowest
    // spot). Discovery guarantees the "different mon" property, so this no
    // longer depends on a hand-found seed for the current date.
    document.getElementById('app').innerHTML = '';
    const ctrl2 = await withDraftSeed(WIN_THEN_LOSE_SEED, async () => {
      const c = createDraftBattle({
        mount: document.getElementById('app'), config: {}, data: gen2,
        params: { variant: 'freeplay', _getFirebase: async () => fb, _getIdentity: async () => identity },
        onExit: () => {},
      });
      await wait(50);
      return c;
    });
    await greedyDraftThroughUI();
    const newMonName = document.querySelector('.summary-mon')?.textContent;
    ok(!!newMonName && newMonName !== dump.mon.name, `drafted a genuinely different mon this time (got: ${newMonName}, previous: ${dump.mon.name})`);
    const { rows: rows2, summary: summary2 } = await runGauntletFromDraftComplete();
    ok(rows2.some((r) => r.opponent === 'Will' && r.result.includes('Won')), 'this build beats Will');
    ok(rows2.some((r) => r.opponent === 'Koga' && r.result.includes('Lost')), 'and loses to Koga, matching the exact bug report shape (won the lowest spot, lost the next one)');
    ok(summary2.includes('claimed'), 'the highest spot actually reached (Will) is auto-claimed, with no button click');
    ok(!document.body.textContent.includes('already own') && !document.body.textContent.includes('keptHigherTier'), 'claiming does NOT get blocked with an "already own the highest spot" style message');
    const dayDump = await fb.get('/draft/throne/day');
    ok(!!dayDump && dayDump.holderUid === 'player1' && dayDump.mon.name === newMonName, 'Will\u2019s spot is genuinely claimed by the NEW mon');
    const allDumpAfter = await fb.get('/draft/throne/all');
    ok(!!allDumpAfter && allDumpAfter.mon.name === dump.mon.name, 'the player\u2019s All-Time spot (held by the ORIGINAL mon) is completely untouched \u2014 the player now legitimately holds BOTH spots at once, each with its own mon');
    ctrl2.destroy();
  }
  ctrl.destroy();
}

console.log('\n— The one-Pok\u00e9mon-one-throne cascade still applies when it\u2019s genuinely the SAME mon —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player10', name: 'Falkner' };
  // WINNING_SEED's draft is fully deterministic regardless of player name --
  // only the "X's " name prefix changes. Capture the EXACT mon this seed+
  // identity produces (via a throwaway draft+claim), then pre-seed Will with
  // it, as if this same mon had separately claimed Will at some earlier point
  // -- this avoids the unrelated "re-fighting your own prior claim" edge case
  // that coming at this via two live gauntlet runs would have triggered
  // instead. Capturing (rather than hardcoding the mon) means this keeps
  // working automatically whenever discoverSeeds() picks a new WINNING_SEED.
  const falknerMon = await captureMon(WINNING_SEED, identity);
  ok(!!falknerMon && !!falknerMon.name && !!falknerMon.baseStats, 'captured the deterministic winning mon for pre-seeding');
  // Pre-seed Will as if this same mon CURRENTLY holds it — the period must be
  // the current 'day' key, otherwise the record has rolled over and the game
  // (correctly) treats it as an NPC, not a live hold (see draftbattle.js
  // 1.17.1: claimThrone now period-resolves the throne map, so a stale-period
  // record no longer counts as the mon still holding that spot).
  await fb._forceSet('/draft/throne/day', {
    mon: falknerMon,
    holderUid: 'player10', holderName: 'Falkner', takenAt: Date.now(), period: centralPeriodKey('day'),
  });

  const ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(50);
    return c;
  });
  await greedyDraftThroughUI();
  const monName = document.querySelector('.summary-mon')?.textContent;
  eq(monName, falknerMon.name, 'sanity check: this seed+identity combination produces the exact mon the throne was pre-seeded with');
  const { summary: falknerSummary } = await runGauntletFromDraftComplete();
  ok(falknerSummary.includes('claimed'), 'Falkner\u2019s highest spot reached is auto-claimed, no button click needed');
  const allDump = await fb.get('/draft/throne/all');
  ok(!!allDump && allDump.holderUid === 'player10', 'All-Time is claimed by this mon');
  const dayDumpAfter = await fb.get('/draft/throne/day');
  ok(dayDumpAfter === null || dayDumpAfter.holderUid !== 'player10', 'Will is vacated (cleared, or bumped to a different holder) now that the SAME mon holding it has moved up to All-Time \u2014 one mon genuinely can\u2019t hold two spots at once');
  ctrl.destroy();
}

console.log('\n— #12/#13: the "personal best" badge survives the #14a cascade vacating every lower throne —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player1', name: 'Ash' };
  // Reuse the state left over from the previous section's full climb: progress
  // is 5, but every tier below All-Time has been vacated back to NPC by the
  // one-throne cascade (#14a) — exactly the scenario that broke the OLD
  // "conquered(previous throne's CURRENT holder)" unlock check.
  await fb._forceSet('/draft/progress/player1', 5);
  await fb._forceSet('/draft/throne/all', { mon: { name: 'X', types: ['Normal'], baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, moves: [] }, holderUid: 'player1', holderName: 'Ash', takenAt: Date.now(), period: 'all' });

  const ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', view: 'thrones', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(80);
    return c;
  });
  const badge = statusBadge();
  ok(!!badge && badge.includes('All Time'), `#12/#13: personal-best badge correctly shows All-Time despite every lower throne being vacated (got: ${badge})`);
  ctrl.destroy();
}

console.log('\n— #12/#13: the badge ALSO survives a cadence reset (throne data absent entirely) —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player2', name: 'Misty' };
  // Simulate a cadence rollover: progress was earned, but NO throne node backs
  // it up at all (as if every tier's own reset already fired).
  await fb._forceSet('/draft/progress/player2', 3);

  const ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', view: 'thrones', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(80);
    return c;
  });
  const badge = statusBadge();
  ok(!!badge && badge.includes('Bruno'), `#12/#13 (cadence-reset variant): badge shows Bruno (rank 3) purely from persisted progress, with zero throne data (got: ${badge})`);
  ctrl.destroy();
}

console.log('\n— #12: claimThrone verifies the write and reports failure instead of a false success —');
{
  const fb = makeFakeFB({ throneWriteSilentlyFails: true });
  const identity = { uid: 'player3', name: 'Brock' };
  const ctrl = await draftFresh(fb, identity);
  const { summary } = await runGauntletFromDraftComplete();
  ok(summary.includes('Could not verify') || document.body.textContent.includes('Could not verify'),
    '#12: a throne write that silently fails to persist surfaces a clear error in the auto-claim summary, not a false "you took the spot" message, and with no button click required to discover it');
  ctrl.destroy();
}

// ============================================================================
console.log('\n— #10: re-opening daily results from the "already played today" gate shows TODAY, not yesterday —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player4', name: 'Dawn' };

  let ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'daily', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(50);
    return c;
  });
  await greedyDraftThroughUI();
  const submitBtn = [...q('button')].find((b) => b.textContent.includes('Submit'));
  ok(!!submitBtn, 'daily draft reaches a Submit button');
  click(submitBtn);
  await wait(80);
  ok(document.body.textContent.includes('Daily Results'), 'first playthrough lands on today\u2019s Daily Results');
  ok(document.body.textContent.includes('Dawn\'s'), '#1 (bug): the daily entry\u2019s Build column also uses the player\u2019s real screen name ("Dawn\'s ..."), not "Player\'s ..." \u2014 same underlying fix, verified for the daily flow specifically since it has its own entry point (startDaily) separate from free-play\u2019s (startDraft)');
  const todayLine = document.querySelector('.battle-vs')?.textContent;
  ctrl.destroy();

  document.getElementById('app').innerHTML = '';
  ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'daily', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(60);
    return c;
  });
  ok(document.body.textContent.includes('Already done today'), 'second visit today shows the "already done" gate (#6a)');
  const viewResultsBtn = [...q('button')].find((b) => b.textContent.includes('View Results'));
  ok(!!viewResultsBtn, 'gate has a View Results button');
  click(viewResultsBtn);
  await wait(80);
  const titleText = document.querySelector('.summary-result')?.textContent || '';
  eq(titleText, '🎮 Daily Results', '#10: "View Results" from the gate shows TODAY\u2019s "Daily Results" title, not "Yesterday\u2019s Results"');
  const dateLineNow = document.querySelector('.battle-vs')?.textContent;
  eq(dateLineNow, todayLine, '#10: the date line matches today\u2019s date, unchanged from the first playthrough');
  ctrl.destroy();
}

console.log('\n— Requested: throne History screen has an Inspect button for each historical champion —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player20', name: 'Erika' };
  const ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(50);
    return c;
  });
  await greedyDraftThroughUI();
  const monName = document.querySelector('.summary-mon')?.textContent;
  await runGauntletFromDraftComplete(); // claim already happened automatically

  // Navigate to the Elite 4 status screen, then that tier's History.
  click([...q('button')].find((b) => b.textContent.includes('Elite 4 Status')));
  await wait(50);
  const allTimeCard = [...q('.throne-card')].find((c) => c.textContent.includes('All Time'));
  ok(!!allTimeCard, 'the All-Time throne card is present');
  click([...allTimeCard.querySelectorAll('button')].find((b) => b.textContent.includes('History')));
  await wait(50);
  ok(document.body.textContent.includes('Champions'), 'landed on the champion History screen');

  const historyRows = [...q('.lb-table tbody tr')];
  ok(historyRows.length >= 1, 'at least one history row exists (the claim just made)');
  const inspectBtn = [...historyRows[0].querySelectorAll('button')].find((b) => b.textContent.includes('\uD83D\uDD0D'));
  ok(!!inspectBtn, 'the history row has an Inspect button, matching the Daily Draft\u2019s pattern');
  click(inspectBtn);
  await wait(30);
  ok(document.body.textContent.includes(monName), 'inspecting shows the correct historical mon\u2019s name');
  ok(!!q('.stat-spread-grid').length, 'inspecting shows the stat spread');
  ok(!btn('Challenge the Elite 4') && !btn('Claim'), 'read-only: no draft-action buttons appear when inspecting a historical champion');

  const backBtn = [...q('button')].find((b) => b.textContent.trim() === '\u2190 Back');
  ok(!!backBtn, 'a plain Back button is present');
  click(backBtn);
  await wait(30);
  ok(document.body.textContent.includes('Champions'), 'Back returns to the champion History screen (not somewhere else)');
  ctrl.destroy();
}

console.log('\n— "Draft Again" on the results screen starts a brand-new free-play draft —');
{
  const fb = makeFakeFB();
  const identity = { uid: 'player1', name: 'Ash' };
  const ctrl = await draftFresh(fb, identity);
  await runGauntletFromDraftComplete();
  ok(document.body.textContent.includes('Gauntlet Results'), 'reached the Gauntlet Results screen');
  const again = btn('Draft Again');
  ok(!!again, 'the Draft Again button is present on the results screen');
  click(again);
  await wait(80);
  ok(!document.body.textContent.includes('Gauntlet Results'), 'clicking Draft Again leaves the results screen');
  ok(!!document.querySelector('.draft-advance-btns') || !!document.querySelector('.draft-card'),
    'a fresh draft has started (the draft card / advance controls are shown again)');
  ctrl.destroy();
}

console.log('\n— Down-cascade: beating human holders pushes them DOWN one rung (not erasing them) —');
{
  // Pre-seed the ladder to mirror the canonical example, using DIFFERENT mons
  // than WINNING_SEED produces so none of the one-mon-one-throne (#14a) logic
  // interferes: Lance(all), Karen(year), Will(day) held by OTHER players;
  // Bruno(month) + Koga(week) held by AI (absent from the map). Then a fresh
  // player sweeps and takes the top spot.
  const fb = makeFakeFB();
  const lanceHolder = { mon: { name: 'AaaHolder', types: ['Normal'], baseStats: { hp: 11, atk: 11, def: 11, spa: 11, spd: 11, spe: 11 }, moves: [] }, holderUid: 'pLance', holderName: 'LanceHolder', takenAt: Date.now(), period: centralPeriodKey('all') };
  const karenHolder = { mon: { name: 'BbbHolder', types: ['Normal'], baseStats: { hp: 12, atk: 12, def: 12, spa: 12, spd: 12, spe: 12 }, moves: [] }, holderUid: 'pKaren', holderName: 'KarenHolder', takenAt: Date.now(), period: centralPeriodKey('year') };
  const willHolder  = { mon: { name: 'CccHolder', types: ['Normal'], baseStats: { hp: 13, atk: 13, def: 13, spa: 13, spd: 13, spe: 13 }, moves: [] }, holderUid: 'pWill', holderName: 'WillHolder', takenAt: Date.now(), period: centralPeriodKey('day') };
  await fb._forceSet('/draft/throne/all', lanceHolder);
  await fb._forceSet('/draft/throne/year', karenHolder);
  await fb._forceSet('/draft/throne/day', willHolder);
  // month + week deliberately left unset → AI-held.

  const identity = { uid: 'newDrafter', name: 'Newbie' };
  const ctrl = await draftFresh(fb, identity); // WINNING_SEED sweeps all five
  const { summary } = await runGauntletFromDraftComplete();
  ok(summary.includes('claimed'), 'the sweeping drafter claims the top spot');

  const all = await fb.get('/draft/throne/all');
  const year = await fb.get('/draft/throne/year');
  const month = await fb.get('/draft/throne/month');
  const week = await fb.get('/draft/throne/week');
  const day = await fb.get('/draft/throne/day');

  ok(!!all && all.holderUid === 'newDrafter', 'the drafter now holds the top (all) spot');
  ok(!!year && year.holderUid === 'pLance', 'the displaced top-holder (LanceHolder) was pushed DOWN to year — NOT erased');
  ok(!!month && month.holderUid === 'pKaren', 'the displaced year-holder (KarenHolder) cascaded DOWN to month, overwriting the AI that was there');
  ok(!week || week.holderUid !== 'pKaren', 'the cascade stopped at the AI-held month — week was not disturbed by the chain');
  ok(!!day && day.holderUid === 'pWill', 'the day PLAYER (WillHolder) stays put — below where the cascade stopped, even though the drafter beat them climbing');
  // Nobody who was a real player got silently deleted (the actual reported bug):
  const survivingUids = [all, year, month, day].filter(Boolean).map((r) => r.holderUid);
  ok(survivingUids.includes('pLance') && survivingUids.includes('pKaren') && survivingUids.includes('pWill'),
    'all three pre-existing human holders still exist somewhere on the ladder — none were erased');
  ctrl.destroy();
}

console.log('\n— A stale (rolled-over) throne record must NOT be resurrected onto a second spot by the cascade —');
{
  // The reported bug: the SAME mon holding two spots (e.g. one player's Poliwag
  // on both Karen and Bruno), which "could happen again every year at reset."
  // Root cause: claimThrone read the RAW throne data, so a record whose period
  // had ROLLED OVER (displays as an NPC now, but the old player record still
  // physically sits in the DB) was treated as a live player holder. When a new
  // champ then TAKES that very spot, the stale holder was "displaced" and the
  // down-cascade pushed it onto the next spot down — rewritten with the CURRENT
  // period — resurrecting the same mon onto a second rung.
  //
  // Trigger precisely: a stale record sits at 'all' (Lance, the TOP spot). A mon
  // that sweeps to the top (WINNING_SEED) claims 'all'. Pre-fix, the stale holder
  // at 'all' is read as live and "displaced" by the sweeper, so the down-cascade
  // pushes it to 'year' with a fresh period — resurrecting it onto a second rung.
  const fb = makeFakeFB();
  const identity = { uid: 'newDrafter', name: 'Tom' };
  const stalePoliwag = { name: 'Poliwag', types: ['Water'], baseStats: { hp: 40, atk: 50, def: 40, spa: 40, spd: 40, spe: 90 }, moves: [] };
  await fb._forceSet('/draft/throne/all', {
    mon: stalePoliwag, holderUid: 'tomOld', holderName: 'Tom', takenAt: 1, period: 'STALE-not-all',
  });

  document.getElementById('app').innerHTML = '';
  const ctrl = await withDraftSeed(WINNING_SEED, async () => {
    const c = createDraftBattle({
      mount: document.getElementById('app'), config: {}, data: gen2,
      params: { variant: 'freeplay', _getFirebase: async () => fb, _getIdentity: async () => identity },
      onExit: () => {},
    });
    await wait(50);
    return c;
  });
  await greedyDraftThroughUI();
  await runGauntletFromDraftComplete(); // sweeps, claims 'all'

  const all = await fb.get('/draft/throne/all');
  const year = await fb.get('/draft/throne/year');
  const isCurrentPoliwag = (rec, key) => !!(rec && rec.holderUid && rec.mon && rec.mon.name === 'Poliwag' && rec.period === centralPeriodKey(key));
  ok(!!all && all.holderUid === 'newDrafter', 'the sweeping mon genuinely claims the top (all) spot');
  ok(!isCurrentPoliwag(year, 'year'), 'the stale Poliwag from the taken top spot is NOT resurrected onto the next rung down (year) with a fresh period — the exact two-spots-one-mon bug');
  // And it is nowhere current on the ladder at all:
  const allTiers = {};
  for (const k of ['all', 'year', 'month', 'week', 'day']) allTiers[k] = await fb.get(`/draft/throne/${k}`);
  const currentPoliwagSpots = Object.keys(allTiers).filter((k) => isCurrentPoliwag(allTiers[k], k));
  ok(currentPoliwagSpots.length === 0, `the stale Poliwag holds ZERO current spots (found: ${JSON.stringify(currentPoliwagSpots)}) — rolled-over records stay rolled-over`);
  ctrl.destroy();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
