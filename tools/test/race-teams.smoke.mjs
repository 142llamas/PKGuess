// Cycling Road v2 smoke test (#1): predetermined synced clue order,
// independent per-player advancement + toasts, room cap, time cap, splits
// summary, rematch flow (success + "not enough players" failure).
//
// Each simulated player gets its OWN JSDOM window/document (a shared document
// caused a confirmed jsdom quirk: duplicate ids across two "players" made
// querySelector('#id') unreliable even though the nodes were structurally
// present — never happens for real users, who are always on separate
// browsers, but matters for test fidelity here). A single virtual clock
// (Date.now/setTimeout/setInterval) is shared across all of them, since in
// reality every player's local timers tick against the same wall clock.
// Run: node tools/test/race.smoke.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- virtual clock: Date.now / setTimeout / setInterval all route through it
function makeVirtualClock(startMs) {
  let now = startMs;
  const timers = [];
  let nextId = 1;
  function schedule(type, cb, delay) { const id = nextId++; timers.push({ id, type, delay: delay || 0, next: now + (delay || 0), cb }); return id; }
  function clearT(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
  function advance(ms) {
    const target = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      const due = timers.filter((t) => t.next <= target).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      now = due.next;
      if (due.type === 'interval') due.next += due.delay; else clearT(due.id);
      try { due.cb(); } catch (e) { console.log('  timer callback threw:', e.message); }
    }
    now = target;
  }
  return { now: () => now, setTimeout: (cb, d) => schedule('timeout', cb, d), setInterval: (cb, d) => schedule('interval', cb, d), clearTimeout: clearT, clearInterval: clearT, advance };
}
const clock = makeVirtualClock(1_700_000_000_000);
global.Date = class extends Date { static now() { return clock.now(); } };
global.setTimeout = clock.setTimeout; global.clearTimeout = clock.clearTimeout;
global.setInterval = clock.setInterval; global.clearInterval = clock.clearInterval;
global.confirm = () => true;
global.alert = () => {};
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });

