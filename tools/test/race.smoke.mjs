// Race mode smoke: two clients on a shared in-memory Firebase play to a finish.
// Run: node tools/test/race.smoke.mjs   (needs jsdom; not part of run.mjs)
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://e.com/' });
const { window } = dom;
global.window = window; global.document = window.document;
for (const k of ['navigator', 'Node', 'HTMLElement', 'MouseEvent']) try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch {}
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });
global.setTimeout = (f) => { try { f(); } catch {} return 0; };

const P = (r) => fileURLToPath(new URL(r, import.meta.url));
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));
global.fetch = async (u) => { const f = String(u).split('/').pop(); try { return { ok: true, json: async () => JSON.parse(readFileSync(P('../../docs/data/' + f), 'utf8')) }; } catch { return { ok: false, json: async () => ({}) }; } };
const tick = () => new Promise((r) => { let i = 0; const t = () => (i++ < 8 ? Promise.resolve().then(t) : r()); t(); });

// ---- shared fake firebase -------------------------------------------------
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

// local copy of the controller's deterministic order (must match race.js)
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function buildOrder(seed, n) { const r = mulberry32((seed >>> 0) || 0x9e3779b9); const idx = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx; }

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const fb = makeFakeFB();
const { createRace } = await import('../../docs/js/modes/race.js');
const mk = (uid, name) => {
  const mount = window.document.createElement('div'); window.document.body.appendChild(mount);
  const ctrl = createRace({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'race', _getFirebase: async () => fb, _getIdentity: async () => ({ uid, name }) }, onExit: () => {} });
  return { mount, ctrl };
};

const A = mk('uidA', 'Ash');
await tick();
const B = mk('uidB', 'Brock');
await tick();

const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const btn = (mount, text) => [...mount.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));

// A creates a room (target 2)
click(btn(A.mount, 'Create a room')); await tick();
// set custom target to 2
const tinput = A.mount.querySelector('input[type=number]'); tinput.value = '2'; tinput.dispatchEvent(new window.window.Event('input', { bubbles: true }));
click(btn(A.mount, 'Create room')); await tick();
const room0 = await fb.get('/rooms/' + Object.keys(await fb.get('/rooms'))[0]);
const code = room0.code;
ok(!!code, 'room created with a code');
ok(room0.game === 'race', 'room tagged game:race');

// B joins
click(btn(B.mount, 'Join with a code')); await tick();
const jin = B.mount.querySelector('input'); jin.value = code; click(btn(B.mount, 'Join')); await tick();
let room = await fb.get('/rooms/' + code);
ok(Object.keys(room.players).length === 2, 'two players in the room');

// host A starts
click(btn(A.mount, 'Start race')); await tick();
room = await fb.get('/rooms/' + code);
ok(room.status === 'playing', 'race started (status playing)');

// both clients should be on the SAME first mystery (deterministic order)
const order = buildOrder(room.seed, gen2.pokedex.length);
const firstName = gen2.pokedex[order[0]].name;
const aMyst = A.mount.querySelector('.race-mystery');
ok(!!aMyst, 'A has a board');
ok(A.mount.querySelector('#race-guess'), 'A has a guess input');

// helper: solve current mystery for a client by typing the correct name
async function solve(client, attemptIdx) {
  const name = gen2.pokedex[order[attemptIdx]].name;
  const input = client.mount.querySelector('#race-guess');
  if (!input) return false;
  input.value = name;
  click(btn(client.mount, 'Guess'));
  await tick();
  return true;
}

// A solves both target mysteries quickly → should win
await solve(A, 0);
await solve(A, 1);
await tick();
room = await fb.get('/rooms/' + code);
ok(room.players.uidA.solved === 2, `A solved 2 (got ${room.players.uidA.solved})`);
ok(room.status === 'gameOver', 'status flips to gameOver when target reached');
ok(room.winnerUid === 'uidA', `winner is A (got ${room.winnerUid})`);

// both clients should render the game-over screen
ok(/You won the race|won!/.test(A.mount.textContent), 'A sees game-over screen');
ok(/won!|You won the race/.test(B.mount.textContent), 'B sees game-over screen');

A.ctrl.destroy(); B.ctrl.destroy();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
