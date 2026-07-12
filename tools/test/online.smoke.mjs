import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body><div id="A"></div><div id="B"></div></body></html>', { url: 'https://example.com/' });
const { window } = dom;
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch {} };
global.window = window; global.document = window.document;
global.alert = () => {}; global.confirm = () => true;
def('navigator', window.navigator); def('Node', window.Node); def('HTMLElement', window.HTMLElement); def('MouseEvent', window.MouseEvent); def('location', window.location);

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
const mkParams = (id, query) => ({ gen: 2, _getFirebase: () => Promise.resolve(makeClientView(db)), _getIdentity: () => Promise.resolve(id), query: query || {} });
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

// Derive the mystery now (not just later for B's correct guess) so A's
// "wrong guess" below can use a guaranteed-different REAL Pokemon name --
// guesses are now validated against the actual name list, so an invalid
// string like "Magikarp-not-the-answer" would be rejected outright rather
// than registering as a wrong guess.
const { buildEngine: buildEngineEarly, seedFor: seedForEarly } = await import('../../docs/js/lib/mp-rules.js');
const { poolFilterForData: poolFilterForDataEarly } = await import('../../docs/js/lib/engine.js');
const gen2DataEarly = JSON.parse(readFileSync(dataPath('../../docs/data/gen2.json'), 'utf8'));
const engEarly = buildEngineEarly({ data: gen2DataEarly, movelist: {}, seed: seedForEarly(snap.seed, snap.roundNum), poolFilter: poolFilterForDataEarly(snap.settings.gen), poolStart: snap.settings.poolStart });
const wrongGuessName = gen2DataEarly.pokedex.find((p) => p.name !== engEarly.mystery.name).name;

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
aInput.value = wrongGuessName;
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

// B guesses correctly: mystery already derived earlier (same round, same mystery)
const answer = engEarly.mystery.name;
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

// Evolution auto-deduction (#8 corrected): the shared helper must NOT reveal a
// clue the player hasn't actually earned. Revealing "Can Evolve = No" alone does
// not determine family size or stage (a mon can be the final form of a 2- or
// 3-member family), so nothing may be auto-revealed from it.
console.log('\n— #8: shared evo-deduction helper does not leak undetermined clues (online \u2194 hot-seat) —');
{
  const { computeAutoDeducedIds } = await import('../../docs/js/lib/mp-rules.js');
  const { PokeGuessRound } = await import('../../docs/js/lib/engine.js');
  const dragonite = gen2Data.pokedex.find((p) => p.name === 'Dragonite'); // fam 3, final, canEvolve No
  const r = new PokeGuessRound({ genData: gen2Data, rng: Math.random });
  r.start({ difficultyId: 'custom', mystery: dragonite, clueMode: 'choose', custom: { points: 999, guessCost: 0, startClueMode: 'none' } });
  r.buyClue(10); // reveal "Can Evolve" = No manually
  const deduced = computeAutoDeducedIds(r, new Set());
  ok(!(8 in r.revealedClues), 'revealing "Can Evolve" alone does NOT leak family size (#8)');
  ok(!(9 in r.revealedClues), 'revealing "Can Evolve" alone does NOT leak evolution stage (#8)');
  ok(deduced.every((id) => id in r.revealedClues), 'any deduced id is actually reflected in revealedClues');

  // exclusion respected (still honored by the same shared helper online.js uses)
  const r2 = new PokeGuessRound({ genData: gen2Data, rng: Math.random });
  r2.start({ difficultyId: 'custom', mystery: dragonite, clueMode: 'choose', custom: { points: 999, guessCost: 0, startClueMode: 'none' } });
  r2.buyClue(10);
  const deduced2 = computeAutoDeducedIds(r2, new Set([8, 9, 11]));
  ok(deduced2.length === 0, 'excludedIds are honored by the SAME shared deduction helper online.js now uses');
}