const P = (r) => fileURLToPath(new URL(r, import.meta.url));
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));
global.fetch = async (u) => { const f = String(u).split('/').pop(); try { return { ok: true, json: async () => JSON.parse(readFileSync(P('../../docs/data/' + f), 'utf8')) }; } catch { return { ok: false, json: async () => ({}) }; } };
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// ---- fake Firebase (shared across all clients — this is correct; it's the same "server") -----
function makeFakeFB() {
  const tree = {};
  const listeners = [];
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  function snap(path) { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return clone(n); }
  function setDeep(path, val) { const ks = parts(path); let n = tree; for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) n[ks[i]] = {}; n = n[ks[i]]; } n[ks[ks.length - 1]] = clone(val); }
  let notifying = false;
  function notify() { if (notifying) return; notifying = true; try { for (const l of listeners) l.cb(snap(l.path)); } finally { notifying = false; } }
  return {
    async set(p, v) { setDeep(p, v); notify(); return true; },
    async update(p, o) { const cur = snap(p) || {}; setDeep(p, { ...cur, ...o }); notify(); return true; },
    async get(p) { return snap(p); },
    onValue(p, cb) { const l = { path: p, cb }; listeners.push(l); cb(snap(p)); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
    onDisconnectSet() {},
    auth: {},
  };
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function buildOrder(seed, n) { const r = mulberry32((seed >>> 0) || 0x9e3779b9); const idx = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx; }

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

const fb = makeFakeFB();

// ---- per-client window isolation ---------------------------------------------
// Each client's window is set as the STICKY global (window/document/...) —
// not swapped-and-restored — because race.js's own async continuations
// (after `await fb.update(...)` etc.) resume on a later microtask, outside
// any synchronous wrapper my test could apply around the triggering click.
// As long as clients are driven strictly sequentially (always fully ticked
// between actions on different clients — which every scenario below does),
// "whichever window I last set" IS the correct one when a continuation
// resumes. The one place that's NOT automatically true is the fake
// Firebase's notify(): a write can synchronously invoke a DIFFERENT client's
// onValue callback within the SAME call stack, so onValue callbacks are
// wrapped with a proper (synchronous, nestable) swap-and-restore of their
// own — render() itself has no internal awaits, so that swap is safe.
function setActiveWindow(win) {
  global.window = win; global.document = win.document;
  global.Node = win.Node; global.HTMLElement = win.HTMLElement; global.MouseEvent = win.MouseEvent;
}
function withWindowSync(win, fn) {
  const saved = { window: global.window, document: global.document, Node: global.Node, HTMLElement: global.HTMLElement, MouseEvent: global.MouseEvent };
  setActiveWindow(win);
  try { return fn(); } finally { Object.assign(global, saved); }
}
// A per-client Firebase handle whose onValue wraps the stored callback so it
// always runs under THIS client's window, regardless of who triggered it.
function makeClientScopedFb(sharedFb, win) {
  return {
    set: sharedFb.set, update: sharedFb.update, get: sharedFb.get, onDisconnectSet: sharedFb.onDisconnectSet, auth: sharedFb.auth,
    onValue(path, cb) { return sharedFb.onValue(path, (snap) => withWindowSync(win, () => cb(snap))); },
  };
}

async function mkClient(uid, name) {
  const dom = new JSDOM('<!doctype html><body></body></html>', { url: 'https://e.com/' });
  const win = dom.window;
  setActiveWindow(win);
  const mount = win.document.createElement('div'); win.document.body.appendChild(mount);
  const { createRace } = await import('../../docs/js/modes/race.js');
  const client = { win, mount, uid, name, exited: false };
  const scopedFb = makeClientScopedFb(fb, win);
  const ctrl = createRace({
    mount, config: {}, data: gen2,
    params: { gen: 2, modeId: 'race', _getFirebase: async () => scopedFb, _getIdentity: async () => ({ uid, name }) },
    onExit: () => { client.exited = true; },
  });
  client.ctrl = ctrl;
  // Wait for the async boot (Promise.all + showEntry()) to actually land —
  // the window is still correctly "sticky" here since nothing else runs
  // concurrently during a single client's construction.
  for (let i = 0; i < 40 && !mount.textContent; i++) await Promise.resolve();
  client.use = () => setActiveWindow(win);
  client.click = (n) => { client.use(); return n && n.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  client.fireInput = (n) => { client.use(); return n && n.dispatchEvent(new win.Event('input', { bubbles: true })); };
  client.btn = (text) => { client.use(); return [...mount.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text)); };
  client.q = (sel) => { client.use(); return mount.querySelector(sel); };
  client.text = () => mount.textContent || '';
  client.destroy = () => { client.use(); return ctrl.destroy(); };
  return client;
}

console.log('— Team Mode: room creation with team toggle + team-builder lobby (#3b) —');
let code;
const A = await mkClient('uidA', 'Ash');
const B = await mkClient('uidB', 'Brock');
const C = await mkClient('uidC', 'Cathy');
const D = await mkClient('uidD', 'Dawn');
await tick();

A.click(A.btn('Create a room')); await tick();
const teamBtn = A.btn('Team Mode: Off');
ok(!!teamBtn, 'a Team Mode toggle exists on the create-room form');
A.click(teamBtn); await tick();
ok(A.text().includes('Team Mode: On'), 'toggling shows Team Mode is now on');
const tinput = A.q('input[type=number]'); tinput.value = '2'; tinput.dispatchEvent(new A.win.Event('input', { bubbles: true }));
A.click(A.btn('Create room')); await tick();
const rooms = await fb.get('/rooms');
code = Object.keys(rooms)[0];
ok(!!code, 'room created');
ok(rooms[code].settings.teams === true, 'room settings recorded teams:true');
ok(Array.isArray(rooms[code].teamState) && rooms[code].teamState.length === 2, 'teamState initialized with 2 teams');

for (const client of [B, C, D]) {
  client.click(client.btn('Join with a code')); await tick();
  const i = client.q('input'); i.value = code; client.click(client.btn('Join')); await tick();
}
let room = await fb.get('/rooms/' + code);
eq(Object.keys(room.players).length, 4, 'all 4 players joined');

console.log('— Team-builder: manual assignment + randomize (#3b) —');
{
  ok(A.text().includes('Unassigned (4)'), 'all 4 players start unassigned');
  const startBtn = A.btn('Start');
  ok(!startBtn || startBtn.disabled, 'Start is disabled while anyone is unassigned');

  // manually assign A and B to Team Red, C and D to Team Blue
  const assignTo = (client, targetLabel) => {
    const row = [...client.mount.querySelectorAll('.online-player')].find((r) => r.textContent.includes(client.name));
    const btn = row && [...row.querySelectorAll('button')].find((b) => b.textContent.includes(targetLabel));
    client.click(btn);
  };
  assignTo(A, 'Team Red'); 
  A.use(); await tick();
  assignTo(A, 'Team Red'); // no-op safety; real assign uses B's own row below
  // Assign via A (host) since only host sees move buttons
  const clickAssign = async (name, label) => {
    A.use();
    const row = [...A.mount.querySelectorAll('.online-player')].find((r) => r.textContent.includes(name));
    const btn = row && [...row.querySelectorAll('button')].find((b) => b.textContent.includes(label));
    ok(!!btn, `host sees a "${label}" button for ${name}`);
    A.click(btn); await tick();
  };
  await clickAssign('Brock', 'Team Red');
  await clickAssign('Cathy', 'Team Blue');
  await clickAssign('Dawn', 'Team Blue');
  room = await fb.get('/rooms/' + code);
  eq(room.players.uidA.team, 0, 'Ash assigned to Team Red (0)');
  eq(room.players.uidB.team, 0, 'Brock assigned to Team Red (0)');
  eq(room.players.uidC.team, 1, 'Cathy assigned to Team Blue (1)');
  eq(room.players.uidD.team, 1, 'Dawn assigned to Team Blue (1)');

  const startBtn2 = A.btn('Start');
  ok(!!startBtn2 && !startBtn2.disabled, 'Start is enabled once everyone is on a team');
}

console.log('— Randomize Teams button produces an even split —');
{
  A.click(A.btn('Randomize Teams')); await tick();
  room = await fb.get('/rooms/' + code);
  const teamsArr = ['uidA', 'uidB', 'uidC', 'uidD'].map((u) => room.players[u].team);
  ok(teamsArr.every((t) => t === 0 || t === 1), 'every player has a valid team after randomizing');
  const count0 = teamsArr.filter((t) => t === 0).length;
  eq(count0, 2, 'randomizing 4 players gives an even 2/2 split');
  // Re-assign deterministically back to Red={A,B} Blue={C,D} for the rest of the test
  const clickAssign = async (name, label) => {
    A.use();
    const row = [...A.mount.querySelectorAll('.online-player')].find((r) => r.textContent.includes(name));
    const btn = row && [...row.querySelectorAll('button')].find((b) => b.textContent.includes(label));
    if (btn) { A.click(btn); await tick(); }
  };
  await clickAssign('Ash', 'Team Red');
  await clickAssign('Brock', 'Team Red');
  await clickAssign('Cathy', 'Team Blue');
  await clickAssign('Dawn', 'Team Blue');
  room = await fb.get('/rooms/' + code);
  eq(room.players.uidA.team, 0, 're-fixed: Ash on Red');
  eq(room.players.uidB.team, 0, 're-fixed: Brock on Red');
  eq(room.players.uidC.team, 1, 're-fixed: Cathy on Blue');
  eq(room.players.uidD.team, 1, 're-fixed: Dawn on Blue');
}

console.log('— Starting the game sets memberOrder per team, in join order —');
A.click(A.btn('Start')); await tick();
room = await fb.get('/rooms/' + code);
eq(room.status, 'playing', 'team game started');
eq(JSON.stringify(room.teamState[0].memberOrder), JSON.stringify(['uidA', 'uidB']), 'Team Red memberOrder = join order within the team');
eq(JSON.stringify(room.teamState[1].memberOrder), JSON.stringify(['uidC', 'uidD']), 'Team Blue memberOrder = join order within the team');

const order = buildOrder(room.seed, gen2.pokedex.length);
const mystery0 = gen2.pokedex[order[0]];

console.log('— Only the designated answerer can guess; teammate sees a waiting message (#3a) —');
{
  ok(!!A.q('#race-guess'), 'Ash (first in Team Red\u2019s order) sees a guess input');
  ok(!B.q('#race-guess'), 'Brock (teammate, not up) does NOT see a guess input');
  ok(B.text().includes('Ash is answering'), `Brock sees a "waiting for teammate" message (text: ${B.text().slice(0, 200)})`);
  // Everyone on the team sees the SAME clue feed regardless of who's up.
  const aClues = A.q('#race-revealed')?.textContent;
  const bClues = B.q('#race-revealed')?.textContent;
  eq(aClues, bClues, 'teammates see the identical revealed-clue feed even though only one can answer');
}

console.log('— Correct guess advances the TEAM and rotates the answerer to the next member (#3a) —');
{
  const input = A.q('#race-guess');
  input.value = mystery0.name;
  A.click(A.btn('Guess'));
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.teamState[0].solved, 1, 'Team Red advanced to 1 solved');
  eq(room.teamState[0].answererIdx, 1, 'the answerer index rotated forward');
  ok(!!B.q('#race-guess'), 'Brock (now up per the rotation) sees the guess input');
  ok(!A.q('#race-guess'), 'Ash (no longer up) no longer sees the guess input');
}

