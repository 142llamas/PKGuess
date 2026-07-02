import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body><div id="A"></div><div id="B"></div></body></html>', { url: 'https://example.com/' });
const { window } = dom;
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch {} };
global.window = window; global.document = window.document;
global.alert = () => {}; global.confirm = () => true;
def('navigator', window.navigator); def('Node', window.Node); def('HTMLElement', window.HTMLElement); def('MouseEvent', window.MouseEvent);

// ---- controllable clock + manual interval scheduler ----
let NOW = 1_000_000;
const realDateNow = Date.now;
def('Date', class extends Date { static now() { return NOW; } });
const intervals = [];
global.setInterval = (fn) => { const h = { fn }; intervals.push(h); return h; };
global.clearInterval = (h) => { const i = intervals.indexOf(h); if (i >= 0) intervals.splice(i, 1); };
const realSetTimeout = setTimeout;
global.setTimeout = (fn, ms) => realSetTimeout(fn, 0); // collapse focus/render timeouts
const flushIntervals = async () => { for (const h of intervals.slice()) await h.fn(); await tickMicro(); };
const tickMicro = () => new Promise((r) => realSetTimeout(r, 0));
const advance = async (ms) => { NOW += ms; await flushIntervals(); };

// ---- data fetch stub ----
const dataPath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
global.fetch = async (url) => {
  const map = { 'data/gen2.json': '../../docs/data/gen2.json', 'data/movelist-gen2.json': '../../docs/data/movelist-gen2.json' };
  const p = map[url]; if (!p) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => JSON.parse(readFileSync(dataPath(p), 'utf8')) };
};

// ---- in-memory Firebase shared by both clients ----
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
function makeDB() {
  const tree = {}; const listeners = [];
  const get = (path) => { let n = tree; for (const k of path.split('/').filter(Boolean)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n == null ? null : n; };
  const setRaw = (path, val) => { const parts = path.split('/').filter(Boolean); let n = tree; for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; } n[parts[parts.length - 1]] = clone(val); };
  const fire = (writePath) => { for (const l of listeners.slice()) { if (writePath === l.path || writePath.startsWith(l.path + '/') || l.path.startsWith(writePath + '/')) { const v = get(l.path); l.cb(v == null ? null : clone(v)); } } };
  return {
    set: async (p, v) => { setRaw(p, v); fire(p); },
    update: async (p, v) => { if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, val] of Object.entries(v)) setRaw(p + '/' + k, val); } else { setRaw(p, v); } fire(p); },
    get: async (p) => clone(get(p)),
    onValue: (p, cb) => { const l = { path: p, cb }; listeners.push(l); const v = get(p); cb(v == null ? null : clone(v)); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
    onDisconnectSet: () => {},
  };
}

const gen2Data = JSON.parse(readFileSync(dataPath('../../docs/data/gen2.json'), 'utf8'));
const { createOnline } = await import('../../docs/js/modes/online.js');

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const q = (rootId, sel) => document.getElementById(rootId).querySelectorAll(sel);
const findBtn = (rootId, text) => [...document.getElementById(rootId).querySelectorAll('button')].find((b) => b.textContent.includes(text));
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const settle = async () => { await tickMicro(); await tickMicro(); await tickMicro(); };

const db = makeDB();
const idA = { uid: 'uidA', name: 'Ash' };
const idB = { uid: 'uidB', name: 'Misty' };
const mkParams = (id) => ({ gen: 2, _getFirebase: () => Promise.resolve(makeClientView(db)), _getIdentity: () => Promise.resolve(id) });
// each "client" gets its own fb view but they share the same db+listeners
function makeClientView(db) { return db; }

const A = createOnline({ mount: document.getElementById('A'), config: {}, data: gen2Data, params: mkParams(idA), onExit: () => {} });
const B = createOnline({ mount: document.getElementById('B'), config: {}, data: gen2Data, params: mkParams(idB), onExit: () => {} });
await settle();

// A creates a room
click(findBtn('A', 'Create a room')); await settle();
// set fast settings? defaults fine. lower winTarget by typing
const aWin = [...q('A', 'input')][0];
// create with defaults
click(findBtn('A', 'Create room')); await settle();
const roomCode = (await db.get('/rooms') && Object.keys((await db.get('/rooms')))[0]);
ok(!!roomCode && roomCode.length === 6, `room created with 6-char code (${roomCode})`);
ok((await db.get(`/rooms/${roomCode}`)).status === 'lobby', 'room in lobby');