// ---------------------------------------------------------------------------
// #19 — online GTR: after a player's turn expires and the NEXT player then
// guesses wrong, that player's mandatory reveal step must yield exactly ONE
// clue (no "reveal as many as you want", no "Skip to guess" with zero
// reveals) and then the turn must pass back automatically — it must not get
// stuck on the same player forever. Uses a fresh isolated room.
console.log('\n— #19: online GTR after a turn-expiry — exactly one reveal, then auto-advance —');
{
  const idF = { uid: 'uidF', name: 'Brock' };
  const idG = { uid: 'uidG', name: 'Gary' };
  const fDiv = document.createElement('div'); fDiv.id = 'F'; document.body.appendChild(fDiv);
  const gDiv = document.createElement('div'); gDiv.id = 'G'; document.body.appendChild(gDiv);
  const F = createOnline({ mount: fDiv, config: {}, data: gen2Data, params: mkParams(idF), onExit: () => {} });
  const G = createOnline({ mount: gDiv, config: {}, data: gen2Data, params: mkParams(idG), onExit: () => {} });
  await settle();

  const codesBefore = Object.keys((await db.get('/rooms')) || {});
  click(findBtn('F', 'Create a room')); await settle();
  // Random clue picking (matches the exact reported scenario: "reveal random
  // clues") + Guess \u2192 Reveal (GTR) turn order.
  click([...q('F', '.online-seg-btn')].find((b) => b.textContent.includes('Random')));
  click([...q('F', '.online-seg-btn')].find((b) => b.textContent.includes('Guess \u2192 Reveal')));
  click(findBtn('F', 'Create room')); await settle();
  const codeG = Object.keys(await db.get('/rooms')).find((k) => !codesBefore.includes(k));
  ok(!!codeG, 'GTR room created');
  ok((await db.get(`/rooms/${codeG}`)).settings.gameMode === 'gtr', 'room settings recorded gameMode:gtr');

  click(findBtn('G', 'Join with a code')); await settle();
  const codeInputG = [...q('G', 'input')][0];
  codeInputG.value = codeG; codeInputG.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(findBtn('G', 'Join')); await settle();
  click(findBtn('F', 'Start game')); await settle();

  let sg = await db.get(`/rooms/${codeG}`);
  ok(sg.status === 'playing', 'GTR room started');
  ok(sg.turnOrder[sg.currentTurnPos] === 'uidF', 'F acts first');
  ok(sg.phase === 'guess', 'GTR starts in the GUESS phase (not reveal)');
  ok(!findBtn('F', 'Skip guess'), 'GTR\u2019s guess phase has no "Skip guess" option (removed \u2014 it undermined the guess-first design)');

  // "I let the first player's turn expire" — advance the clock past the turn
  // deadline + grace period.
  await advance(63000);
  sg = await db.get(`/rooms/${codeG}`);
  ok(sg.turnOrder[sg.currentTurnPos] === 'uidG', 'after F\u2019s turn expires, G becomes active');
  ok(sg.phase === 'guess', 'G starts in the guess phase (GTR)');

  // G guesses wrong \u2192 mandatory single-reveal phase, SAME player.
  const { buildEngine: buildEngineG, seedFor: seedForG } = await import('../../docs/js/lib/mp-rules.js');
  const { poolFilterForData: poolFilterForDataG } = await import('../../docs/js/lib/engine.js');
  const gen2DataG = JSON.parse(readFileSync(dataPath('../../docs/data/gen2.json'), 'utf8'));
  const engG = buildEngineG({ data: gen2DataG, movelist: {}, seed: seedForG(sg.seed, sg.roundNum), poolFilter: poolFilterForDataG(sg.settings.gen), poolStart: sg.settings.poolStart });
  const wrongGuessNameG = gen2DataG.pokedex.find((p) => p.name !== engG.mystery.name).name;
  const gInput = document.getElementById('G').querySelector('#online-typing');
  gInput.value = wrongGuessNameG;
  click(findBtn('G', 'Guess')); await settle();
  sg = await db.get(`/rooms/${codeG}`);
  ok(sg.phase === 'reveal', 'a wrong guess in GTR moves G into the reveal phase');
  ok(sg.turnOrder[sg.currentTurnPos] === 'uidG', 'still G\u2019s turn during the mandatory reveal');
  ok(!!findBtn('G', 'Reveal a random clue'), 'G is offered a reveal action');
  ok(!findBtn('G', 'Skip to guess'), '#19: no "Skip to guess" option during GTR\u2019s mandatory reveal (would let a turn end with ZERO reveals)');

  const revealedBefore = (sg.revealedClueIds || []).length;
  click(findBtn('G', 'Reveal a random clue')); await settle();
  sg = await db.get(`/rooms/${codeG}`);
  eq2((sg.revealedClueIds || []).length, revealedBefore + 1, 'exactly one clue was revealed');
  ok(sg.turnOrder[sg.currentTurnPos] === 'uidF', '#19: the turn passed back to F automatically \u2014 it did not stay stuck on G');
  ok(sg.phase === 'guess', '#19: F lands in the guess phase (GTR), not another reveal opportunity');

  // Confirm G genuinely cannot reveal again now that it's F's turn.
  ok(!findBtn('G', 'Reveal a random clue'), 'G no longer has a reveal action once the turn has passed');

  F.destroy(); G.destroy();
}

