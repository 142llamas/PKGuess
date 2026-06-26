/**
 * @file        docs/js/modes/online.js
 * @version     1.0.0
 * @updated     2026-06-26
 * @changelog
 *   1.0.0 — Online multiplayer (SPEC §8a "Online"). Firebase rooms with a 6-char
 *           code; 2+ players; RTG/GTR; choose or weighted-random reveals; shared
 *           pool; first to the win target wins. Built on lib/mp-rules.js so the
 *           ANSWER IS NEVER TRANSMITTED — every client derives the same mystery
 *           from the room seed (seedFor) and only clue ids, pool, turn and scores are
 *           synced. Decisions: 60s turns; a deterministic "leader" (host, else
 *           lowest connected uid) enforces the turn timer + auto-advances rounds
 *           ~5s after a win; results are VERIFIED — each client re-derives the
 *           mystery and flags any result that doesn't check out.
 *           v1 scope notes: no per-clue exclusion panel and no evolution
 *           auto-deduction yet (hot-seat has both) — planned for parity.
 *
 * Contract: createOnline({ mount, config, data, params, onExit }) → { destroy }
 *   params.gen (1|2) preselects the room generation. Test seams:
 *   params._getFirebase / params._getIdentity inject fakes.
 */

import { el, clear } from '../lib/dom.js';
import {
  seedFor, buildEngine, applyReveals, revealOutcome, guessOutcome,
  nextTurnPos, weightedRandomClue, advanceAfterWin, champion, makeRoomCode,
} from '../lib/mp-rules.js';
import { normalizeName } from '../lib/engine.js';

const COLORS = ['#f5c518', '#4a9eff', '#35c759', '#ff5a5a', '#b06bff', '#ff9f40'];
const GRACE_MS = 2000;          // leader waits this long past the deadline before skipping
const ADVANCE_MS = 5000;        // round-over → next round
const TICK_MS = 1000;
const TURN_MS = 60000;          // 60s per turn (chosen)

