/**
 * @file        docs/js/modes/race.js
 * @version     1.0.0
 * @updated     2026-06-26
 * @changelog
 *   1.0.0 — Parallel online Race. Everyone plays their OWN guess board at the
 *           same time; the mystery order is identical for all players (seeded
 *           from the room) so it's fair. First player to reach the host's target
 *           (default 5 or 10, customizable) wins. Reuses lib/engine.js for each
 *           mystery, lib/firebase.js + lib/identity.js for the room, and the same
 *           /rooms/{code} schema as online MP (tagged game:'race').
 *
 *           Testable: params._getFirebase / params._getIdentity inject fakes.
 */

import { el, clear } from '../lib/dom.js';
import { PokeGuessRound, normalizeName } from '../lib/engine.js';
import { makeRoomCode, seedFor } from '../lib/mp-rules.js';

// Deterministic PRNG so every client builds the same mystery order from the seed.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildOrder(seed, n) {
  const r = mulberry32((seed >>> 0) || 0x9e3779b9);
  const idx = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

export function createRace({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'mp-content online-root race-root' });
  clear(mount).appendChild(root);

  const getFB = params._getFirebase || (() => import('../lib/firebase.js').then((m) => m.getFirebase()));
  const getID = params._getIdentity || (() => import('../lib/identity.js').then((m) => m.getIdentity()));

  // Per-mystery board needs the same config the single-player engine uses.
  if (!Array.isArray(data.difficulties) || !Array.isArray(data.clues) || !Array.isArray(data.categories)) {
    root.append(el('p', { class: 'placeholder-text' }, 'This generation\u2019s data file is missing its clue configuration. Re-run the data pipeline and re-upload it.'),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
    return { destroy() { clear(mount); } };
  }

  const cats = data.categories || [];
  const clues = data.clues || [];
  const genLabel = data.id === 'gen1' ? 'Gen 1' : 'Gen 2';
  let fb = null, me = null, movelist = {};
  let code = null, room = null, unsub = null;
  let order = null;           // shared mystery order (indices into data.pokedex)
  let round = null;           // current mystery's PokeGuessRound
  let myAttempts = 0, mySolved = 0, finished = false;
  let destroyed = false;

  // ---- boot ----------------------------------------------------------------
  Promise.all([
    getFB(), getID(),
    fetch(`data/movelist-${data.id}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([fbi, idi, ml]) => {
    if (destroyed) return;
    fb = fbi; me = idi; movelist = ml || {};
    showEntry();
  }).catch(() => {
    root.append(el('p', { class: 'placeholder-text' }, 'Couldn\u2019t connect. Race needs an internet connection.'),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
  });

  function put(parent, ...kids) { clear(parent); for (const k of kids) if (k != null && k !== false) parent.appendChild(k); return parent; }
  function topbar(title) {
    return el('div', { class: 'game-topbar' },
      el('button', { class: 'btn-secondary game-exit', onClick: () => onExit && onExit() }, '\u2190 Quit'),
      el('div', { class: 'vr-topbar-center' }, el('div', { class: 'online-title' }, title), el('div', { class: 'gen-bar-label' }, genLabel)));
  }

  // ===== ENTRY / LOBBY ======================================================
  function showEntry() {
    put(root,
      topbar('\uD83C\uDFC1 Race'),
      el('div', { class: 'mp-form-section', style: { maxWidth: '420px', margin: '16px auto' } },
        el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
          'Everyone races their own board through the same Pok\u00e9mon. First to solve the target number wins!'),
        el('div', { class: 'sp-start-row', style: { justifyContent: 'center' } },
          el('button', { class: 'btn-primary', onClick: showCreate }, 'Create a room'),
          el('button', { class: 'btn-secondary', onClick: showJoin }, 'Join with a code'))));
  }

  function showCreate() {
    const s = { target: 5, gen: data.id };
    const targetInput = el('input', { class: 'mp-input', type: 'number', min: '1', max: '50', value: '5' });
    const setT = (n) => { s.target = n; targetInput.value = String(n); };
    targetInput.addEventListener('input', () => { s.target = Math.max(1, Math.min(50, parseInt(targetInput.value, 10) || 5)); });
    put(root,
      topbar('\uD83C\uDFC1 Create Race'),
      el('div', { class: 'mp-form-section', style: { maxWidth: '420px', margin: '16px auto' } },
        el('div', { class: 'mp-form-label' }, 'First to solve how many wins?'),
        el('div', { class: 'sp-start-row' },
          el('button', { class: 'btn-secondary', onClick: () => setT(5) }, '5'),
          el('button', { class: 'btn-secondary', onClick: () => setT(10) }, '10')),
        el('div', { class: 'mp-form-label', style: { marginTop: '10px' } }, 'Or set a custom target'),
        targetInput,
        el('div', { class: 'sp-start-row', style: { marginTop: '14px' } },
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'),
          el('button', { class: 'btn-primary', onClick: () => createRoom(s) }, 'Create room'))));
  }

  async function createRoom(settings) {
    code = makeRoomCode();
    const seed = (Math.random() * 2 ** 31) | 0;
    const player = { name: me.name, connected: true, solved: 0, attempts: 0, doneAt: 0, joinedAt: Date.now() };
    const initial = {
      code, seed, game: 'race', hostUid: me.uid, status: 'lobby', settings,
      players: { [me.uid]: player }, joinOrder: [me.uid], winnerUid: '',
    };
    try { await fb.set(`/rooms/${code}`, initial); attach(); }
    catch { put(root, topbar('\uD83C\uDFC1 Race'), errorBox('Could not create the room. Try again.'), backBtn(showEntry)); }
  }

  function showJoin() {
    const input = el('input', { class: 'mp-input', maxlength: '6', placeholder: 'ABC123', style: { textTransform: 'uppercase' } });
    const err = el('div', { class: 'mp-error' });
    put(root,
      topbar('\uD83C\uDFC1 Join Race'),
      el('div', { class: 'mp-form-section', style: { maxWidth: '420px', margin: '16px auto' } },
        el('div', { class: 'mp-form-label' }, 'Enter the 6-character room code'),
        input, err,
        el('div', { class: 'sp-start-row', style: { marginTop: '14px' } },
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'),
          el('button', { class: 'btn-primary', onClick: () => joinRoom(input.value, err) }, 'Join'))));
  }

  async function joinRoom(c, err) {
    c = String(c || '').trim().toUpperCase();
    if (c.length !== 6) { err.textContent = 'Codes are 6 characters.'; return; }
    let snap = null;
    try { snap = await fb.get(`/rooms/${c}`); } catch { snap = null; }
    if (!snap) { err.textContent = 'No room with that code.'; return; }
    if (snap.game !== 'race') { err.textContent = 'That code is a different game type.'; return; }
    const rejoin = snap.players && snap.players[me.uid];
    if (snap.status !== 'lobby' && !rejoin) { err.textContent = 'That race already started.'; return; }
    code = c;
    try {
      if (!rejoin) {
        const player = { name: me.name, connected: true, solved: 0, attempts: 0, doneAt: 0, joinedAt: Date.now() };
        await fb.update(`/rooms/${code}/players/${me.uid}`, player);
        await fb.set(`/rooms/${code}/joinOrder`, [...(snap.joinOrder || []), me.uid]);
      } else {
        await fb.set(`/rooms/${code}/players/${me.uid}/connected`, true);
      }
      attach();
    } catch { err.textContent = 'Could not join. Try again.'; }
  }

  function attach() {
    try { fb.onDisconnectSet(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
    unsub = fb.onValue(`/rooms/${code}`, (snap) => {
      if (destroyed) return;
      room = snap;
      if (!room) { put(root, topbar('\uD83C\uDFC1 Race'), errorBox('The room was closed.'), backBtn(showEntry)); return; }
      render();
    });
  }

  // ===== RENDER ROUTING =====================================================
  function render() {
    if (room.status === 'lobby') return renderLobby();
    if (room.status === 'gameOver') return renderGameOver();
    // playing
    if (!order) order = buildOrder(room.seed, data.pokedex.length);
    if (!round) loadMystery();
    else renderBoard();
    renderProgressStrip();
  }

  function connectedPlayers() {
    const order2 = room.joinOrder || Object.keys(room.players || {});
    return order2.map((uid) => ({ uid, ...(room.players[uid] || {}) })).filter((p) => p.name);
  }

  function renderLobby() {
    const players = connectedPlayers();
    const isHost = room.hostUid === me.uid;
    const canStart = isHost && players.filter((p) => p.connected).length >= 2;
    put(root,
      topbar('\uD83C\uDFC1 Race Lobby'),
      el('div', { class: 'online-room-meta' },
        el('div', { class: 'online-code-big' }, `Code: ${code}`),
        el('div', { class: 'sf-intro' }, `First to ${room.settings.target} solved wins \u00b7 ${genLabel}`)),
      el('div', { class: 'online-players' },
        ...players.map((p) => el('div', { class: 'online-player' + (p.connected ? '' : ' offline') },
          el('span', {}, p.name + (p.uid === room.hostUid ? ' \uD83D\uDC51' : '') + (p.uid === me.uid ? ' (you)' : '')),
          el('span', { class: 'online-player-state' }, p.connected ? 'ready' : 'offline')))),
      isHost
        ? el('div', { class: 'sp-start-row', style: { justifyContent: 'center', marginTop: '16px' } },
            el('button', { class: 'btn-primary', disabled: !canStart, style: canStart ? {} : { opacity: 0.5 }, onClick: startGame },
              canStart ? 'Start race \u25b6' : 'Waiting for players\u2026'))
        : el('div', { class: 'sf-intro', style: { textAlign: 'center', marginTop: '16px' } }, 'Waiting for the host to start\u2026'));
  }

  async function startGame() {
    try { await fb.set(`/rooms/${code}/status`, 'playing'); await fb.set(`/rooms/${code}/startedAt`, Date.now()); }
    catch { /* the onValue will re-render if it failed */ }
  }

  // ===== PER-MYSTERY BOARD ==================================================
  function loadMystery() {
    const poke = data.pokedex[order[myAttempts % order.length]];
    round = new PokeGuessRound({ genData: data, movelist, rng: Math.random });
    round.start({ difficultyId: 'normal', mystery: poke, guessMode: 'free', clueMode: 'choose' });
    renderBoard();
  }

  function renderBoard() {
    const target = room.settings.target;
    const board = el('div', { class: 'race-board' });
    board.append(
      el('div', { class: 'race-head' },
        el('div', { class: 'race-solved' }, `Solved: ${mySolved} / ${target}`),
        el('div', { class: 'race-points', id: 'race-points' }, `${round.pointsRemaining} pts`),
        el('div', { class: 'race-mystery' }, `Mystery #${myAttempts + 1}`)),
      el('div', { class: 'race-feedback', id: 'race-feedback' }),
      clueGrid(),
      guessRow(),
      el('div', { class: 'revealed-summary', id: 'race-revealed' }));
    put(root, topbar('\uD83C\uDFC1 Race'), board, el('div', { class: 'race-progress', id: 'race-progress' }));
    renderRevealed();
    renderProgressStrip();
  }

  function clueGrid() {
    const panel = el('div', { class: 'clue-panel race-clue-panel' });
    const lockedCats = (round.state.diffRestrictions && round.state.diffRestrictions.lockedCats) || [];
    for (const cat of cats) {
      if (lockedCats.includes(cat.id)) continue;
      const body = el('div', { class: 'cat-body' });
      for (const clue of clues.filter((c) => c.cat === cat.id)) body.appendChild(clueCard(clue, cat));
      if (body.children.length) {
        panel.append(el('div', { class: 'cat-section' },
          el('div', { class: 'cat-header', style: { background: cat.bg } }, el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
          body));
      }
    }
    return panel;
  }

  function clueCard(clue, cat) {
    const s = round.state;
    const hist = s.clueHistory[clue.id] || [];
    const cost = round.clueCurrentCost(clue.id);
    const card = el('button', { class: 'clue-btn' });
    const avail = round.clueAvailable(clue) && !round.difficultyLock(clue)
      && !round.clueLimitInfo(clue).atLimit && (clue.requiresClueId == null || (clue.requiresClueId in s.revealedClues));
    if (!avail && !hist.length) {
      card.classList.add('unavailable');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name)));
      return card;
    }
    if (round.pointsRemaining < cost) card.classList.add('cant-afford');
    if (hist.length) { card.classList.add('revealed'); Object.assign(card.style, { background: cat.bg, borderColor: cat.color }); }
    card.append(el('div', { class: 'clue-top' },
      el('span', { class: 'clue-btn-name', style: hist.length ? { color: cat.color } : {} }, clue.name),
      el('span', { class: 'clue-cost-badge' }, `${cost}pt${cost !== 1 ? 's' : ''}`)));
    for (let i = 0; i < hist.length; i++) card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } }, (i ? `#${i + 1} ` : '') + hist[i]));
    card.addEventListener('click', () => { if (round.buyClue(clue.id).ok) afterBuy(); });
    return card;
  }

  function afterBuy() {
    const pts = root.querySelector('#race-points'); if (pts) pts.textContent = `${round.pointsRemaining} pts`;
    // re-render grid + revealed
    const old = root.querySelector('.race-clue-panel'); if (old) old.replaceWith(clueGrid());
    renderRevealed();
    if (round.gameOver || round.pointsRemaining <= 0) missMystery();
  }

  function guessRow() {
    const listId = 'race-names';
    const dl = el('datalist', { id: listId }, ...round.allNames.map((n) => el('option', { value: n })));
    const input = el('input', { class: 'mp-input', list: listId, placeholder: 'Guess the Pok\u00e9mon\u2026', id: 'race-guess' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });
    return el('div', { class: 'race-guess-row' }, dl, input,
      el('button', { class: 'btn-primary', onClick: submitGuess }, 'Guess'));
  }

  function submitGuess() {
    const input = root.querySelector('#race-guess'); if (!input) return;
    const val = String(input.value || '').trim();
    if (!val) return;
    if (!round.allNames.some((n) => normalizeName(n) === normalizeName(val))) { feedback('Pick a Pok\u00e9mon from the list.', '#e0a060'); return; }
    const res = round.submitGuess(val);
    if (res.ok && res.correct) { solveMystery(); return; }
    input.value = '';
    feedback('\u274C Not quite!', '#e06060');
    const old = root.querySelector('.race-clue-panel'); if (old) old.replaceWith(clueGrid());
    const pts = root.querySelector('#race-points'); if (pts) pts.textContent = `${round.pointsRemaining} pts`;
    if (round.gameOver || round.pointsRemaining <= 0) missMystery();
  }

  function feedback(msg, color) {
    const fb0 = root.querySelector('#race-feedback'); if (!fb0) return;
    fb0.textContent = msg; fb0.style.color = color || 'var(--text-secondary)';
  }

  function renderRevealed() {
    const box = root.querySelector('#race-revealed'); if (!box) return;
    clear(box);
    const hist = round.state.clueHistory || {};
    const ids = Object.keys(hist).map(Number);
    if (!ids.length) return;
    box.append(el('div', { class: 'rev-cat-label' }, 'Revealed'));
    ids.forEach((id) => {
      const c = round.clue(id); const vals = hist[id] || [];
      vals.forEach((v, i) => box.append(el('div', { class: 'rev-item' + (id === round.state.lastRevealedClueId && i === vals.length - 1 ? ' rev-new' : '') },
        el('span', { class: 'rev-item-name' }, (c ? c.name : `#${id}`) + (vals.length > 1 ? ` #${i + 1}` : '')),
        el('span', { class: 'rev-item-value' }, String(v)))));
    });
  }

  // ---- advance -------------------------------------------------------------
  async function solveMystery() {
    mySolved++; myAttempts++;
    feedback(`\u2705 Solved! ${mySolved}/${room.settings.target}`, '#50cc80');
    await writeProgress();
    if (mySolved >= room.settings.target) { await win(); return; }
    round = null; loadMystery();
  }
  async function missMystery() {
    myAttempts++;
    feedback('\uD83D\uDCA5 Out of points \u2014 next Pok\u00e9mon!', '#e0a060');
    await writeProgress();
    round = null;
    setTimeout(() => { if (!destroyed && room && room.status === 'playing') loadMystery(); }, 700);
  }
  async function writeProgress() {
    try {
      await fb.set(`/rooms/${code}/players/${me.uid}/solved`, mySolved);
      await fb.set(`/rooms/${code}/players/${me.uid}/attempts`, myAttempts);
    } catch { /* keep playing locally; onValue will resync */ }
  }
  async function win() {
    finished = true;
    try {
      await fb.set(`/rooms/${code}/players/${me.uid}/doneAt`, Date.now());
      const cur = await fb.get(`/rooms/${code}/winnerUid`).catch(() => '');
      if (!cur) await fb.set(`/rooms/${code}/winnerUid`, me.uid);
      await fb.set(`/rooms/${code}/status`, 'gameOver');
    } catch { /* onValue still routes everyone to gameOver once it lands */ }
  }

  // ---- live opponent strip -------------------------------------------------
  function renderProgressStrip() {
    const strip = root.querySelector('#race-progress'); if (!strip || !room) return;
    clear(strip);
    const target = room.settings.target;
    strip.append(el('div', { class: 'rev-cat-label' }, 'Race standings'));
    connectedPlayers()
      .slice().sort((a, b) => (b.solved || 0) - (a.solved || 0))
      .forEach((p) => {
        const pct = Math.min(100, Math.round(((p.solved || 0) / target) * 100));
        strip.append(el('div', { class: 'race-bar-row' },
          el('span', { class: 'race-bar-name' }, p.name + (p.uid === me.uid ? ' (you)' : '')),
          el('div', { class: 'race-bar-track' }, el('div', { class: 'race-bar-fill', style: { width: pct + '%' } })),
          el('span', { class: 'race-bar-count' }, `${p.solved || 0}/${target}`)));
      });
  }

  // ===== GAME OVER ==========================================================
  function renderGameOver() {
    const target = room.settings.target;
    const ranked = connectedPlayers().slice().sort((a, b) => {
      if ((b.solved || 0) !== (a.solved || 0)) return (b.solved || 0) - (a.solved || 0);
      return (a.doneAt || Infinity) - (b.doneAt || Infinity);
    });
    const winnerUid = room.winnerUid || (ranked[0] && ranked[0].uid);
    const iWon = winnerUid === me.uid;
    const isHost = room.hostUid === me.uid;
    put(root,
      topbar('\uD83C\uDFC1 Race Over'),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' + (iWon ? ' win' : ' loss') },
            el('div', { class: 'summary-result' }, iWon ? '\uD83C\uDFC6 You won the race!' : `\uD83C\uDFC1 ${(room.players[winnerUid] || {}).name || 'Someone'} won!`)),
          el('div', { class: 'race-progress' },
            ...ranked.map((p, i) => el('div', { class: 'race-bar-row' },
              el('span', { class: 'race-bar-name' }, `${i + 1}. ${p.name}${p.uid === me.uid ? ' (you)' : ''}`),
              el('span', { class: 'race-bar-count' }, `${p.solved || 0}/${target} solved`)))),
          el('div', { class: 'summary-actions' },
            isHost ? el('button', { class: 'btn-primary', onClick: rematch }, 'Rematch') : null,
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));
  }

  async function rematch() {
    const players = {};
    for (const uid of (room.joinOrder || Object.keys(room.players))) {
      const p = room.players[uid]; if (!p) continue;
      players[uid] = { ...p, solved: 0, attempts: 0, doneAt: 0 };
    }
    mySolved = 0; myAttempts = 0; finished = false; round = null; order = null;
    try {
      await fb.set(`/rooms/${code}/players`, players);
      await fb.set(`/rooms/${code}/winnerUid`, '');
      await fb.set(`/rooms/${code}/seed`, (Math.random() * 2 ** 31) | 0);
      await fb.set(`/rooms/${code}/status`, 'lobby');
    } catch { /* onValue resync */ }
  }

  // ---- small helpers -------------------------------------------------------
  function errorBox(msg) { return el('p', { class: 'placeholder-text' }, msg); }
  function backBtn(fn) { return el('button', { class: 'btn-secondary', onClick: fn }, '\u2190 Back'); }

  return {
    destroy() {
      destroyed = true;
      try { unsub && unsub(); } catch { /* ok */ }
      try { if (fb && code && me) fb.set(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
      clear(mount);
    },
  };
}