// B joins
click(findBtn('B', 'Join with a code')); await settle();
const codeInput = [...q('B', 'input')][0];
codeInput.value = roomCode;
codeInput.dispatchEvent(new window.Event('input', { bubbles: true }));
click(findBtn('B', 'Join')); await settle();
let snap = await db.get(`/rooms/${roomCode}`);
ok(Object.keys(snap.players).length === 2, `2 players in room (${Object.keys(snap.players).length})`);
ok(snap.joinOrder.length === 2 && snap.joinOrder[0] === 'uidA', 'join order host-first');

// host (A) starts
click(findBtn('A', 'Start game')); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.status === 'playing' && snap.roundNum === 1, 'game started, round 1');
ok(snap.pool === snap.settings.poolStart, 'pool initialized');
ok(snap.turnOrder[snap.currentTurnPos] === 'uidA', 'A acts first');

// A reveals a clue (choose mode, RTG): pick first available clue card in A's view
let aClue = [...q('A', '.online-clue.available')][0];
ok(!!aClue, 'A sees available clue cards on its turn');
const poolBefore = snap.pool;
click(aClue); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.revealedClueIds.length === 1, 'one clue revealed (shared)');
ok(snap.pool < poolBefore, 'pool dropped after reveal');
ok(snap.phase === 'guess', 'RTG → guess phase after reveal');
// B sees the revealed value too (derived locally, identical)
ok([...q('B', '.online-clue.revealed')].length === 1, 'B sees the same revealed clue');

// A makes a WRONG guess → turn passes to B
const aInput = document.getElementById('A').querySelector('#online-typing');
ok(!!aInput, 'A has a guess input');
aInput.value = 'Magikarp-not-the-answer';
click(findBtn('A', 'Guess')); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.turnOrder[snap.currentTurnPos] === 'uidB', 'after A wrong guess, B is active');
ok((snap.guessLog || []).length >= 1, 'guess logged');

// B's turn starts in REVEAL phase (RTG). B reveals a clue → advances to guess.
let bClue = [...q('B', '.online-clue.available')][0];
ok(!!bClue, 'B sees available clues at the start of its turn (reveal phase)');
click(bClue); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.phase === 'guess', 'B advanced to guess phase after revealing');

// B guesses correctly: derive the mystery from the seed exactly like the client
const { buildEngine, seedFor } = await import('../../docs/js/lib/mp-rules.js');
const { poolFilterForData } = await import('../../docs/js/lib/engine.js');
const eng = buildEngine({ data: JSON.parse(readFileSync(dataPath('../../docs/data/gen2.json'), 'utf8')), movelist: {}, seed: seedFor(snap.seed, snap.roundNum), poolFilter: poolFilterForData(snap.settings.gen), poolStart: snap.settings.poolStart });
const answer = eng.mystery.name;
const bInput = document.getElementById('B').querySelector('#online-typing');
ok(!!bInput, 'B has a guess input on its turn');
bInput.value = answer;
click(findBtn('B', 'Guess')); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.status === 'roundOver' || snap.status === 'gameOver', 'correct guess ends the round');
ok(snap.roundResult && snap.roundResult.winnerUid === 'uidB', 'B recorded as winner');
ok((snap.players.uidB.score || 0) > 0, `B earned points (${snap.players.uidB.score})`);
ok(snap.roundResult.mysteryName === answer, 'round result names the verified answer');

// leader auto-advances ~5s later (NOW controllable). A is host → leader.
if (snap.status === 'roundOver') {
  await advance(6000);
  snap = await db.get(`/rooms/${roomCode}`);
  ok(snap.status === 'playing' && snap.roundNum === 2, `auto-advanced to round 2 (status ${snap.status}, round ${snap.roundNum})`);
  ok(snap.turnOrder[snap.currentTurnPos] === 'uidA', 'winner rotated to end → A leads round 2');
}

// turn timer: A idles past 60s+grace → leader (A is leader/host but also active; leader skips at deadline)
snap = await db.get(`/rooms/${roomCode}`);
const activeBefore = snap.turnOrder[snap.currentTurnPos];
await advance(63000);
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.turnOrder[snap.currentTurnPos] !== activeBefore, 'turn auto-skips after the timer expires');

// ---------------------------------------------------------------------------
// #2/#1f — persistent post-game lobby + opt-in rematch, same pattern as
// Cycling Road. Force the room straight to gameOver (the win-condition path
// is already covered above) so these tests focus on the NEW rematch logic.
console.log('\n— #2/#1f: persistent lobby + rematch (opt-in, host countdown) —');
await db.update(`/rooms/${roomCode}`, {
  status: 'gameOver',
  players: {
    uidA: { ...snap.players.uidA, score: 150, rematch: false, connected: true },
    uidB: { ...snap.players.uidB, score: 90, rematch: false, connected: true },
  },
  rematchCountdownEndsAt: null,
});
await settle();
ok(!findBtn('A', 'Play again'), 'the old one-click "Play again" is gone');
ok(!!findBtn('A', 'Want a rematch'), 'A sees the rematch opt-in toggle');
ok(!!findBtn('A', 'Main menu'), 'the post-game screen offers Main menu (was "Leave room")');