console.log('— "Team X advanced to round N" toast goes to the OTHER team, not your own (#1c/#3) —');
{
  const blueToast = C.q('#race-toasts')?.textContent || '';
  ok(blueToast.includes('Team Red') && blueToast.includes('round 2'), `Team Blue sees a toast about Team Red\u2019s advance (got: "${blueToast}")`);
  const redToast = A.q('#race-toasts')?.textContent || '';
  eq(redToast, '', 'Team Red does NOT get toasted about its own advancement');
}

console.log('— Team Blue solves its mystery too; game ends once BOTH teams finish (#1d.i for teams) —');
{
  const cInput = C.q('#race-guess');
  ok(!!cInput, 'Cathy (first in Team Blue\u2019s order) can answer');
  cInput.value = mystery0.name;
  C.click(C.btn('Guess'));
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.teamState[1].solved, 1, 'Team Blue advanced to 1 solved');
  // Both teams now need their 2nd mystery to finish (target=2).
  const order2Idx = 1;
  const mystery1 = gen2.pokedex[order[order2Idx % order.length]];
  const bInput = B.q('#race-guess'); // Brock is up for Red now
  bInput.value = mystery1.name;
  B.click(B.btn('Guess'));
  await tick();
  const dInput = D.q('#race-guess'); // Dawn is up for Blue now
  dInput.value = mystery1.name;
  D.click(D.btn('Guess'));
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.teamState[0].solved, 2, 'Team Red finished (2/2)');
  eq(room.teamState[1].solved, 2, 'Team Blue finished (2/2)');
  clock.advance(1100);
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.status, 'gameOver', 'game ends once BOTH teams have finished');
}

