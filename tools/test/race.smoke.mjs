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
  // #16 — real Firebase RTDB throws synchronously if any value written via
  // set()/update() contains `undefined` (at any depth). The old fake used
  // JSON.stringify, which SILENTLY DROPS undefined keys — which is exactly why
  // the individual-room `team: undefined` bug passed the smoke undetected.
  // Mirror the real SDK so that class of bug fails loudly here.
  const assertNoUndefined = (v, path) => {
    if (v === undefined) throw new Error(`set failed: value argument contains undefined in property '${path}'`);
    if (v && typeof v === 'object') for (const k of Object.keys(v)) assertNoUndefined(v[k], `${path}/${k}`);
  };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = (p) => p.split('/').filter(Boolean);
  function snap(path) { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return clone(n); }
  function setDeep(path, val) { const ks = parts(path); let n = tree; for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) n[ks[i]] = {}; n = n[ks[i]]; } n[ks[ks.length - 1]] = clone(val); }
  let notifying = false, pendingNotify = false;
  function notify() {
    if (notifying) { pendingNotify = true; return; }
    notifying = true;
    try {
      do { pendingNotify = false; for (const l of listeners) l.cb(snap(l.path)); } while (pendingNotify);
    } finally { notifying = false; }
  }
  return {
    async set(p, v) { assertNoUndefined(v, p); setDeep(p, v); notify(); return true; },
    async update(p, o) { assertNoUndefined(o, p); const cur = snap(p) || {}; setDeep(p, { ...cur, ...o }); notify(); return true; },
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
  global.window = win; global.document = win.document; global.location = win.location;
  global.Node = win.Node; global.HTMLElement = win.HTMLElement; global.MouseEvent = win.MouseEvent;
}
function withWindowSync(win, fn) {
  const saved = { window: global.window, document: global.document, location: global.location, Node: global.Node, HTMLElement: global.HTMLElement, MouseEvent: global.MouseEvent };
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

async function mkClient(uid, name, query) {
  const dom = new JSDOM('<!doctype html><body></body></html>', { url: 'https://e.com/' });
  const win = dom.window;
  setActiveWindow(win);
  const mount = win.document.createElement('div'); win.document.body.appendChild(mount);
  const { createRace } = await import('../../docs/js/modes/race.js');
  const client = { win, mount, uid, name, exited: false };
  const scopedFb = makeClientScopedFb(fb, win);
  const ctrl = createRace({
    mount, config: {}, data: gen2,
    params: { gen: 2, modeId: 'race', _getFirebase: async () => scopedFb, _getIdentity: async () => ({ uid, name }), query: query || {} },
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

console.log('— Room creation, join, room-cap (#1d) —');
let code;
{
  const A = await mkClient('uidA', 'Ash');
  await tick();
  A.click(A.btn('Create a room')); await tick();
  const tinput = A.q('input[type=number]'); tinput.value = '3'; A.fireInput(tinput);
  A.click(A.btn('Create room')); await tick();
  const roomsRoot = await fb.get('/rooms');
  code = Object.keys(roomsRoot)[0];
  ok(!!code, 'room created with a code');
  const room0 = await fb.get('/rooms/' + code);
  eq(room0.settings.target, 3, 'custom target of 3 was applied');
  // #16 — individual (non-team) create must succeed WITHOUT writing `team:undefined`
  // (real RTDB throws on undefined; the hardened fake FB above now does too).
  ok(room0.settings.teams === false, 'individual mode: teams=false');
  ok(!('team' in room0.players.uidA), '#16: individual-mode player has no `team` key (no undefined written)');
  ok(room0.status === 'lobby', '#16: individual room created and sits in lobby');
  A.destroy();
}

console.log('— Two players join; predetermined clue order is IDENTICAL for both (#1a) —');
const A = await mkClient('uidA', 'Ash');
const B = await mkClient('uidB', 'Brock');
await tick();
A.click(A.btn('Join with a code')); await tick();
{ const i = A.q('input'); i.value = code; A.click(A.btn('Join')); await tick(); }
B.click(B.btn('Join with a code')); await tick();
{ const i = B.q('input'); i.value = code; B.click(B.btn('Join')); await tick(); }
let room = await fb.get('/rooms/' + code);
ok(Object.keys(room.players).length === 2, 'two players joined');

A.click(A.btn('Start')); await tick();
room = await fb.get('/rooms/' + code);
eq(room.status, 'playing', 'race started');

const order = buildOrder(room.seed, gen2.pokedex.length);
const mystery0 = gen2.pokedex[order[0]];
ok(A.text().includes('1 / 3') || A.text().includes('Pok\u00e9mon 1'), 'A is on mystery #1');
ok(B.text().includes('1 / 3') || B.text().includes('Pok\u00e9mon 1'), 'B is on mystery #1');
const firstCluesMatch = A.q('#race-revealed')?.textContent === B.q('#race-revealed')?.textContent;
ok(firstCluesMatch, `A and B see the IDENTICAL first clue for the same mystery (#1a) [A="${A.q('#race-revealed')?.textContent}" B="${B.q('#race-revealed')?.textContent}"]`);

console.log('— First clue appears immediately; a 2nd appears after 5s, not before (#1b) —');
{
  const before = A.q('#race-revealed').textContent;
  ok(before.length > 0 && !before.includes('loading'), 'first clue is visible immediately on mystery presentation');
  clock.advance(4000);
  const at4s = A.q('#race-revealed').textContent;
  eq(at4s, before, 'no NEW clue yet at 4s (still just the first)');
  clock.advance(1500);
  const at5_5s = A.q('#race-revealed').textContent;
  ok(at5_5s !== before, 'a second clue appeared once 5s elapsed');
}

console.log('— Independent advancement + "advanced to round N" toast (#1c) —');
{
  const aInput = A.q('#race-guess');
  aInput.value = mystery0.name;
  A.click(A.btn('Guess'));
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.players.uidA.solved, 1, 'A solved mystery #1 and advanced');
  eq(room.players.uidB.solved, 0, 'B has NOT advanced — independent pacing (#1c)');
  ok(A.text().includes('2 / 3') || A.text().includes('Pok\u00e9mon 2'), 'A is now on mystery #2');
  ok(B.text().includes('1 / 3') || B.text().includes('Pok\u00e9mon 1'), 'B is STILL on mystery #1');
  const toastText = B.q('#race-toasts')?.textContent || '';
  ok(toastText.includes('Ash') && toastText.includes('round 2'), `B sees a toast about A's advancement (got: "${toastText}")`);
  const aToast = A.q('#race-toasts')?.textContent || '';
  eq(aToast, '', 'A does NOT see a toast about their OWN advancement');
}

console.log('— B finishes too; game auto-ends once ALL active players finish (#1d.i) —');
{
  // A still has 2 more mysteries left (solved #1 earlier); finish those first.
  for (let m = 0; m < 4; m++) {
    room = await fb.get('/rooms/' + code);
    if ((room.players.uidA.solved || 0) >= 3) break;
    const idx = room.players.uidA.solved || 0;
    const poke = gen2.pokedex[order[idx % order.length]];
    const aInput2 = A.q('#race-guess');
    if (!aInput2) break;
    aInput2.value = poke.name;
    A.click(A.btn('Guess'));
    await tick();
  }
  for (let m = 0; m < 4; m++) {
    room = await fb.get('/rooms/' + code);
    if ((room.players.uidB.solved || 0) >= 3) break;
    const idx = room.players.uidB.solved || 0;
    const poke = gen2.pokedex[order[idx % order.length]];
    const bInput = B.q('#race-guess');
    if (!bInput) break;
    bInput.value = poke.name;
    B.click(B.btn('Guess'));
    await tick();
  }
  room = await fb.get('/rooms/' + code);
  eq(room.players.uidB.solved, 3, 'B eventually finished all 3');
  eq(room.players.uidA.solved, 3, 'A already finished all 3');
  clock.advance(1100);
  await tick();
  room = await fb.get('/rooms/' + code);
  eq(room.status, 'gameOver', 'room auto-transitions to gameOver once everyone active has finished');
}

console.log('— Results: ranked by total time, splits table renders (#1e) —');
{
  const table = A.q('.race-splits-table');
  ok(!!table, 'a splits table is rendered');
  ok(A.text().includes('Ash') && A.text().includes('Brock'), 'both players appear in the results');
  ok(!!A.q('.race-split-best'), 'at least one fastest-split cell is highlighted');
}

console.log('— Bug report: the GUEST (non-host) opting in alone must update the counter on BOTH screens —');
{
  // Reproduces the exact reported scenario: on Cycling Road, the mobile GUEST
  // tapped "Want a rematch?" but the "N players want a rematch" counter didn't
  // move and the host couldn't start — i.e. the guest's opt-in wasn't being
  // reflected. Online MP did NOT have this problem, so this specifically
  // exercises the guest-first path on Cycling Road.
  ok(A.text().includes('0 players want a rematch') || A.text().includes('players want a rematch'), 'precondition: nobody has opted in yet');
  B.click(B.btn('rematch')); await tick();
  room = await fb.get('/rooms/' + code);
  ok(room.players.uidB.rematch === true, 'the guest\u2019s opt-in is written to the database');
  ok(!room.players.uidA.rematch, 'the host has NOT opted in yet (guest opted in alone)');
  // The guest's own screen must reflect their opt-in...
  ok(B.text().includes('1 player wants a rematch'), `guest\u2019s own screen shows the count went to 1 (text: ${B.text().match(/\d+ players? wants? a rematch/)})`);
  // ...and, crucially, the HOST's screen must show it too (this is the part
  // the bug report says was broken — the host never saw the guest's opt-in).
  ok(A.text().includes('1 player wants a rematch'), `HOST\u2019s screen also shows the guest\u2019s opt-in (count = 1) (text: ${A.text().match(/\d+ players? wants? a rematch/)})`);
  // The host can't start yet (host themselves hasn't opted in), but the guest
  // being counted is the thing under test. Now the host opts in too:
  A.click(A.btn('rematch')); await tick();
  const startBtn = A.btn('Start rematch');
  ok(!!startBtn && !startBtn.disabled, 'once BOTH have opted in, the host\u2019s Start-rematch button enables');
  // reset for the next test block (which opts in fresh). The button now reads
  // "Rematch selected" (capital R) when active, so match that to toggle off.
  A.click(A.btn('Rematch selected')); await tick();
  B.click(B.btn('Rematch selected')); await tick();
  room = await fb.get('/rooms/' + code);
  ok(!room.players.uidA.rematch && !room.players.uidB.rematch, 'both opt-ins cleared for the next test block');
}

console.log('— Persistent post-game lobby + rematch (#1f): both opt in, host starts, countdown resolves —');
{
  A.click(A.btn('rematch')); await tick();
  B.click(B.btn('rematch')); await tick();
  room = await fb.get('/rooms/' + code);
  ok(room.players.uidA.rematch && room.players.uidB.rematch, 'both players are marked rematch:true');
  // #18 — check what's actually DISPLAYED on each client's own screen, not
  // just the underlying database state (which the DB-only check above cannot
  // distinguish from a display bug on either client).
  ok(A.text().includes('2 players want a rematch'), `#18: HOST\u2019s (Ash) own screen shows BOTH opt-ins, not just their own (text: ${A.text().match(/\d+ players? want a rematch/)})`);
  ok(B.text().includes('2 players want a rematch'), `#18: GUEST\u2019s (Brock) own screen shows BOTH opt-ins (text: ${B.text().match(/\d+ players? want a rematch/)})`);
  const startBtn = A.btn('Start rematch');
  ok(!!startBtn && !startBtn.disabled, '#18: host\u2019s Start-rematch button is enabled once the guest has ALSO opted in');
  A.click(A.btn('Start rematch')); await tick();
  room = await fb.get('/rooms/' + code);
  ok(!!room.rematchCountdownEndsAt, 'host starting the rematch sets a countdown deadline');
  clock.advance(5200);
  await tick(6);
  room = await fb.get('/rooms/' + code);
  eq(room.status, 'playing', 'after the 5s countdown, a NEW game started automatically');
  eq(room.players.uidA.solved, 0, 'the rematch resets solved counts');
  ok(room.seed !== undefined, 'a fresh seed was generated for the rematch');
}

console.log('— Early exit mid-game marks the player "left" and un-blocks the completion gate (#1d.ii) —');
{
  const C = await mkClient('uidC', 'Cathy');
  const D = await mkClient('uidD', 'Dawn');
  await tick();
  C.click(C.btn('Create a room')); await tick();
  const tinput2 = C.q('input[type=number]'); tinput2.value = '2'; C.fireInput(tinput2);
  C.click(C.btn('Create room')); await tick();
  const rooms2 = await fb.get('/rooms');
  const code2 = Object.keys(rooms2).find((k) => k !== code);
  D.click(D.btn('Join with a code')); await tick();
  { const i = D.q('input'); i.value = code2; D.click(D.btn('Join')); await tick(); }
  C.click(C.btn('Start')); await tick();
  let r2 = await fb.get('/rooms/' + code2);
  ok(r2.status === 'playing', 'second room started');
  const order2 = buildOrder(r2.seed, gen2.pokedex.length);
  D.click(D.btn('Quit')); await tick();
  r2 = await fb.get('/rooms/' + code2);
  ok(r2.players.uidD.left === true, 'D is marked left:true after confirming Quit');
  for (let m = 0; m < 3; m++) {
    r2 = await fb.get('/rooms/' + code2);
    const idx = r2.players.uidC.solved || 0;
    if (idx >= 2) break;
    const poke = gen2.pokedex[order2[idx % order2.length]];
    const cInput = C.q('#race-guess');
    cInput.value = poke.name;
    C.click(C.btn('Guess'));
    await tick();
  }
  clock.advance(1100);
  await tick();
  r2 = await fb.get('/rooms/' + code2);
  eq(r2.status, 'gameOver', 'game ends once the only ACTIVE player (C) finishes — D (left) does not block it');
  C.destroy(); D.destroy();
}

console.log('— Rematch with nobody else opted in: host sees an error and returns to the main menu —');
{
  const roomsAll0 = await fb.get('/rooms');
  const usedCodes = Object.keys(roomsAll0);
  const E = await mkClient('uidE', 'Erika');
  await tick();
  E.click(E.btn('Create a room')); await tick();
  E.click(E.btn('Create room')); await tick();
  const roomsAll = await fb.get('/rooms');
  const code3 = Object.keys(roomsAll).find((k) => !usedCodes.includes(k));
  await fb.update(`/rooms/${code3}`, { status: 'gameOver', players: { uidE: { name: 'Erika', connected: true, left: false, solved: 1, splits: [1000], finishedAt: 1, rematch: false } }, joinOrder: ['uidE'] });
  await tick();
  E.destroy();
  const E2 = await mkClient('uidE', 'Erika');
  await tick();
  E2.click(E2.btn('Join with a code')); await tick();
  { const i = E2.q('input'); i.value = code3; E2.click(E2.btn('Join')); await tick(); }
  E2.click(E2.btn('rematch')); await tick();
  const startBtn = E2.btn('Start rematch');
  ok(!!startBtn, 'host sees a Start-rematch button (host is opted in)');
  ok(startBtn.disabled, 'but it is DISABLED — no other player has opted in yet');
  await fb.set(`/rooms/${code3}/rematchCountdownEndsAt`, Date.now() + 5000);
  await tick();
  clock.advance(5200);
  await tick(6);
  ok(E2.exited, 'the host is returned to the main menu when nobody else stayed opted in');
  E2.destroy();
}

console.log('\n— Host-disconnect resilience: the room survives the original host leaving, and everyone is told —');
{
  const H = await mkClient('uidH', 'Hilda');
  const I = await mkClient('uidI', 'Iris');
  const codesBefore4 = Object.keys((await fb.get('/rooms')) || {});
  H.click(H.btn('Create a room')); await tick();
  const tinput = H.q('input[type=number]'); tinput.value = '2'; H.fireInput(tinput);
  H.click(H.btn('Create room')); await tick();
  const code4 = Object.keys(await fb.get('/rooms')).find((k) => !codesBefore4.includes(k));
  I.click(I.btn('Join with a code')); await tick();
  const codeInput = I.q('input'); codeInput.value = code4; I.fireInput(codeInput);
  I.click(I.btn('Join')); await tick();

  ok(!I.btn('Start'), 'before any disconnect, only the host (Hilda) can start the game');
  ok(I.mount.textContent.includes('Waiting for the host'), 'I correctly sees "waiting for the host" while H is still connected');

  // The original host (H) disconnects BEFORE the game ever starts.
  await fb.update(`/rooms/${code4}/players/uidH`, { connected: false });
  await tick();

  ok(I.mount.textContent.includes('has disconnected'), 'I is told the host has disconnected');
  ok(I.mount.textContent.includes('you are'), 'the banner tells I that THEY are now in control (I is the only other connected player)');
  const startBtnI = I.btn('Start');
  ok(!!startBtnI, 'I (the new leader) can now start the game \u2014 the room is not permanently stuck');

  I.click(startBtnI); await tick();
  let r4 = await fb.get(`/rooms/${code4}`);
  ok(r4.status === 'playing', 'the game actually started, driven by the fallback leader');

  // Mid-game: let the room-wide time cap elapse with the original host still
  // disconnected, and confirm the leader-driven capTimer duty still enforces
  // it \u2014 the core resilience this was all for.
  clock.advance(2 * 120000 + 1000); // room-wide time cap for target=2
  await tick();
  r4 = await fb.get(`/rooms/${code4}`);
  ok(r4.status === 'gameOver', 'the room-wide time cap is still enforced mid-game with the original host disconnected (fallback leader\u2019s capTimer drives it)');

  H.destroy(); I.destroy();
}

console.log('\n— Room sharing: Share Room button builds a correct invite, and its link pre-fills the join screen —');
{
  const N = await mkClient('uidN', 'Norman');
  N.click(N.btn('Create a room')); await tick();
  N.click(N.btn('Create room')); await tick();
  const codeN = N.q('.online-code-big')?.textContent.replace('Code: ', '');
  ok(!!codeN && codeN.length === 6, 'room code is shown in the lobby');

  N.click(N.btn('Share Room')); await tick();
  const toastText = N.mount.querySelector('.draft-toast')?.textContent || '';
  ok(toastText.includes('Join my Cycling Road game'), 'invite text opens with a clear "join my game" line');
  ok(toastText.includes('5 Pok\u00e9mon'), 'invite text includes the target Pok\u00e9mon count');
  ok(!toastText.includes('Team Mode'), 'individual-mode invite does not mention Team Mode');
  ok(toastText.includes(`#/race/2?code=${codeN}`), `invite text\u2019s link encodes the room\u2019s actual code (got: ${toastText.match(/#\/race\/2\?code=\w+/)})`);

  // A second player opens that link (simulated via the query param a real
  // link would produce) and should land straight on the pre-filled join
  // screen.
  const O = await mkClient('uidO', 'Olivia', { code: codeN.toLowerCase() });
  const joinInput = O.q('input');
  ok(!!joinInput, 'O lands directly on the join screen (not the entry screen) because a code was supplied');
  ok(joinInput.value === codeN, `O\u2019s room-code field is pre-filled with the correct code (got: "${joinInput.value}")`);
  O.click(O.btn('Join')); await tick();
  const roomAfter = await fb.get(`/rooms/${codeN}`);
  ok(roomAfter && roomAfter.players && roomAfter.players.uidO, 'O successfully joined using only the pre-filled code \u2014 no typing needed');

  N.destroy(); O.destroy();
}

A.destroy(); B.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