export function createOnline({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'mp-content online-root' });
  clear(mount).appendChild(root);

  const getFB = params._getFirebase || (() => import('../lib/firebase.js').then((m) => m.getFirebase()));
  const getID = params._getIdentity || (() => import('../lib/identity.js').then((m) => m.getIdentity()));
  const defaultGen = params.gen === 1 ? 'gen1' : 'gen2';

  let fb = null, me = null;          // firebase helpers, identity {uid,name}
  let code = null;                   // current room code
  let unsub = null;                  // onValue unsubscribe
  let room = null;                   // latest snapshot
  let ticker = null;                 // leader/timer interval
  const dsCache = {};                // gen -> { data, movelist }
  let engineCache = { roundNum: -1, gen: null, revLen: -1, round: null, mystery: null };

  // ---------------------------------------------------------------- bootstrap
  root.append(el('div', { class: 'draft-loading' }, 'Connecting\u2026'));
  (async () => {
    try { me = await getID(); fb = await getFB(); }
    catch { showFatal('Couldn\u2019t reach the server. Online play needs a connection.'); return; }
    showEntry();
  })();

  // ---------------------------------------------------------------- datasets
  async function loadDataset(genSetting) {
    const key = genSetting === 'gen1' ? 1 : 2;     // gen2.json holds all 251 → covers gen2 & both
    if (dsCache[key]) return dsCache[key];
    const [d, ml] = await Promise.all([
      fetch(`data/gen${key}.json`).then((r) => r.json()),
      fetch(`data/movelist-gen${key}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    return (dsCache[key] = { data: d, movelist: ml });
  }

  function localEngine() {
    if (!room || room.status === 'lobby') return null;
    const gen = room.settings.gen;
    const ds = dsCache[gen === 'gen1' ? 1 : 2];
    if (!ds) return null;            // dataset still loading
    const revIds = room.revealedClueIds || [];
    if (engineCache.roundNum === room.roundNum && engineCache.gen === gen && engineCache.revLen === revIds.length) {
      return engineCache;
    }
    const { round, mystery } = buildEngine({
      data: ds.data, movelist: ds.movelist, seed: seedFor(room.seed, room.roundNum),
      poolFilter: gen, poolStart: room.settings.poolStart,
    });
    applyReveals(round, revIds);
    engineCache = { roundNum: room.roundNum, gen, revLen: revIds.length, round, mystery };
    return engineCache;
  }

  // ---------------------------------------------------------------- role
  const isHost = () => room && room.hostUid === me.uid;
  const activeUid = () => room && room.turnOrder && room.turnOrder[room.currentTurnPos];
  const isMyTurn = () => room && room.status === 'playing' && activeUid() === me.uid;
  function leaderUid() {
    if (!room || !room.players) return null;
    if (room.players[room.hostUid] && room.players[room.hostUid].connected) return room.hostUid;
    const order = room.joinOrder || Object.keys(room.players);
    for (const uid of order) if (room.players[uid] && room.players[uid].connected) return uid;
    return order[0] || null;
  }
  const isLeader = () => room && leaderUid() === me.uid;

  // ===================================================================== ENTRY
  function showEntry() {
    stopTicker();
    put(root, 
      el('div', { class: 'mp-form-section', style: { maxWidth: '440px', margin: '0 auto' } },
        el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '12px' } }, '\uD83C\uDF10 Online Multiplayer'),
        el('p', { class: 'sf-intro', style: { textAlign: 'center' } }, `Hi ${me.name || 'player'} \u2014 create a room and share the code, or join one.`),
        el('div', { class: 'online-entry-btns' },
          el('button', { class: 'btn-primary', onClick: showCreate }, 'Create a room'),
          el('button', { class: 'btn-secondary', onClick: showJoin }, 'Join with a code')),
        el('button', { class: 'btn-secondary', style: { marginTop: '18px' }, onClick: () => onExit && onExit() }, '\u2190 Back')));
  }

  // ===================================================================== CREATE
  function showCreate() {
    const s = { gen: defaultGen, gameMode: 'rtg', clueMode: 'choose', winTarget: 150, poolStart: 75, guessCost: 0 };
    const seg = (label, key, opts) => el('div', { class: 'mp-form-section' },
      el('div', { class: 'mp-form-label' }, label),
      el('div', { class: 'online-seg' }, ...opts.map(([val, txt]) =>
        el('button', { class: 'online-seg-btn' + (s[key] === val ? ' on' : ''), onClick: (e) => { s[key] = val; e.currentTarget.parentElement.querySelectorAll('.online-seg-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, txt))));
    const num = (label, key, min, max) => el('div', { class: 'mp-form-section' },
      el('div', { class: 'mp-form-label' }, label),
      el('input', { class: 'mp-name-input', type: 'number', value: String(s[key]), min: String(min), max: String(max), onInput: (e) => { s[key] = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min)); } }));
    put(root, 
      el('div', { style: { maxWidth: '460px', margin: '0 auto' } },
        el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '10px' } }, 'Create a room'),
        seg('Generation', 'gen', [['gen1', 'Gen I'], ['gen2', 'Gen II'], ['both', 'Both']]),
        seg('Turn order', 'gameMode', [['rtg', 'Reveal \u2192 Guess'], ['gtr', 'Guess \u2192 Reveal']]),
        seg('Clue picking', 'clueMode', [['choose', 'Choose'], ['random', 'Random']]),
        num('Win target (pts)', 'winTarget', 10, 9999),
        num('Pool per round (pts)', 'poolStart', 10, 999),
        num('Wrong-guess cost (pts)', 'guessCost', 0, 20),
        el('div', { class: 'summary-actions' },
          el('button', { class: 'btn-primary', onClick: () => createRoom(s) }, 'Create room'),
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'))));
  }

  async function createRoom(settings) {
    code = makeRoomCode();
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const player = { name: (me.name || 'Host').slice(0, 16), color: COLORS[0], score: 0, roundsWon: 0, connected: true, joinedAt: Date.now() };
    const initial = {
      code, seed, hostUid: me.uid, status: 'lobby', settings,
      players: { [me.uid]: player }, joinOrder: [me.uid],
      turnOrder: [], currentTurnPos: 0, phase: 'reveal', pool: settings.poolStart,
      roundNum: 0, revealedClueIds: [], guessLog: [], lastRandomRevealCat: null,
      turnDeadline: 0, roundResult: null, updatedAt: Date.now(),
    };
    try {
      await fb.set(`/rooms/${code}`, initial);
      await loadDataset(settings.gen);
      attach();
    } catch (e) { showFatal('Could not create room: ' + (e.message || e)); }
  }

  // ===================================================================== JOIN
  function showJoin() {
    let val = '';
    const input = el('input', { class: 'mp-name-input', maxlength: '6', placeholder: 'CODE', style: { textTransform: 'uppercase', letterSpacing: '4px', textAlign: 'center', fontSize: '20px' }, onInput: (e) => { val = e.target.value.toUpperCase().trim(); e.target.value = val; } });
    const err = el('div', { class: 'guess-feedback' });
    put(root, 
      el('div', { style: { maxWidth: '380px', margin: '0 auto' } },
        el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '12px' } }, 'Join a room'),
        el('div', { class: 'mp-form-section' }, el('div', { class: 'mp-form-label' }, 'Room code'), input),
        err,
        el('div', { class: 'summary-actions' },
          el('button', { class: 'btn-primary', onClick: () => joinRoom(val, err) }, 'Join'),
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'))));
    setTimeout(() => input.focus(), 30);
  }

  async function joinRoom(c, err) {
    c = String(c || '').toUpperCase().trim();
    if (c.length !== 6) { err.className = 'guess-feedback error'; err.textContent = 'Codes are 6 characters.'; return; }
    let snap;
    try { snap = await fb.get(`/rooms/${c}`); } catch { snap = null; }
    if (!snap) { err.className = 'guess-feedback error'; err.textContent = 'No room with that code.'; return; }
    if (snap.status !== 'lobby' && !(snap.players && snap.players[me.uid])) {
      err.className = 'guess-feedback error'; err.textContent = 'That game has already started.'; return;
    }
    code = c;
    const existing = snap.players && snap.players[me.uid];
    const idx = (snap.joinOrder || []).length;
    try {
      if (!existing) {
        const player = { name: (me.name || 'Player').slice(0, 16), color: COLORS[idx % COLORS.length], score: 0, roundsWon: 0, connected: true, joinedAt: Date.now() };
        await fb.update(`/rooms/${code}/players/${me.uid}`, player);
        await fb.set(`/rooms/${code}/joinOrder`, [...(snap.joinOrder || []), me.uid]);
      } else {
        await fb.set(`/rooms/${code}/players/${me.uid}/connected`, true);
      }
      await loadDataset(snap.settings.gen);
      attach();
    } catch (e) { err.className = 'guess-feedback error'; err.textContent = 'Could not join: ' + (e.message || e); }
  }

  // ===================================================================== SYNC
  function attach() {
    try { fb.onDisconnectSet(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
    unsub = fb.onValue(`/rooms/${code}`, (snap) => {
      room = snap;
      if (!room) { showFatal('The room was closed.'); return; }
      if (!dsCache[room.settings.gen === 'gen1' ? 1 : 2]) { loadDataset(room.settings.gen).then(render); }
      render();
    });
    startTicker();
  }

  // leader-driven timeouts: enforce the turn timer + auto-advance rounds
  function startTicker() { stopTicker(); ticker = setInterval(tick, TICK_MS); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
  async function tick() {
    if (!room) return;
    updateTimerText();                          // lightweight: just the countdown
    if (!isLeader()) return;
    const now = Date.now();
    if (room.status === 'playing' && room.turnDeadline && now > room.turnDeadline + GRACE_MS) {
      await advanceTurn(true);                  // active player ran out of time / is away
    } else if (room.status === 'roundOver' && room.turnDeadline && now > room.turnDeadline) {
      await startRound(room.roundNum + 1);
    }
  }

  // ===================================================================== RENDER
  // append only real nodes (native .append turns null into the text "null")
  function put(parent, ...kids) { clear(parent); for (const k of kids) if (k != null && k !== false) parent.appendChild(k); return parent; }

  function render() {
    if (!room) return;
    // preserve an in-progress guess (value + focus) across a rebuild
    const typing = root.querySelector('#online-typing');
    const keep = typing && typing === document.activeElement ? { val: typing.value, start: typing.selectionStart } : null;
    if (room.status === 'lobby') renderLobby();
    else if (room.status === 'gameOver') renderGameOver();
    else if (room.status === 'roundOver') renderRoundOver();
    else renderGame();
    if (keep) {
      const t = root.querySelector('#online-typing');
      if (t) { t.value = keep.val; try { t.setSelectionRange(keep.start, keep.start); } catch {} t.focus(); }
    }
  }

  function updateTimerText() {
    const elx = root.querySelector('.online-timer'); if (!elx) return;
    const secs = secondsLeft(); if (secs == null) return;
    elx.textContent = `\u23F1 ${secs}s`;
    elx.classList.toggle('low', secs <= 10);
  }

  function topbar(extra) {
    return el('div', { class: 'mp-current-player-header' },
      el('button', { class: 'btn-secondary', style: { fontSize: '11px', padding: '5px 10px' }, onClick: leaveRoom }, '\u2190 Leave'),
      el('div', { style: { fontFamily: 'var(--font-pixel)', fontSize: '11px', color: 'var(--accent-gold)' } }, 'Room ' + code),
      extra || el('span'));
  }

  function playerList() {
    const order = room.joinOrder || Object.keys(room.players);
    return el('div', { class: 'online-players' },
      ...order.map((uid) => {
        const p = room.players[uid]; if (!p) return null;
        const active = room.status === 'playing' && activeUid() === uid;
        return el('div', { class: 'online-player' + (active ? ' active' : '') + (p.connected ? '' : ' offline') },
          el('span', { class: 'mp-name-swatch', style: { background: p.color } }),
          el('span', { class: 'online-player-name' }, p.name + (uid === me.uid ? ' (you)' : '') + (uid === room.hostUid ? ' \uD83D\uDC51' : '')),
          el('span', { class: 'online-player-score' }, `${p.score || 0}`),
          p.connected ? null : el('span', { class: 'online-offline-dot', title: 'disconnected' }, '\u26AB'));
      }));
  }

  function renderLobby() {
    const n = Object.keys(room.players).length;
    put(root, 
      topbar(),
      el('div', { style: { maxWidth: '460px', margin: '14px auto', textAlign: 'center' } },
        el('div', { class: 'mp-form-label' }, 'Share this code'),
        el('div', { class: 'online-code' }, code),
        el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
          `${room.settings.gen === 'both' ? 'Gen I & II' : room.settings.gen === 'gen1' ? 'Gen I' : 'Gen II'} \u00b7 ` +
          `${room.settings.gameMode.toUpperCase()} \u00b7 ${room.settings.clueMode} clues \u00b7 win at ${room.settings.winTarget} pts`),
        el('div', { class: 'mp-form-label', style: { marginTop: '14px' } }, `Players (${n})`),
        playerList(),
        isHost()
          ? el('button', { class: 'btn-primary', style: { marginTop: '16px', width: '100%' }, disabled: n < 2, onClick: () => startRound(1) }, n < 2 ? 'Waiting for 1+ more\u2026' : 'Start game \u25b6')
          : el('p', { class: 'mp-phase-hint', style: { marginTop: '16px' } }, 'Waiting for the host to start\u2026')));
  }

  function secondsLeft() {
    if (!room.turnDeadline) return null;
    return Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000));
  }

  function renderGame() {
    const eng = localEngine();
    if (!eng) { put(root, topbar(), el('div', { class: 'draft-loading' }, 'Loading round\u2026')); return; }
    const active = room.players[activeUid()];
    const secs = secondsLeft();
    const mine = isMyTurn();

    // verify any displayed round result (shouldn't normally show here, but guard)
    const banner = disputeBanner(eng);

    put(root, 
      topbar(el('div', { style: { fontSize: '11px', color: 'var(--text-dim)' } }, `Round ${room.roundNum}`)),
      banner,
      el('div', { class: 'online-statusbar' },
        el('div', { class: 'points-number' }, `${room.pool} pts`),
        el('div', { class: 'online-turn' },
          el('span', { style: { color: active ? active.color : '' } }, `${active ? active.name : '?'}${mine ? ' (you)' : ''}`),
          el('span', { class: 'mp-phase-label' }, ' \u2014 ' + (room.phase === 'guess' ? 'guessing' : 'revealing'))),
        secs != null ? el('div', { class: 'online-timer' + (secs <= 10 ? ' low' : '') }, `\u23F1 ${secs}s`) : el('span')),
      playerList(),
      cluePanel(eng, mine),
      actionBlock(eng, mine),
      guessLogEl());
  }

  function cluePanel(eng, mine) {
    const rv = eng.round.revealedClues;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const clues = ds.data.clues, categories = ds.data.categories;
    const canReveal = mine && room.phase === 'reveal' && room.settings.clueMode === 'choose';
    return el('div', { class: 'mp-clue-panel' },
      ...categories.map((cat) => el('div', { class: 'online-cat' },
        el('div', { class: 'cat-header', style: { background: cat.bg } }, el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
        el('div', { class: 'online-clue-row' },
          ...clues.filter((c) => c.cat === cat.id).map((c) => clueCard(c, eng, rv, canReveal))))));
  }

  function clueCard(clue, eng, rv, canReveal) {
    const revealed = clue.id in rv;
    const affordable = room.pool >= clue.cost;
    const available = canReveal && !revealed && eng.round.clueAvailable(clue) && affordable;
    const cls = 'online-clue' + (revealed ? ' revealed' : '') + (available ? ' available' : '') + (!available && !revealed ? ' disabled' : '');
    return el('div', { class: cls, onClick: available ? () => revealClue(clue.id) : undefined },
      el('div', { class: 'online-clue-top' },
        el('span', { class: 'online-clue-name' }, clue.name),
        el('span', { class: 'clue-cost-badge' }, `${clue.cost}pt`)),
      revealed ? el('div', { class: 'clue-revealed-value' }, String(rv[clue.id])) : null);
  }

  function actionBlock(eng, mine) {
    if (!mine) return el('div', { class: 'mp-phase-hint', style: { textAlign: 'center' } }, 'Watching\u2026 it\u2019s not your turn.');
    const block = el('div', { class: 'online-action' });
    if (room.phase === 'reveal') {
      if (room.settings.clueMode === 'random') {
        put(block,
          el('button', { class: 'btn-bait', style: { width: '100%' }, onClick: revealRandom }, '\uD83C\uDF6F Reveal a random clue'),
          el('button', { class: 'btn-secondary', style: { width: '100%', marginTop: '8px' }, onClick: () => skipToGuess() }, 'Skip to guess \u25b6'));
      } else {
        put(block, el('p', { class: 'mp-phase-hint' }, '\u2191 Tap a clue to reveal it'),
          el('button', { class: 'btn-secondary', style: { width: '100%' }, onClick: () => skipToGuess() }, 'Skip to guess \u25b6'));
      }
    } else {
      const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
      const input = el('input', { id: 'online-typing', class: 'guess-input', type: 'text', placeholder: 'Which Pok\u00e9mon?', autocomplete: 'off', list: 'online-names', onKeydown: (e) => { if (e.key === 'Enter') doGuess(input.value); } });
      put(block,
        el('div', { class: 'guess-input-wrap' }, input, el('button', { class: 'guess-btn', onClick: () => doGuess(input.value) }, 'Guess')),
        el('datalist', { id: 'online-names' }, ...ds.data.pokedex.map((p) => el('option', { value: p.name }))),
        room.settings.gameMode === 'gtr' ? el('button', { class: 'btn-secondary', style: { width: '100%', marginTop: '8px' }, onClick: () => { fb.update(`/rooms/${code}`, { phase: 'reveal' }); } }, 'Skip guess \u2192 reveal') : null);
      setTimeout(() => input.focus(), 30);
    }
    return block;
  }

  function guessLogEl() {
    const log = room.guessLog || [];
    if (!log.length) return el('div', { class: 'guess-log-empty' }, 'No guesses yet this round.');
    return el('div', { class: 'guess-log' },
      ...log.slice(-8).map((g) => {
        const p = room.players[g.uid] || {};
        return el('div', { class: 'guess-log-item ' + (g.correct ? 'correct' : 'wrong') },
          el('span', { style: { color: p.color, fontWeight: 700 } }, (p.name || '?') + ': '), g.name);
      }));
  }

  // ===================================================================== ACTIONS
  async function startRound(n) {
    if (!room) return;
    const winner = room.roundResult && room.roundResult.winnerUid;
    let turnOrder = room.turnOrder && room.turnOrder.length ? room.turnOrder : (room.joinOrder || Object.keys(room.players));
    let currentTurnPos = room.currentTurnPos || 0;
    if (n === 1) { turnOrder = room.joinOrder || Object.keys(room.players); currentTurnPos = 0; }
    await fb.update(`/rooms/${code}`, {
      status: 'playing', roundNum: n, pool: room.settings.poolStart,
      phase: room.settings.gameMode === 'rtg' ? 'reveal' : 'guess',
      revealedClueIds: [], guessLog: [], lastRandomRevealCat: null,
      turnOrder, currentTurnPos, roundResult: null,
      turnDeadline: Date.now() + TURN_MS,
      updatedAt: Date.now(),
    });
  }

  async function revealClue(id) {
    if (!isMyTurn() || room.phase !== 'reveal') return;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const clue = ds.data.clues.find((c) => c.id === id);
    if (!clue || room.pool < clue.cost) return;
    // verify locally that the clue is buyable on this mystery
    const eng = localEngine();
    if (!eng.round.clueAvailable(clue) || (clue.id in eng.round.revealedClues)) return;
    const out = revealOutcome({ pool: room.pool, revealedClueIds: room.revealedClueIds || [], phase: room.phase }, id, clue.cost, room.settings.gameMode);
    engineCache.roundNum = -1; // force rebuild next render
    await fb.update(`/rooms/${code}`, { pool: out.pool, revealedClueIds: out.revealedClueIds, phase: out.phase, updatedAt: Date.now() });
  }

  async function revealRandom() {
    if (!isMyTurn() || room.phase !== 'reveal') return;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const eng = localEngine();
    const available = ds.data.clues.filter((c) => !(c.id in eng.round.revealedClues) && eng.round.clueAvailable(c) && room.pool >= c.cost);
    if (!available.length) return skipToGuess();
    const pen = (ds.data.multiClue && ds.data.multiClue.randomRevealCategoryPenalty) ?? 0.25;
    const rng = mkRng(seedFor(room.seed, room.roundNum, (room.revealedClueIds || []).length + 1));
    const pick = weightedRandomClue(available, room.lastRandomRevealCat, pen, rng);
    const out = revealOutcome({ pool: room.pool, revealedClueIds: room.revealedClueIds || [], phase: room.phase }, pick.id, pick.cost, room.settings.gameMode);
    await fb.update(`/rooms/${code}`, { pool: out.pool, revealedClueIds: out.revealedClueIds, phase: out.phase, lastRandomRevealCat: pick.cat, updatedAt: Date.now() });
  }

  function skipToGuess() {
    if (!isMyTurn()) return;
    if (room.settings.gameMode === 'gtr') return advanceTurn(false); // GTR reveal done → next player
    fb.update(`/rooms/${code}`, { phase: 'guess', updatedAt: Date.now() });
  }

  async function doGuess(name) {
    if (!isMyTurn() || room.phase !== 'guess') return;
    const val = String(name || '').trim(); if (!val) return;
    const eng = localEngine();
    const out = guessOutcome({ pool: room.pool }, val, eng.mystery.name, room.settings.guessCost);
    const log = [...(room.guessLog || []), { uid: me.uid, name: val, correct: out.correct }];
    if (out.correct) {
      const myScore = (room.players[me.uid].score || 0) + out.earned;
      const players = { ...room.players, [me.uid]: { ...room.players[me.uid], score: myScore, roundsWon: (room.players[me.uid].roundsWon || 0) + 1 } };
      const champ = champion(players, room.settings.winTarget);
      const rotated = advanceAfterWin(room.turnOrder, me.uid);
      await fb.update(`/rooms/${code}`, {
        players, guessLog: log,
        roundResult: { winnerUid: me.uid, winnerName: room.players[me.uid].name, guessName: val, mysteryNum: eng.mystery.num, mysteryName: eng.mystery.name, earned: out.earned, roundNum: room.roundNum },
        turnOrder: rotated.turnOrder, currentTurnPos: rotated.currentTurnPos,
        status: champ ? 'gameOver' : 'roundOver',
        turnDeadline: Date.now() + ADVANCE_MS, updatedAt: Date.now(),
      });
    } else {
      await fb.update(`/rooms/${code}`, { pool: out.pool, guessLog: log, updatedAt: Date.now() });
      if (room.settings.gameMode === 'rtg') await advanceTurn(false);
      else await fb.update(`/rooms/${code}`, { phase: 'reveal', updatedAt: Date.now() });
    }
  }

  async function advanceTurn(timedOut) {
    if (!room || room.status !== 'playing') return;
    const order = room.turnOrder || [];
    const pos = nextTurnPos(room.currentTurnPos || 0, order.length);
    await fb.update(`/rooms/${code}`, {
      currentTurnPos: pos,
      phase: room.settings.gameMode === 'rtg' ? 'reveal' : 'guess',
      turnDeadline: Date.now() + TURN_MS,
      updatedAt: Date.now(),
    });
  }

  // ===================================================================== ROUND OVER / GAME OVER
  function disputeBanner(eng) {
    const rr = room.roundResult;
    if (!rr || !eng) return null;
    const verified = String(eng.mystery.num) === String(rr.mysteryNum) && normalizeName(rr.guessName) === normalizeName(eng.mystery.name);
    if (verified) return null;
    return el('div', { class: 'battle-offline' }, '\u26A0\uFE0F A result couldn\u2019t be verified on your device.');
  }

  function renderRoundOver() {
    const rr = room.roundResult || {};
    const eng = localEngine();
    const verified = eng && String(eng.mystery.num) === String(rr.mysteryNum) && normalizeName(rr.guessName) === normalizeName(eng.mystery.name);
    const secs = secondsLeft();
    const arr = Object.entries(room.players).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (b.score || 0) - (a.score || 0));
    put(root, 
      topbar(el('div', { style: { fontSize: '11px', color: 'var(--text-dim)' } }, `Round ${room.roundNum}`)),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' },
            el('div', { class: 'summary-result' }, '\uD83C\uDFAF ' + (rr.winnerName || 'Someone') + ' got it!'),
            el('div', { class: 'summary-mon' }, rr.mysteryName || '?')),
          verified ? null : el('div', { class: 'battle-offline' }, '\u26A0\uFE0F This result couldn\u2019t be verified on your device.'),
          el('div', { style: { textAlign: 'center', color: 'var(--text-secondary)', margin: '6px 0' } }, `+${rr.earned || 0} pts`),
          el('div', { class: 'online-players' },
            ...arr.map((p) => el('div', { class: 'online-player' + (p.uid === me.uid ? ' active' : '') },
              el('span', { class: 'mp-name-swatch', style: { background: p.color } }),
              el('span', { class: 'online-player-name' }, p.name + (p.uid === me.uid ? ' (you)' : '')),
              el('span', { class: 'online-player-score' }, `${p.score || 0}`)))),
          el('div', { style: { textAlign: 'center', color: 'var(--text-dim)', marginTop: '10px', fontSize: '12px' } },
            secs != null ? `Next round in ${secs}s\u2026` : 'Next round\u2026'))));
  }

  function renderGameOver() {
    const arr = Object.entries(room.players).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (b.score || 0) - (a.score || 0));
    const champ = arr[0];
    const eng = localEngine();
    put(root, 
      topbar(),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' }, el('div', { class: 'summary-result' }, '\uD83C\uDFC6 Winner'), el('div', { class: 'summary-mon' }, champ ? champ.name : '\u2014')),
          el('div', { class: 'online-podium' },
            ...arr.map((p, i) => el('div', { class: 'online-podium-row' + (p.uid === me.uid ? ' me' : '') },
              el('span', {}, (['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][i]) || `${i + 1}`),
              el('span', { class: 'mp-name-swatch', style: { background: p.color } }),
              el('span', { style: { flex: 1, fontWeight: p.uid === me.uid ? 800 : 400 } }, p.name),
              el('span', { style: { fontWeight: 700 } }, `${p.score || 0} pts`)))),
          el('div', { class: 'summary-actions' },
            isHost() ? el('button', { class: 'btn-primary', onClick: () => startRound(1) }, 'Play again') : null,
            el('button', { class: 'btn-secondary', onClick: leaveRoom }, 'Leave room')))));
  }

  // ===================================================================== misc
  function mkRng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  async function leaveRoom() {
    stopTicker();
    if (unsub) { try { unsub(); } catch { /* ok */ } unsub = null; }
    try { if (code && me) await fb.set(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
    onExit && onExit();
  }

  function showFatal(msg) {
    stopTicker();
    put(root, el('p', { class: 'placeholder-text' }, msg),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
  }

  return {
    destroy() {
      stopTicker();
      if (unsub) { try { unsub(); } catch { /* ok */ } unsub = null; }
      try { if (code && me && fb) fb.set(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
      clear(mount);
    },
  };
}

export default createOnline;
