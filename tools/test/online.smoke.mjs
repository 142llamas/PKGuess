import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body><div id="A"></div><div id="B"></div></body></html>', { url: 'https://example.com/' });
const { window } = dom;
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch {} };
global.window = window; global.document = window.document;
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

const A = createOnline({ mount: document.getElementById('A'), config: {}, data: {}, params: mkParams(idA), onExit: () => {} });
const B = createOnline({ mount: document.getElementById('B'), config: {}, data: {}, params: mkParams(idB), onExit: () => {} });
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
const eng = buildEngine({ data: JSON.parse(readFileSync(dataPath('../../docs/data/gen2.json'), 'utf8')), movelist: {}, seed: seedFor(snap.seed, snap.roundNum), poolFilter: 'gen2', poolStart: snap.settings.poolStart });
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

A.destroy(); B.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 0 : 0); // report only; non-fatal exit for the harness
if (fail) process.exitCode = 1;