console.log('— Results show TEAM totals + splits (#1e for teams) —');
{
  const table = A.q('.race-splits-table');
  ok(!!table, 'a team splits table renders');
  ok(A.text().includes('Team Red') && A.text().includes('Team Blue'), 'both teams appear in the results');
}

console.log('— Team Mode rematch requires ALL players opted in, not just 2 (#3b.i) —');
{
  A.click(A.btn('rematch')); await tick();
  B.click(B.btn('rematch')); await tick();
  C.click(C.btn('rematch')); await tick();
  // D deliberately does NOT opt in yet
  const findRematchBtn = (client) => [...client.mount.querySelectorAll('.btn-primary')].find((b) => b.textContent.includes('Start rematch') || b.textContent.includes('Waiting for everyone'));
  const startBtn = findRematchBtn(A);
  ok(!!startBtn, 'host sees the Start-rematch control');
  ok(startBtn.disabled, 'but it is disabled — Dawn has not opted in yet (ALL must, not just 2)');
  ok(A.text().includes('3/4 want a rematch'), `shows the ALL-must-opt-in count (text has: ${A.text().match(/\d\/\d want a rematch/)})`);

  D.click(D.btn('rematch')); await tick();
  const startBtn2 = findRematchBtn(A);
  ok(!!startBtn2 && !startBtn2.disabled, 'once ALL 4 have opted in, Start-rematch becomes enabled');
  A.click(startBtn2); await tick();
  room = await fb.get('/rooms/' + code);
  ok(!!room.rematchCountdownEndsAt, 'countdown started');
  clock.advance(5200);
  await tick(6);
  room = await fb.get('/rooms/' + code);
  eq(room.status, 'playing', 'rematch auto-started after the countdown');
  eq(room.teamState[0].solved, 0, 'Team Red reset to 0 solved');
  eq(room.players.uidA.team, 0, 'team assignments are preserved across a rematch');
}

A.destroy(); B.destroy(); C.destroy(); D.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