console.log('\n— Host-disconnect resilience: the room survives the original host leaving, and everyone is told —');
{
  const idH = { uid: 'uidH', name: 'Hilda' };
  const idI = { uid: 'uidI', name: 'Iris' };
  const hDiv = document.createElement('div'); hDiv.id = 'H'; document.body.appendChild(hDiv);
  const iDiv = document.createElement('div'); iDiv.id = 'I'; document.body.appendChild(iDiv);
  const H = createOnline({ mount: hDiv, config: {}, data: gen2Data, params: mkParams(idH), onExit: () => {} });
  const Ic = createOnline({ mount: iDiv, config: {}, data: gen2Data, params: mkParams(idI), onExit: () => {} });
  await settle();

  const codesBefore = Object.keys((await db.get('/rooms')) || {});
  click(findBtn('H', 'Create a room')); await settle();
  click(findBtn('H', 'Create room')); await settle();
  const codeHI = Object.keys(await db.get('/rooms')).find((k) => !codesBefore.includes(k));
  ok(!!codeHI, 'room created');

  click(findBtn('I', 'Join with a code')); await settle();
  const codeInputI = [...q('I', 'input')][0];
  codeInputI.value = codeHI; codeInputI.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(findBtn('I', 'Join')); await settle();

  ok(!findBtn('I', 'Start game'), 'before any disconnect, only the host (H) can start the game');
  ok(document.getElementById('I').textContent.includes('Waiting for the host'), 'I correctly sees "waiting for the host" while H is still connected');

  // The original host (H) disconnects BEFORE the game ever starts.
  await db.update(`/rooms/${codeHI}/players/uidH`, { connected: false });
  await settle();

  ok(document.getElementById('I').textContent.includes('has disconnected'), 'I is told the host has disconnected');
  ok(document.getElementById('I').textContent.includes('you are'), 'the banner tells I that THEY are now in control (I is the only other connected player)');
  ok(!!findBtn('I', 'Start game'), 'I (the new leader) can now start the game — the room is not permanently stuck');

  click(findBtn('I', 'Start game')); await settle();
  let hi = await db.get(`/rooms/${codeHI}`);
  ok(hi.status === 'playing', 'the game actually started, driven by the fallback leader');

  // Mid-game: let the (leaderless, since H is still disconnected) active
  // player's turn time out, and confirm the leader-driven tick() still
  // advances it — the core resilience duty this was all for.
  const activeBefore = hi.turnOrder[hi.currentTurnPos];
  await advance(63000);
  hi = await db.get(`/rooms/${codeHI}`);
  ok(hi.turnOrder[hi.currentTurnPos] !== activeBefore || hi.roundNum > 1 || hi.status !== 'playing', 'a turn-timeout is still enforced mid-game even with the original host disconnected (fallback leader\u2019s tick() drives it)');

  H.destroy(); Ic.destroy();
}