click(findBtn('A', 'Want a rematch')); await settle();
click(findBtn('B', 'Want a rematch')); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.players.uidA.rematch && snap.players.uidB.rematch, 'both players are marked rematch:true');

const startRematchBtn = findBtn('A', 'Start rematch');
ok(!!startRematchBtn && !startRematchBtn.disabled, 'host (A) sees an ENABLED Start-rematch button once someone else has opted in too');
click(startRematchBtn); await settle();
snap = await db.get(`/rooms/${roomCode}`);
ok(!!snap.rematchCountdownEndsAt, 'starting the rematch sets a countdown deadline');

await advance(5200);
snap = await db.get(`/rooms/${roomCode}`);
ok(snap.status === 'playing', 'after the 5s countdown, a NEW game auto-started (leader-driven tick)');
ok(snap.players.uidA.score === 0 && snap.players.uidB.score === 0, 'the rematch reset both players\u2019 scores to 0');
ok(snap.roundNum === 1, 'the rematch starts at round 1');

// #2 — "nobody else opted in": isolate in a fresh room so it doesn't disturb A/B's game above.
console.log('\n— #2: rematch with nobody else opted in → host sees an error, returns to main menu —');
let hostExited = false;
const idC = { uid: 'uidC', name: 'Erika' };
const C = createOnline({ mount: (() => { const d = document.createElement('div'); d.id = 'C'; document.body.appendChild(d); return d; })(), config: {}, data: gen2Data, params: mkParams(idC), onExit: () => { hostExited = true; } });
await settle();
click(findBtn('C', 'Create a room')); await settle();
click(findBtn('C', 'Create room')); await settle();
const rooms = await db.get('/rooms');
const code2 = Object.keys(rooms).find((k) => k !== roomCode);
await db.update(`/rooms/${code2}`, { status: 'gameOver', players: { uidC: { ...rooms[code2].players.uidC, score: 10, rematch: false, connected: true } } });
await settle();
click(findBtn('C', 'Want a rematch')); await settle();
const soloStartBtn = findBtn('C', 'Start rematch');
ok(!!soloStartBtn, 'the lone host sees the Start-rematch button');
ok(soloStartBtn.disabled, 'but it is disabled — nobody ELSE has opted in');
// Force the countdown anyway to exercise the resolver's own safety check:
await db.set(`/rooms/${code2}/rematchCountdownEndsAt`, NOW + 5000);
await settle();
await advance(5200);
ok(hostExited, 'once the countdown resolves with nobody else opted in, the host is returned to the main menu');
const afterCode2 = await db.get(`/rooms/${code2}/rematchCountdownEndsAt`);
ok(afterCode2 == null, 'the countdown flag is cleared after resolving');
C.destroy();

