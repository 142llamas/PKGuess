// Daily Draft smoke test: individual head-to-head matchups (against every
// other submitted player, including Cal), on-demand battle replay reusing
// the ALREADY-COMPUTED sample log (no re-simulation), the read-only mon
// "inspect" view, and the Daily Rival -> Cal rename.
//
// Drives the REAL controller (docs/js/modes/draftbattle.js) against a real
// (non-"offline") fake Firebase, pre-seeding several players' daily entries
// directly (bypassing drafting through the UI for the fake opponents) then
// landing straight on the results screen via params.view='results' — the
// same route the main menu's "Results" button uses.
//
// Run: node tools/test/daily.smoke.mjs
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

// ---- fake Firebase (same shape as throne.smoke.mjs) ------------------------
function makeFakeFB() {
  const tree = {};
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  function snap(path) { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return clone(n); }
  function setDeep(path, val) {
    const ks = parts(path);
    let n = tree; for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) n[ks[i]] = {}; n = n[ks[i]]; }
    n[ks[ks.length - 1]] = clone(val);
  }
  return {
    async set(p, v) { setDeep(p, v); return true; },
    async update(p, o) { const cur = snap(p) || {}; setDeep(p, { ...cur, ...o }); return true; },
    async get(p) { return snap(p); },
    onValue(p, cb) { cb(snap(p)); return () => {}; },
    onDisconnectSet() {}, auth: {},
    _forceSet: (p, v) => setDeep(p, v),
  };
}