console.log('\n— Room sharing: Share Room button builds a correct invite, and its link pre-fills the join screen —');
{
  const idJ = { uid: 'uidJ', name: 'Jasmine' };
  const jDiv = document.createElement('div'); jDiv.id = 'J'; document.body.appendChild(jDiv);
  const J = createOnline({ mount: jDiv, config: {}, data: gen2Data, params: mkParams(idJ), onExit: () => {} });
  await settle();
  click(findBtn('J', 'Create a room'));
  await settle();
  click(findBtn('J', 'Create room'));
  await settle();
  const codeShown = document.getElementById('J').querySelector('.online-code')?.textContent;
  ok(!!codeShown && codeShown.length === 6, 'room code is shown in the lobby');

  click(findBtn('J', 'Share Room'));
  await settle();
  const toastText = document.getElementById('J').querySelector('.draft-toast')?.textContent || '';
  ok(toastText.includes('Join my PokeGuess Online game'), 'invite text opens with a clear "join my game" line');
  ok(toastText.includes('Gen II'), 'invite text includes the generation');
  ok(/Reveal, then Guess|Guess, then Reveal/.test(toastText), 'invite text includes the RTG/GTR mode in plain language');
  ok(toastText.includes(`#/online/2?code=${codeShown}`), `invite text\u2019s link encodes the room\u2019s actual code (got: ${toastText.match(/#\/online\/2\?code=\w+/)})`);

  // A second player opens that exact link (simulated via the query param a
  // real link would produce) and should land straight on the pre-filled join
  // screen, never seeing the bare entry screen first.
  const idK = { uid: 'uidK', name: 'Karen' };
  const kDiv = document.createElement('div'); kDiv.id = 'K'; document.body.appendChild(kDiv);
  const K = createOnline({ mount: kDiv, config: {}, data: gen2Data, params: mkParams(idK, { code: codeShown.toLowerCase() }), onExit: () => {} });
  await settle();
  const joinInput = document.getElementById('K').querySelector('input');
  ok(!!joinInput, 'K lands directly on the join screen (not the entry screen) because a code was supplied');
  ok(joinInput.value === codeShown, `K\u2019s room-code field is pre-filled with the correct code (got: "${joinInput.value}")`);
  click(findBtn('K', 'Join'));
  await settle();
  const roomAfter = await db.get(`/rooms/${codeShown}`);
  ok(roomAfter && roomAfter.players && roomAfter.players.uidK, 'K successfully joined using only the pre-filled code \u2014 no typing needed');

  J.destroy(); K.destroy();
}

console.log('\n— Requested: "Reveal Full Stat Spread" shows labeled stats (HP/Atk/Def/...), not a bare number string —');
{
  const idL = { uid: 'uidL', name: 'Lyra' };
  const idM = { uid: 'uidM', name: 'Silver' };
  const lDiv = document.createElement('div'); lDiv.id = 'L'; document.body.appendChild(lDiv);
  const mDiv = document.createElement('div'); mDiv.id = 'M'; document.body.appendChild(mDiv);
  const L = createOnline({ mount: lDiv, config: {}, data: gen2Data, params: mkParams(idL), onExit: () => {} });
  const M = createOnline({ mount: mDiv, config: {}, data: gen2Data, params: mkParams(idM), onExit: () => {} });
  await settle();
  const codesBeforeL = Object.keys((await db.get('/rooms')) || {});
  click(findBtn('L', 'Create a room')); await settle();
  click(findBtn('L', 'Create room')); await settle();
  const code3 = Object.keys(await db.get('/rooms')).find((k) => !codesBeforeL.includes(k));
  click(findBtn('M', 'Join with a code')); await settle();
  const codeInput3 = [...q('M', 'input')][0];
  codeInput3.value = code3; codeInput3.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(findBtn('M', 'Join')); await settle();
  click(findBtn('L', 'Start game')); await settle();
  const s3 = await db.get(`/rooms/${code3}`);
  const activeId3 = s3.turnOrder[s3.currentTurnPos];
  const activeMount3 = activeId3 === 'uidL' ? 'L' : 'M';
  const spreadCard = [...document.getElementById(activeMount3).querySelectorAll('.online-clue')].find((c) => c.textContent.includes('Reveal Full Stat Spread'));
  ok(!!spreadCard, 'the Full Stat Spread clue card is present in an online room too');
  if (spreadCard) {
    click(spreadCard);
    await settle();
    const grid = document.getElementById(activeMount3).querySelector('.stat-spread-grid');
    ok(!!grid, 'revealing it renders a .stat-spread-grid, not a bare string');
    const labels = [...(grid ? grid.querySelectorAll('.sname') : [])].map((e) => e.textContent);
    ok(labels.includes('HP') && labels.includes('Atk') && labels.includes('SpA'), `stat abbreviations are shown above the values (got: ${labels.join(',')})`);
  }
  L.destroy(); M.destroy();
}

