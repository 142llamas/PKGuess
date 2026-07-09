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

// Seed 7, greedily drafted (first-available stat/type/move each card), reliably
// beats all five Elite-4 tiers for today's date — found offline by searching
// DraftSession seeds against runMatch with the exact same greedy click order
// the UI produces.
const WINNING_SEED = 7;

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

async function draftFresh(fb, identity) {
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
  return ctrl;
}

/** Runs the gauntlet from the Draft Complete screen and returns the parsed
 *  results-table rows + whether a claim button is present. */
async function runGauntletFromDraftComplete() {
  click(btn('Challenge the Elite 4'));
  await wait(150);
  const rows = [...q('.lb-table tbody tr')].map((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    return { tier: cells[0]?.textContent.trim(), opponent: cells[1]?.textContent.trim(), result: cells[2]?.textContent.trim() };
  });
  const summary = document.querySelector('.summary-score')?.textContent || '';
  const claimBtn = [...q('button')].find((b) => b.textContent.includes('Claim'));
  return { rows, summary, claimBtn };
}

function statusBadge() {
  return [...q('.summary-card p, .summary-card div')].find((n) => n.textContent.includes('Your best'))?.textContent || null;
}

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

  const { rows, summary, claimBtn } = await runGauntletFromDraftComplete();
  eq(rows.length, 5, 'the gauntlet attempts all five tiers when the challenger wins every matchup');
  ok(rows.every((r) => r.result.includes('Won')), 'every matchup is won with this deterministic build');
  ok(summary.includes('Champion'), 'the placement message names the top spot (Champion) after clearing All-Time');
  ok(!!claimBtn, 'a single Claim button is offered for the highest spot reached');
  ok(!!btn('📤 Share'), '#15: a single consolidated Share button is offered on the results screen (not one per victory)');
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

  click(claimBtn);
  await wait(60);
  const dump = await fb.get('/draft/throne/all');
  ok(!!dump && dump.holderUid === 'player1', 'claiming from the results screen actually persists the highest throne reached (All-Time)');
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
    // Seed 22, like WINNING_SEED above, was found offline for TODAY'S DATE
    // specifically (Will/Koga's NPCs are period-keyed by day/week, so a
    // seed that beats Will and loses to Koga today isn't guaranteed to
    // still do so on a different day — if this ever needs re-finding, the
    // search is: draft greedily through the UI for seeds 1..N, run the
    // gauntlet, and look for Won-then-Lost in the first two rows).
    document.getElementById('app').innerHTML = '';
    const ctrl2 = await withDraftSeed(22, async () => {
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
    const { rows: rows2, claimBtn: claimBtn2 } = await runGauntletFromDraftComplete();
    ok(rows2.some((r) => r.opponent === 'Will' && r.result.includes('Won')), 'this build beats Will');
    ok(rows2.some((r) => r.opponent === 'Koga' && r.result.includes('Lost')), 'and loses to Koga, matching the exact bug report shape (won the lowest spot, lost the next one)');
    ok(!!claimBtn2, 'a Claim button is offered for the highest spot actually reached (Will)');
    click(claimBtn2);
    await wait(60);
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
  // only the "X's " name prefix changes. Pre-seed Will with the EXACT shape
  // this specific seed+identity combination is about to produce (confirmed
  // via this exact seed/name pair, matching the app's own real stats), as if
  // this same mon had separately claimed Will at some earlier point -- this
  // avoids the unrelated "re-fighting your own prior claim" edge case that
  // coming at this via two live gauntlet runs would have triggered instead.
  await fb._forceSet('/draft/throne/day', {
    mon: { name: 'Falkner\'s Kangaskhan', types: ['Normal', 'Psychic'], baseStats: { hp: 105, atk: 95, def: 100, spa: 100, spd: 50, spe: 55 }, moves: ['High Jump Kick', 'Return', 'Headbutt', 'Earthquake'] },
    holderUid: 'player10', holderName: 'Falkner', takenAt: Date.now(), period: 'day-preexisting',
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
  eq(monName, 'Falkner\'s Kangaskhan', 'sanity check: this seed+identity combination produces the exact mon the throne was pre-seeded with');
  const { claimBtn } = await runGauntletFromDraftComplete();
  click(claimBtn);
  await wait(60);
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
  const { claimBtn } = await runGauntletFromDraftComplete();
  ok(!!claimBtn, 'still reaches a claimable result (the write failure is unrelated to combat)');
  click(claimBtn);
  await wait(60);
  ok(document.body.textContent.includes('Could not verify'), '#12: a throne write that silently fails to persist surfaces a clear error, not a false "you took the spot" toast');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