const { createDraftBattle } = await import('../../docs/js/modes/draftbattle.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelectorAll(s);
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const btn = (text) => [...q('button')].find((b) => b.textContent.trim().includes(text));

// Central-Time date string matching share.js's own centralDateStr() (a fixed
// clock isn't needed here since we only need it to match whatever the app
// itself computes "today" as — grab it the same way the app does).
function centralDateStr() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const dateStr = centralDateStr();

// Hand-built "stored mon" entries — real types/moves/stat shapes, no need to
// draft through the UI for the fake opponents (only the shape matters to the
// simulator: {name, types, baseStats, moves}).
function mon(name, types, baseStats, moves) { return { name, types, baseStats, moves }; }
const fb = makeFakeFB();
fb._forceSet(`/draft/daily/${dateStr}/entries/uidBob`, {
  name: 'Bob', at: Date.now(),
  mon: mon('Bob\u2019s Feraligatr', ['Water'], { hp: 85, atk: 105, def: 100, spa: 79, spd: 83, spe: 78 }, ['Surf', 'Ice Beam', 'Earthquake', 'Bite']),
});
fb._forceSet(`/draft/daily/${dateStr}/entries/uidCarol`, {
  name: 'Carol', at: Date.now(),
  mon: mon('Carol\u2019s Skarmory', ['Steel', 'Flying'], { hp: 65, atk: 80, def: 140, spa: 40, spd: 70, spe: 70 }, ['Fly', 'Steel Wing', 'Toxic', 'Whirlwind']),
});
fb._forceSet(`/draft/daily/${dateStr}/entries/uidMe`, {
  name: 'Ash', at: Date.now(),
  mon: mon('Ash\u2019s Typhlosion', ['Fire'], { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, ['Fire Blast', 'Thunder Punch', 'Earthquake', 'Swagger']),
});

const params = {
  gen: 2, modeId: 'dailychallenge', variant: 'daily', view: 'results',
  _getFirebase: async () => fb,
  _getIdentity: async () => ({ uid: 'uidMe', name: 'Ash' }),
};
const ctrl = createDraftBattle({ mount: document.getElementById('app'), config: {}, data: gen2, params, onExit: () => {} });
await wait(200); // startDaily (identity/firebase resolve) -> showDailyResults -> compute (30ms deferred)

console.log('\n— Daily Rival renamed to Cal —');
{
  ok(document.body.textContent.includes('Cal'), 'Cal appears somewhere in the results');
  ok(!document.body.textContent.includes('Daily Rival'), '"Daily Rival" no longer appears anywhere');
}

console.log('\n— Results table has one row per entrant (3 real players + Cal), each with Matchups + Inspect buttons —');
{
  const rows = [...q('.lb-table tbody tr')];
  eq(rows.length, 4, '4 entrants total: Ash (me), Bob, Carol, Cal');
  for (const row of rows) {
    const buttons = [...row.querySelectorAll('button')];
    ok(buttons.some((b) => b.textContent.includes('\uD83D\uDCCA')), `row "${row.textContent.slice(0, 20)}" has a Matchups (\uD83D\uDCCA) button`);
    ok(buttons.some((b) => b.textContent.includes('\uD83D\uDD0D')), `row "${row.textContent.slice(0, 20)}" has an Inspect (\uD83D\uDD0D) button`);
  }
}

console.log('\n— My Matchups: one row per OTHER entrant, no self-battling, each with a working Watch button —');
let myWatchOutcomeText = null;
{
  const myRow = [...q('.lb-table tbody tr')].find((r) => r.textContent.includes('Ash'));
  click([...myRow.querySelectorAll('button')].find((b) => b.textContent.includes('\uD83D\uDCCA')));
  await wait(20);
  ok(document.body.textContent.includes('Ash\u2019s Matchups'), 'matchups screen title shows whose matchups these are');
  const muRows = [...q('.lb-table tbody tr')];
  eq(muRows.length, 3, 'exactly 3 matchups for Ash: vs Bob, vs Carol, vs Cal (never vs Ash)');
  ok(!muRows.some((r) => r.textContent.includes('Ash')), 'no self-battling: Ash never appears as an opponent in Ash\u2019s own matchup list');
  ok(muRows.some((r) => r.textContent.includes('Bob')), 'Bob appears as an opponent');
  ok(muRows.some((r) => r.textContent.includes('Carol')), 'Carol appears as an opponent');
  ok(muRows.some((r) => r.textContent.includes('Cal')), '#\u201c available for the daily rival\u201d: Cal appears as a regular opponent in the matchups list, same as any other player');
  for (const r of muRows) ok(/Won|Lost/.test(r.textContent) && /%$/.test(r.textContent.trim()) === false && /\d+%/.test(r.textContent), `matchup row shows a Won/Lost result with a % (row: "${r.textContent}")`);

  const vsBobRow = muRows.find((r) => r.textContent.includes('Bob'));
  myWatchOutcomeText = vsBobRow.textContent;
  click([...vsBobRow.querySelectorAll('button')].find((b) => b.textContent.includes('Watch')));
  await wait(20);
  ok(document.body.textContent.includes('Ash') && document.body.textContent.includes('Bob'), 'battle playback screen shows both combatants\u2019 names');
  ok(!!q('.battle-log-line').length || !!q('.battle-stage').length, 'battle playback UI actually rendered (stage/log present)');
}

console.log('\n— Watch replays the ALREADY-COMPUTED result, not a fresh simulation —');
{
  // Skip to the end of the battle and confirm the verdict matches what the
  // matchups list already showed BEFORE watching — proving no re-simulation
  // happened (a fresh simulation would very likely disagree at least once
  // across repeated runs; the stored result must always agree with itself).
  const skipBtn = [...q('button')].find((b) => b.textContent.includes('Skip'));
  click(skipBtn);
  await wait(20);
  const wonShown = myWatchOutcomeText.includes('Won');
  const verdictText = document.querySelector('.battle-verdict')?.textContent || '';
  const verdictWon = verdictText.includes('You win');
  eq(verdictWon, wonShown, 'the battle playback\u2019s final verdict agrees with the win/loss already shown in the matchups list (same computed result, just replayed)');

  // "Back to Results" from a matchup-row battle returns to the MATCHUPS list
  // (not straight to the daily results table), so the player doesn't lose
  // their place.
  const backBtn = [...q('button')].find((b) => b.textContent.includes('Back to Results'));
  click(backBtn);
  await wait(20);
  ok(document.body.textContent.includes('Ash\u2019s Matchups'), 'Back returns to the matchups list, not straight to the main results table');
}

console.log('\n— Cal\u2019s own matchups are viewable too (not just mine) —');
{
  const backToResultsBtn = [...q('button')].find((b) => b.textContent.includes('Back to Results'));
  click(backToResultsBtn);
  await wait(20);
  const calRow = [...q('.lb-table tbody tr')].find((r) => r.textContent.includes('Cal'));
  click([...calRow.querySelectorAll('button')].find((b) => b.textContent.includes('\uD83D\uDCCA')));
  await wait(20);
  ok(document.body.textContent.includes('Cal\u2019s Matchups'), 'Cal\u2019s matchups screen is reachable, same as any player\u2019s');
  const calMuRows = [...q('.lb-table tbody tr')];
  eq(calMuRows.length, 3, 'Cal has 3 matchups too: vs Ash, vs Bob, vs Carol');
  ok(!calMuRows.some((r) => r.textContent.includes('Cal')), 'no self-battling for Cal either');
}

console.log('\n— Inspect: read-only view of any entrant\u2019s drafted attributes —');
{
  const backBtn = [...q('button')].find((b) => b.textContent.includes('Back to Results'));
  click(backBtn);
  await wait(20);
  const bobRow = [...q('.lb-table tbody tr')].find((r) => r.textContent.includes('Bob'));
  click([...bobRow.querySelectorAll('button')].find((b) => b.textContent.includes('\uD83D\uDD0D')));
  await wait(20);
  ok(document.body.textContent.includes('Bob\u2019s Pok\u00e9mon'), 'inspect screen titled with whose Pok\u00e9mon this is');
  ok(document.body.textContent.includes('Feraligatr'), 'shows the actual drafted mon\u2019s name/species');
  ok([...q('.type-pill')].some((t) => t.textContent === 'Water'), 'shows the mon\u2019s type');
  ok(document.body.textContent.includes('Surf'), 'shows the mon\u2019s moves');
  ok(!!q('.stat-spread-grid').length, 'shows the stat spread');
  ok(!btn('Submit') && !btn('Challenge the Elite 4') && !btn('Share My Pok\u00e9mon'), 'read-only: none of the draft-in-progress action buttons appear (Submit/Challenge/Share)');
  const backFromInspect = [...q('button')].find((b) => b.textContent.trim() === '\u2190 Back');
  ok(!!backFromInspect, 'a plain Back button is present');
  click(backFromInspect);
  await wait(20);
  ok(document.body.textContent.includes('Daily Results'), 'Back returns to the main daily results screen');
}

ctrl.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