console.log('\n— Requested: online rejects a guess that isn\u2019t a real Pok\u00e9mon name (bug report) —');
{
  const idN = { uid: 'uidN', name: 'Nurse Joy' };
  const idO = { uid: 'uidO', name: 'Officer Jenny' };
  const nDiv = document.createElement('div'); nDiv.id = 'N'; document.body.appendChild(nDiv);
  const oDiv = document.createElement('div'); oDiv.id = 'O'; document.body.appendChild(oDiv);
  const N = createOnline({ mount: nDiv, config: {}, data: gen2Data, params: mkParams(idN), onExit: () => {} });
  const O = createOnline({ mount: oDiv, config: {}, data: gen2Data, params: mkParams(idO), onExit: () => {} });
  await settle();
  click(findBtn('N', 'Create a room')); await settle();
  click(findBtn('N', 'Create room')); await settle();
  const codeInv = Object.keys(await db.get('/rooms')).find((k) => !['J', 'K'].includes(k));
  const codeInvActual = document.getElementById('N').querySelector('.online-code')?.textContent;
  click(findBtn('O', 'Join with a code')); await settle();
  const codeInputInv = document.getElementById('O').querySelector('input');
  codeInputInv.value = codeInvActual; codeInputInv.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(findBtn('O', 'Join')); await settle();
  click(findBtn('N', 'Start game')); await settle();
  let sInv = await db.get(`/rooms/${codeInvActual}`);
  const activeMountInv = sInv.turnOrder[sInv.currentTurnPos] === 'uidN' ? 'N' : 'O';
  const otherMountInv = activeMountInv === 'N' ? 'O' : 'N';

  // Reveal a clue first so RTG advances to the guess phase.
  const clueInv = [...document.getElementById(activeMountInv).querySelectorAll('.online-clue.available')][0];
  ok(!!clueInv, 'the active player sees an available clue to reveal first');
  click(clueInv); await settle();
  sInv = await db.get(`/rooms/${codeInvActual}`);
  ok(sInv.phase === 'guess', 'advanced to the guess phase');
  const poolBeforeInv = sInv.pool;

  const guessInputInv = document.getElementById(activeMountInv).querySelector('#online-typing');
  ok(!!guessInputInv, 'the active player has a guess input');
  guessInputInv.value = 'Not A Real Pokemon At All';
  click([...document.getElementById(activeMountInv).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Guess'));
  await settle();
  const fbInv = document.getElementById(activeMountInv).querySelector('#online-guess-feedback');
  ok(!!fbInv && fbInv.className.includes('error'), 'an invalid guess is flagged as an error, not silently accepted');
  const sAfterInv = await db.get(`/rooms/${codeInvActual}`);
  ok(sAfterInv.turnOrder[sAfterInv.currentTurnPos] === sInv.turnOrder[sInv.currentTurnPos], 'the invalid guess does NOT advance the turn (unlike a real wrong guess, which would)');
  ok(sAfterInv.pool === poolBeforeInv, 'the invalid guess does NOT deduct from the shared pool');
  ok(!(sAfterInv.guessLog && sAfterInv.guessLog.length), 'the invalid guess is never written to the room\u2019s guess log at all');
  N.destroy(); O.destroy();
}

A.destroy(); B.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