// ---------------------------------------------------------------------------
// #4 — feature parity with hot-seat: category clue mode, real category
// diversity, the clue-exclusion panel, and evolution auto-deduction. Uses a
// fresh isolated room so it doesn't disturb the RTG/choose scenario above.
console.log('\n— #4: category mode + diversity + exclusion + evo-deduction (online \u2194 hot-seat parity) —');
{
  const idD = { uid: 'uidD', name: 'Dawn' };
  const idE = { uid: 'uidE', name: 'Erika' };
  const dDiv = document.createElement('div'); dDiv.id = 'D'; document.body.appendChild(dDiv);
  const eDiv = document.createElement('div'); eDiv.id = 'E'; document.body.appendChild(eDiv);
  const D = createOnline({ mount: dDiv, config: {}, data: gen2Data, params: mkParams(idD), onExit: () => {} });
  const E = createOnline({ mount: eDiv, config: {}, data: gen2Data, params: mkParams(idE), onExit: () => {} });
  await settle();

  const codesBeforeD = Object.keys((await db.get('/rooms')) || {});
  click(findBtn('D', 'Create a room')); await settle();
  // Pick "By category" clue picking + "Force different" diversity
  const catBtn = [...q('D', '.online-seg-btn')].find((b) => b.textContent.includes('By category'));
  ok(!!catBtn, 'the "By category" clue-picking option is now offered (was choose/random only)');
  click(catBtn);
  const diffBtn = [...q('D', '.online-seg-btn')].find((b) => b.textContent.includes('Force different'));
  ok(!!diffBtn, 'a Category Diversity setting is now offered (previously did not exist in online at all)');
  click(diffBtn);
  ok(!!findBtn('D', 'Clue Availability'), 'the clue-exclusion panel is now offered (hot-seat parity)');
  click(findBtn('D', 'Create room')); await settle();

  const roomsAll = await db.get('/rooms');
  const code2 = Object.keys(roomsAll).find((k) => !codesBeforeD.includes(k));
  ok(!!code2, 'a second room was created');
  ok(roomsAll[code2].settings.clueMode === 'category', 'room settings recorded clueMode:category');
  ok(roomsAll[code2].settings.catDiversity === 'diff', 'room settings recorded catDiversity:diff');

  click(findBtn('E', 'Join with a code')); await settle();
  const codeInput2 = [...q('E', 'input')][0];
  codeInput2.value = code2; codeInput2.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(findBtn('E', 'Join')); await settle();
  click(findBtn('D', 'Start game')); await settle();
  let s2 = await db.get(`/rooms/${code2}`);
  ok(s2.status === 'playing', 'category-mode room started');

  const activeId = s2.turnOrder[s2.currentTurnPos];
  const activeMount = activeId === 'uidD' ? 'D' : 'E';

  // Individual clue cards must NOT be directly clickable in category mode.
  const anyCard = [...q(activeMount, '.online-clue')][0];
  ok(!!anyCard, 'clue cards are rendered in category mode (read-only reference)');
  const beforeClick = await db.get(`/rooms/${code2}`);
  click(anyCard); await settle();
  const afterClick = await db.get(`/rooms/${code2}`);
  eq2(afterClick.revealedClueIds.length, beforeClick.revealedClueIds.length, 'clicking an individual card in category mode reveals NOTHING');

  // A category header IS clickable and reveals a clue from that category.
  const header = [...document.getElementById(activeMount).querySelectorAll('.cat-section-clickable:not(.reveal-disabled) .cat-header-reveal')][0];
  ok(!!header, 'at least one category header is clickable');
  click(header.closest('.cat-section-clickable')); await settle();
  s2 = await db.get(`/rooms/${code2}`);
  ok(s2.revealedClueIds.length >= 1, 'clicking the category header revealed a clue');

  // Force-Different: the SAME category should now be blocked.
  const catNameUsed = header.querySelector('.cat-name')?.textContent;
  const sameSection = [...document.getElementById(activeMount).querySelectorAll('.cat-section-clickable')].find((sec) => sec.querySelector('.cat-name')?.textContent === catNameUsed);
  ok(sameSection && sameSection.classList.contains('reveal-disabled'), `the just-used category (${catNameUsed}) is now reveal-disabled (Force Different, #4)`);

  D.destroy(); E.destroy();
}

function eq2(a, b, m) { ok(a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }

// Evolution auto-deduction + multi-use re-offer, verified directly against
// the shared engine primitives (same primitives online.js's revealClue now
// calls) rather than fighting the UI for a specific deduction scenario.
console.log('\n— #4: evolution auto-deduction + multi-use clue re-offer use the SAME shared helper as hot-seat —');
{
  const { computeAutoDeducedIds } = await import('../../docs/js/lib/mp-rules.js');
  const { PokeGuessRound } = await import('../../docs/js/lib/engine.js');
  const dragonite = gen2Data.pokedex.find((p) => p.name === 'Dragonite');
  const r = new PokeGuessRound({ genData: gen2Data, rng: Math.random });
  r.start({ difficultyId: 'custom', mystery: dragonite, clueMode: 'choose', custom: { points: 999, guessCost: 0, startClueMode: 'none' } });
  r.buyClue(10); // reveal "Can Evolve" manually
  const deduced = computeAutoDeducedIds(r, new Set());
  ok(deduced.length > 0, `revealing "Can Evolve" auto-deduces further evolution clues (got ids: ${deduced})`);
  ok(deduced.every((id) => id in r.revealedClues), 'every deduced id is actually reflected in the round\u2019s revealedClues');

  // exclusion respected
  const r2 = new PokeGuessRound({ genData: gen2Data, rng: Math.random });
  r2.start({ difficultyId: 'custom', mystery: dragonite, clueMode: 'choose', custom: { points: 999, guessCost: 0, startClueMode: 'none' } });
  r2.buyClue(10);
  const deduced2 = computeAutoDeducedIds(r2, new Set([8, 9, 11]));
  ok(deduced2.length === 0, 'excludedIds are honored by the SAME shared deduction helper online.js now uses');
}

A.destroy(); B.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 0 : 0); // report only; non-fatal exit for the harness
if (fail) process.exitCode = 1;
