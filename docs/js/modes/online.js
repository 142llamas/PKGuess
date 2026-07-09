/**
 * @file        docs/js/modes/online.js
 * @version     1.6.1
 * @updated     2026-07-09
 * @changelog
 *   1.6.1 — Fixed: the "Reveal Full Stat Spread" clue showed a bare number
 *           string with no HP/Atk/Def/... labels, matching the same fix in
 *           single.js/safari.js/multiplayer.js. Now uses statSpreadEl.
 *   1.6.0 — Room sharing: a "\uD83D\uDCE4 Share Room" button in the lobby builds an
 *           invite (game name, gen, RTG/GTR, win target, then a deep link) via
 *           the new shared `shareSheetEl` (dom.js) and `roomJoinLink`/
 *           `buildRoomInviteText` (share.js). Opening that link
 *           (#/online/2?code=ABCDEF, threaded through by main.js's new query-
 *           string support) lands directly on the join screen with the code
 *           already filled in \u2014 no typing needed.
 *   1.5.0 — Host-disconnect resilience, extended beyond the existing
 *           tick()-driven duties: the Lobby's "Start game" button and the
 *           post-game "Start rematch" button were both still gated by a HARD
 *           `room.hostUid === me.uid` check — meaning if the original host
 *           disconnected before ever starting the game, or during the
 *           post-game lobby before triggering a rematch, NOBODY could ever
 *           act, permanently stuck. Both now use the existing isLeader()
 *           (now backed by the shared mp-rules.leaderUid so it can't drift
 *           from race.js's copy). Also fixed a related inconsistency:
 *           resolveRematchCountdown()'s "nobody stayed opted in" alert was
 *           gated on isHost() even though this function only ever runs when
 *           isLeader() is already true (via tick()) — meaning a fallback
 *           leader resolving the cancellation wouldn't have seen the alert;
 *           now uses isLeader() consistently. isHost() itself is now unused
 *           and removed. Added a host-left banner (visible in the lobby, the
 *           main game screen, and the post-game lobby) telling every player
 *           when the original host has disconnected and who has taken over.
 *   1.4.2 — removed the "Skip guess → reveal" button from GTR's guess phase
 *           (same reasoning as multiplayer.js 1.3.2 — undermined GTR's
 *           guess-first premise). The unrelated "Skip to guess" button during
 *           the REVEAL phase is untouched (already correctly GTR-gated).
 *   1.4.1 — #19: GTR's reveal step (only reached after a wrong guess) let the
 *           SAME player reveal indefinitely — revealOutcome() just kept the
 *           phase at 'reveal' for GTR, and the turn only advanced if the
 *           player happened to click the separate "Skip to guess" button,
 *           which had no guard at all (could also end a turn with ZERO
 *           reveals). Directly matches the reported symptom: letting a turn
 *           expire, then the next player's wrong guess left them stuck
 *           revealing random clues forever. New shared
 *           applyRevealAndAdvanceIfGtr() makes GTR's reveal exactly one clue,
 *           then auto-advances the turn (mirrors the #9 fix in hot-seat's
 *           multiplayer.js); the "Skip to guess" option is suppressed during
 *           GTR's mandatory reveal.
 *           #7: the reveal-phase hints used a "↑" arrow implying the clue
 *           grid sits above this hint — only true in a stacked mobile layout.
 *           Dropped the arrow (matches the same fix in multiplayer.js).
 *   1.4.0 — #4 parity with hot-seat: added By-category clue selection, real Category Diversity (Force-Different/Cycle-All), the per-clue "Clue Availability" exclusion panel, and evolution auto-deduction — none of these existed in online at all before. Also fixed the SAME multi-use-clue bug found in multiplayer.js: Random/By-category reveal pools were permanently dropping a multi-use clue (e.g. Reveal One Weakness) after its first use instead of respecting its real cap. Known remaining gap: online’s clue cards use their own `.online-clue` CSS rather than the shared `.clue-btn` styling hot-seat uses, so they now BEHAVE identically but don’t yet LOOK pixel-identical — a further visual-unification pass would need to touch the card DOM structure, which felt like too much additional risk to bundle into the same change.
 *   1.3.0 — #2/#1f: persistent post-game lobby + opt-in rematch with a host-triggered 5s countdown (leader-driven resolution, resilient to the host disconnecting), replacing the old immediate one-click "Play again" that also never reset scores. "Leave room" → "Main menu".
 *   1.2.0 — #17: online never touched the catch tracker — every client now marks Caught/Seen for itself when a round resolves (via renderRoundOver/renderGameOver) or when leaving mid-round.
 *   1.1.0 — Gen II room setting now pulls the full dex via poolFilterForData (#13); dropped the now-redundant "Both" generation option.
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

import { el, clear, shareSheetEl, statSpreadEl } from '../lib/dom.js';
import {
  seedFor, buildEngine, applyReveals, revealOutcome, guessOutcome,
  nextTurnPos, weightedRandomClue, advanceAfterWin, champion, makeRoomCode, computeAutoDeducedIds,
  leaderUid as sharedLeaderUid,
} from '../lib/mp-rules.js';
import { normalizeName, poolFilterForData } from '../lib/engine.js';
import { markCaught, markSeen } from '../lib/catch-tracker.js';
import { roomJoinLink, buildRoomInviteText, copyToClipboard, shareWhatsApp } from '../lib/share.js';

const COLORS = ['#f5c518', '#4a9eff', '#35c759', '#ff5a5a', '#b06bff', '#ff9f40'];
const GRACE_MS = 2000;          // leader waits this long past the deadline before skipping
const ADVANCE_MS = 5000;        // round-over → next round
const TICK_MS = 1000;
const TURN_MS = 60000;          // 60s per turn (chosen)
const REMATCH_COUNTDOWN_MS = 5000; // #1f/#2

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
    // A shared room-invite link (#/online/2?code=ABCDEF) pre-fills the join
    // screen so the recipient doesn't have to type the code themselves.
    const invitedCode = params.query && params.query.code;
    if (invitedCode) showJoin(invitedCode); else showEntry();
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

  function excludedSet() { return new Set((room && room.settings && room.settings.excludedIds) || []); }

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
      poolFilter: poolFilterForData(gen), poolStart: room.settings.poolStart,
      clueMode: room.settings.clueMode, catDiversity: room.settings.catDiversity || 'free',
    });
    applyReveals(round, revIds);
    engineCache = { roundNum: room.roundNum, gen, revLen: revIds.length, round, mystery };
    return engineCache;
  }

  // ---------------------------------------------------------------- role
  const activeUid = () => room && room.turnOrder && room.turnOrder[room.currentTurnPos];
  const isMyTurn = () => room && room.status === 'playing' && activeUid() === me.uid;
  const leaderUid = () => sharedLeaderUid(room);
  const isLeader = () => room && leaderUid() === me.uid;
  // Host-disconnect resilience: true once the ORIGINAL host (room.hostUid) is
  // no longer connected and a different player has taken over host duties.
  const hostHasLeft = () => room && room.hostUid && room.players && room.players[room.hostUid] && !room.players[room.hostUid].connected;
  function hostLeftBanner() {
    if (!hostHasLeft()) return null;
    const origHost = room.players[room.hostUid];
    const leader = leaderUid();
    const leaderName = leader === me.uid ? 'you are' : `${(room.players[leader] || {}).name || 'another player'} is`;
    return el('div', { class: 'host-left-banner' },
      `\u26A0\uFE0F ${origHost.name || 'The host'} has disconnected \u2014 ${leaderName} now in control.`);
  }

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
    const s = { gen: defaultGen, gameMode: 'rtg', clueMode: 'choose', catDiversity: 'free', winTarget: 150, poolStart: 75, guessCost: 0, excludedIds: new Set() };
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
        seg('Generation', 'gen', [['gen1', 'Gen I'], ['gen2', 'Gen II']]),
        seg('Turn order', 'gameMode', [['rtg', 'Reveal \u2192 Guess'], ['gtr', 'Guess \u2192 Reveal']]),
        seg('Clue picking', 'clueMode', [['choose', 'Choose'], ['random', 'Random'], ['category', 'By category']]),
        seg('Category diversity', 'catDiversity', [['free', 'Free'], ['diff', 'Force different'], ['cycle', 'Cycle all']]),
        num('Win target (pts)', 'winTarget', 10, 9999),
        num('Pool per round (pts)', 'poolStart', 10, 999),
        num('Wrong-guess cost (pts)', 'guessCost', 0, 20),
        excludeSection(s),
        el('div', { class: 'summary-actions' },
          el('button', { class: 'btn-primary', onClick: () => createRoom(s) }, 'Create room'),
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'))));
  }

  // #4 parity — hot-seat's "Clue Availability" exclusion panel, ported as-is.
  function excludeSection(s) {
    const body = el('div', { class: 'mp-exclude-body', id: 'online-excl-body', style: { display: 'none' } });
    const tog = el('button', { class: 'mp-excl-toggle',
      onClick: () => { const open = body.style.display !== 'none'; body.style.display = open ? 'none' : ''; tog.classList.toggle('open', !open); } },
      '\u2699\uFE0F Clue Availability ', el('span', { class: 'adv-arrow' }, '\u25bc'));
    for (const cat of data.categories) {
      const catClues = data.clues.filter((c) => c.cat === cat.id);
      const catBlock = el('div', { class: 'mp-excl-cat' },
        el('div', { class: 'mp-excl-cat-head', style: { color: cat.color } }, cat.name));
      for (const c of catClues) {
        const cb = el('input', { type: 'checkbox', checked: true,
          onChange: (e) => { e.target.checked ? s.excludedIds.delete(c.id) : s.excludedIds.add(c.id); } });
        catBlock.append(el('label', { class: 'mp-excl-row' }, cb, el('span', {}, c.name), el('span', { class: 'mp-excl-cost' }, `${c.cost}pt`)));
      }
      body.append(catBlock);
    }
    return el('div', { class: 'mp-form-section' }, tog, body);
  }

  async function createRoom(settings) {
    code = makeRoomCode();
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const player = { name: (me.name || 'Host').slice(0, 16), color: COLORS[0], score: 0, roundsWon: 0, connected: true, rematch: false, joinedAt: Date.now() };
    const persistedSettings = { ...settings, excludedIds: [...(settings.excludedIds || [])] };
    const initial = {
      code, seed, hostUid: me.uid, status: 'lobby', settings: persistedSettings,
      players: { [me.uid]: player }, joinOrder: [me.uid],
      turnOrder: [], currentTurnPos: 0, phase: 'reveal', pool: settings.poolStart,
      roundNum: 0, revealedClueIds: [], guessLog: [], lastRandomRevealCat: null,
      turnDeadline: 0, roundResult: null, rematchCountdownEndsAt: null, updatedAt: Date.now(),
    };
    try {
      await fb.set(`/rooms/${code}`, initial);
      await loadDataset(settings.gen);
      attach();
    } catch (e) { showFatal('Could not create room: ' + (e.message || e)); }
  }

  // ===================================================================== JOIN
  function showJoin(prefill = '') {
    let val = String(prefill || '').toUpperCase().trim().slice(0, 6);
    const input = el('input', { class: 'mp-name-input', maxlength: '6', placeholder: 'CODE', value: val, style: { textTransform: 'uppercase', letterSpacing: '4px', textAlign: 'center', fontSize: '20px' }, onInput: (e) => { val = e.target.value.toUpperCase().trim(); e.target.value = val; } });
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
        const player = { name: (me.name || 'Player').slice(0, 16), color: COLORS[idx % COLORS.length], score: 0, roundsWon: 0, connected: true, rematch: false, joinedAt: Date.now() };
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
    } else if (room.status === 'gameOver' && room.rematchCountdownEndsAt && now >= room.rematchCountdownEndsAt) {
      await resolveRematchCountdown();           // #2/#1f — same pattern as Cycling Road
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
    const elx = root.querySelector('.online-timer'); if (elx) {
      const secs = secondsLeft();
      if (secs != null) { elx.textContent = `\u23F1 ${secs}s`; elx.classList.toggle('low', secs <= 10); }
    }
    const rc = root.querySelector('.race-rematch-countdown');
    if (rc && room && room.rematchCountdownEndsAt) {
      const remain = Math.max(0, Math.ceil((room.rematchCountdownEndsAt - Date.now()) / 1000));
      rc.textContent = `\u23F3 Rematch starting in ${remain}s\u2026 (stay opted in to join)`;
    }
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
          `${room.settings.gen === 'gen1' ? 'Gen I' : 'Gen II'} \u00b7 ` +
          `${room.settings.gameMode.toUpperCase()} \u00b7 ${room.settings.clueMode} clues \u00b7 win at ${room.settings.winTarget} pts`),
        el('button', { class: 'btn-secondary', style: { marginTop: '8px' }, onClick: showShareRoom }, '\uD83D\uDCE4 Share Room'),
        el('div', { class: 'mp-form-label', style: { marginTop: '14px' } }, `Players (${n})`),
        playerList(),
        hostLeftBanner(),
        isLeader()
          ? el('button', { class: 'btn-primary', style: { marginTop: '16px', width: '100%' }, disabled: n < 2, onClick: () => startRound(1) }, n < 2 ? 'Waiting for 1+ more\u2026' : 'Start game \u25b6')
          : el('p', { class: 'mp-phase-hint', style: { marginTop: '16px' } }, 'Waiting for the host to start\u2026')));
  }

  // Room-invite share: "join my game" + a few relevant settings (kept short
  // on purpose) + a deep link that pre-fills the room code for whoever opens
  // it, so they don't have to type it in themselves.
  function showShareRoom() {
    const genLabel = room.settings.gen === 'gen1' ? 'Gen I' : 'Gen II';
    const modeLabel = room.settings.gameMode === 'rtg' ? 'Reveal, then Guess' : 'Guess, then Reveal';
    const text = buildRoomInviteText({
      gameLabel: 'PokeGuess Online',
      details: [genLabel, modeLabel, `first to ${room.settings.winTarget} pts`],
      link: roomJoinLink('online', room.settings.gen === 'gen1' ? 1 : 2, code),
    });
    showShareSheet(text);
  }

  let toast = null;
  function showShareSheet(text, copied = false) {
    if (toast) toast.remove();
    toast = shareSheetEl(text, {
      copied,
      onWhatsApp: () => shareWhatsApp(text),
      onCopy: async () => { const ok = await copyToClipboard(text); showShareSheet(text, ok); },
      onClose: () => { if (toast) { toast.remove(); toast = null; } },
    });
    root.append(toast);
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
      hostLeftBanner(),
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
    const hist = eng.round.state.clueHistory;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const clues = ds.data.clues, categories = ds.data.categories;
    const clueMode = room.settings.clueMode;
    const canReveal = mine && room.phase === 'reveal';
    const phaseLocked = !canReveal;
    const panel = el('div', { class: 'mp-clue-panel' + (clueMode === 'category' ? ' category-mode' : clueMode === 'random' ? ' random-mode' : '') });
    for (const cat of categories) {
      const catClues = clues.filter((c) => c.cat === cat.id);
      const cardsRow = el('div', { class: 'online-clue-row' }, ...catClues.map((c) => clueCard(c, eng, rv, hist, clueMode === 'choose' && canReveal)));
      if (clueMode === 'category') {
        const diversityBlocked = eng.round.categoryDiversityBlocked(cat.id);
        const excluded = excludedSet();
        const hasRevealable = catClues.some((c) => !excluded.has(c.id) && eng.round.clueAvailable(c) && room.pool >= eng.round.clueCurrentCost(c.id));
        const blocked = phaseLocked || diversityBlocked || !hasRevealable;
        const reason = phaseLocked ? '' : diversityBlocked ? (room.settings.catDiversity === 'cycle' ? 'Pick from an unused category first' : 'Pick a different category first') : 'No clues left here';
        const header = el('div', { class: 'cat-header cat-header-reveal', style: { background: cat.bg } },
          el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name),
          !phaseLocked ? el('button', { class: 'cat-reveal-btn', disabled: blocked }, blocked ? reason : '\uD83C\uDFB2 Reveal') : null);
        const section = el('div', { class: 'online-cat cat-section-clickable' + (blocked ? ' reveal-disabled' : '') }, header, cardsRow);
        if (!blocked) section.addEventListener('click', (e) => { if (e.target.closest('.online-clue-row')) return; revealFromCategory(cat.id); });
        panel.append(section);
      } else {
        panel.append(el('div', { class: 'online-cat' },
          el('div', { class: 'cat-header', style: { background: cat.bg } }, el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
          cardsRow));
      }
    }
    return panel;
  }

  function clueCard(clue, eng, rv, hist, clickable) {
    const h = hist[clue.id] || [];
    const uses = h.length;
    const isMultiUse = clue.maxUses !== 1 || clue.costIncrement > 0;
    const revealed = clue.id in rv;
    if (revealed && !isMultiUse) {
      // #6 (requested): labeled stat spread (HP/Atk/Def/...), matching
      // single.js/victoryroad.js — was a bare number string before.
      const revealedValueEl = clue.field === 'fullStats'
        ? el('div', { class: 'clue-revealed-value' }, statSpreadEl(String(rv[clue.id])))
        : el('div', { class: 'clue-revealed-value' }, String(rv[clue.id]));
      return el('div', { class: 'online-clue revealed' },
        el('div', { class: 'online-clue-top' }, el('span', { class: 'online-clue-name' }, clue.name), el('span', { class: 'clue-cost-badge' }, `${clue.cost}pt`)),
        revealedValueEl);
    }
    if (isMultiUse && eng.round.clueExhausted(clue)) {
      return el('div', { class: 'online-clue disabled' },
        el('div', { class: 'online-clue-top' }, el('span', { class: 'online-clue-name' }, clue.name), el('span', { class: 'clue-cost-badge' }, `${clue.cost}pt`)),
        el('div', { class: 'clue-unavail-note' }, '\u2717 ' + (h[h.length - 1] || 'Exhausted')));
    }
    const excluded = excludedSet();
    if (excluded.has(clue.id) || !eng.round.clueAvailable(clue)) {
      return el('div', { class: 'online-clue disabled' },
        el('div', { class: 'online-clue-top' }, el('span', { class: 'online-clue-name' }, clue.name), el('span', { class: 'clue-cost-badge' }, `${clue.cost}pt`)));
    }
    // #4 — Force-Different/Cycle-All only matter in Choose mode; Random and
    // By-category reveal through their own dedicated controls instead.
    if (clickable && eng.round.diversityBlocked(clue)) {
      return el('div', { class: 'online-clue disabled' },
        el('div', { class: 'online-clue-top' }, el('span', { class: 'online-clue-name' }, clue.name), el('span', { class: 'clue-cost-badge' }, `${clue.cost}pt`)),
        el('div', { class: 'clue-unavail-note' }, room.settings.catDiversity === 'cycle' ? 'Pick from an unused category first' : 'Pick a different category first'));
    }
    const affordable = room.pool >= eng.round.clueCurrentCost(clue.id);
    const cls = 'online-clue' + (isMultiUse && uses > 0 ? ' revealed' : '') + (clickable && affordable ? ' available' : ' disabled');
    const card = el('div', { class: cls },
      el('div', { class: 'online-clue-top' }, el('span', { class: 'online-clue-name' }, clue.name), el('span', { class: 'clue-cost-badge' }, `${eng.round.clueCurrentCost(clue.id)}pt`),
        isMultiUse && uses > 0 ? el('span', { class: 'clue-use-badge' }, `use ${uses + 1}`) : null));
    for (let i = 0; i < h.length; i++) card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } }, (i ? `#${i + 1} ` : '') + h[i]));
    if (clickable && affordable) card.addEventListener('click', () => revealClue(clue.id));
    return card;
  }

  function actionBlock(eng, mine) {
    if (!mine) return el('div', { class: 'mp-phase-hint', style: { textAlign: 'center' } }, 'Watching\u2026 it\u2019s not your turn.');
    const block = el('div', { class: 'online-action' });
    if (room.phase === 'reveal') {
      // #19 — GTR's reveal phase (only reached after a wrong guess) is now
      // exactly ONE mandatory clue, auto-advancing the turn afterward (see
      // applyRevealAndAdvanceIfGtr) — so there's nothing to "skip to guess"
      // for; showing that option was also how a turn could end with ZERO
      // reveals. RTG's own skip behavior (unreported, unrelated) is unchanged.
      const gtrForcedReveal = room.settings.gameMode === 'gtr';
      if (room.settings.clueMode === 'random') {
        put(block, el('button', { class: 'btn-bait', style: { width: '100%' }, onClick: revealRandom }, '\uD83C\uDF6F Reveal a random clue'),
          gtrForcedReveal ? null : el('button', { class: 'btn-secondary', style: { width: '100%', marginTop: '8px' }, onClick: () => skipToGuess() }, 'Skip to guess \u25b6'));
      } else if (room.settings.clueMode === 'category') {
        put(block, el('p', { class: 'mp-phase-hint' }, 'Tap a category to reveal a random clue from it'),
          gtrForcedReveal ? null : el('button', { class: 'btn-secondary', style: { width: '100%' }, onClick: () => skipToGuess() }, 'Skip to guess \u25b6'));
      } else {
        put(block, el('p', { class: 'mp-phase-hint' }, 'Tap a clue to reveal it'),
          gtrForcedReveal ? null : el('button', { class: 'btn-secondary', style: { width: '100%' }, onClick: () => skipToGuess() }, 'Skip to guess \u25b6'));
      }
    } else {
      const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
      const input = el('input', { id: 'online-typing', class: 'guess-input', type: 'text', placeholder: 'Which Pok\u00e9mon?', autocomplete: 'off', list: 'online-names', onKeydown: (e) => { if (e.key === 'Enter') doGuess(input.value); } });
      put(block,
        el('div', { class: 'guess-input-wrap' }, input, el('button', { class: 'guess-btn', onClick: () => doGuess(input.value) }, 'Guess')),
        el('datalist', { id: 'online-names' }, ...ds.data.pokedex.map((p) => el('option', { value: p.name }))));
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

  // #19 — GTR's reveal step is only ever reached after a wrong guess, and is
  // exactly ONE mandatory clue: the turn must pass immediately to the next
  // player afterward (mirrors the #9 fix in hot-seat's multiplayer.js).
  // Previously revealOutcome's phase for GTR just stayed 'reveal', so the
  // SAME player could reveal again and again, and the turn only ever advanced
  // if they happened to click the separate "Skip to guess" button — which had
  // no guard at all, so it could ALSO end a turn with zero reveals.
  async function applyRevealAndAdvanceIfGtr(out, deduced, extra = {}) {
    if (room.settings.gameMode === 'gtr') {
      const order = room.turnOrder || [];
      const pos = nextTurnPos(room.currentTurnPos || 0, order.length);
      await fb.update(`/rooms/${code}`, {
        pool: out.pool, revealedClueIds: [...out.revealedClueIds, ...deduced], ...extra,
        currentTurnPos: pos, phase: 'guess', turnDeadline: Date.now() + TURN_MS,
        updatedAt: Date.now(),
      });
    } else {
      await fb.update(`/rooms/${code}`, { pool: out.pool, revealedClueIds: [...out.revealedClueIds, ...deduced], phase: out.phase, ...extra, updatedAt: Date.now() });
    }
  }

  async function revealClue(id) {
    if (!isMyTurn() || room.phase !== 'reveal' || room.settings.clueMode !== 'choose') return;
    const excluded = excludedSet();
    if (excluded.has(id)) return;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const clue = ds.data.clues.find((c) => c.id === id);
    if (!clue || room.pool < clue.cost) return;
    // verify locally that the clue is buyable on this mystery
    const eng = localEngine();
    if (!eng.round.clueAvailable(clue)) return;
    if (eng.round.diversityBlocked(clue)) return; // #4 — Force-Different/Cycle-All apply to manual picks here too
    const out = revealOutcome({ pool: room.pool, revealedClueIds: room.revealedClueIds || [], phase: room.phase }, id, clue.cost, room.settings.gameMode);
    eng.round.buyClue(id, { auto: true });
    const deduced = computeAutoDeducedIds(eng.round, excluded); // #4 — evolution auto-deduction parity
    engineCache.roundNum = -1; // force rebuild next render
    await applyRevealAndAdvanceIfGtr(out, deduced);
  }

  async function revealRandom() {
    if (!isMyTurn() || room.phase !== 'reveal') return;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const eng = localEngine();
    const excluded = excludedSet();
    // #4 — clueAvailable() alone already correctly handles single- AND
    // multi-use exhaustion; the old `!(c.id in revealedClues)` check
    // permanently dropped a multi-use clue (e.g. Reveal One Weakness) after
    // its FIRST use instead of respecting its real cap (same bug found and
    // fixed in multiplayer.js's random/category reveal pools).
    const available = ds.data.clues.filter((c) => !excluded.has(c.id) && eng.round.clueAvailable(c) && room.pool >= eng.round.clueCurrentCost(c.id));
    if (!available.length) return skipToGuess();
    const pen = (ds.data.multiClue && ds.data.multiClue.randomRevealCategoryPenalty) ?? 0.25;
    const rng = mkRng(seedFor(room.seed, room.roundNum, (room.revealedClueIds || []).length + 1));
    const pick = weightedRandomClue(available, room.lastRandomRevealCat, pen, rng);
    const out = revealOutcome({ pool: room.pool, revealedClueIds: room.revealedClueIds || [], phase: room.phase }, pick.id, pick.cost, room.settings.gameMode);
    eng.round.buyClue(pick.id, { auto: true });
    const deduced = computeAutoDeducedIds(eng.round, excluded);
    engineCache.roundNum = -1;
    await applyRevealAndAdvanceIfGtr(out, deduced, { lastRandomRevealCat: pick.cat });
  }

  // #4 parity — "By category" clue selection (hot-seat already has this).
  async function revealFromCategory(catId) {
    if (!isMyTurn() || room.phase !== 'reveal') return;
    const ds = dsCache[room.settings.gen === 'gen1' ? 1 : 2];
    const eng = localEngine();
    if (eng.round.categoryDiversityBlocked(catId)) return;
    const excluded = excludedSet();
    const available = ds.data.clues.filter((c) => c.cat === catId && !excluded.has(c.id) && eng.round.clueAvailable(c) && room.pool >= eng.round.clueCurrentCost(c.id));
    if (!available.length) return;
    const pen = (ds.data.multiClue && ds.data.multiClue.randomRevealCategoryPenalty) ?? 0.25;
    const rng = mkRng(seedFor(room.seed, room.roundNum, (room.revealedClueIds || []).length + 1));
    const pick = weightedRandomClue(available, room.lastRandomRevealCat, pen, rng);
    const out = revealOutcome({ pool: room.pool, revealedClueIds: room.revealedClueIds || [], phase: room.phase }, pick.id, pick.cost, room.settings.gameMode);
    eng.round.buyClue(pick.id, { auto: true });
    const deduced = computeAutoDeducedIds(eng.round, excluded);
    engineCache.roundNum = -1;
    await applyRevealAndAdvanceIfGtr(out, deduced, { lastRandomRevealCat: pick.cat });
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
    // #17a/#17b — every client independently marks its own device's tracker:
    // caught if THIS player guessed it, seen (not caught) otherwise.
    if (rr.mysteryName) (rr.winnerUid === me.uid ? markCaught : markSeen)(rr.mysteryName);
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
    // #17 — the FINAL round's outcome skips renderRoundOver() entirely, so it
    // needs the same per-device catch-tracking applied here too.
    const rr = room.roundResult || {};
    if (rr.mysteryName) (rr.winnerUid === me.uid ? markCaught : markSeen)(rr.mysteryName);
    const arr = Object.entries(room.players).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => (b.score || 0) - (a.score || 0));
    const champ = arr[0];
    const connected = arr.filter((p) => p.connected);
    const rematchers = connected.filter((p) => p.rematch);
    const myPlayer = room.players[me.uid] || {};
    const countdownActive = room.rematchCountdownEndsAt && room.rematchCountdownEndsAt > Date.now();

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
          // #1f — persistent post-game lobby: players stay here until Main
          // Menu / leaving; Rematch is an opt-in count with a host-triggered
          // 5s countdown that only pulls in whoever is still opted in then.
          el('div', { class: 'identity-section' },
            hostLeftBanner(),
            el('div', { class: 'identity-label' }, `Lobby \u2014 ${connected.length} still here`),
            el('div', { class: 'sp-start-row' },
              el('button', { class: 'btn-secondary' + (myPlayer.rematch ? ' active' : ''), onClick: toggleRematch },
                myPlayer.rematch ? '\u2705 Rematch selected' : '\uD83D\uDD01 Want a rematch?'),
              el('span', { class: 'sf-intro' }, `${rematchers.length} player${rematchers.length === 1 ? '' : 's'} want a rematch`)),
            countdownActive
              ? el('div', { class: 'race-rematch-countdown' }, `\u23F3 Rematch starting in ${Math.ceil((room.rematchCountdownEndsAt - Date.now()) / 1000)}s\u2026 (stay opted in to join)`)
              : (isLeader()
                  ? el('button', { class: 'btn-primary', style: { marginTop: '8px' },
                      disabled: !(myPlayer.rematch && rematchers.some((p) => p.uid !== me.uid)),
                      onClick: startRematchCountdown },
                      'Start rematch (5s countdown)')
                  : null)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: leaveRoom }, 'Main menu')))));
  }

  async function toggleRematch() {
    const cur = (room.players[me.uid] || {}).rematch;
    try { await fb.set(`/rooms/${code}/players/${me.uid}/rematch`, !cur); } catch { /* onValue resyncs */ }
  }

  async function startRematchCountdown() {
    try { await fb.set(`/rooms/${code}/rematchCountdownEndsAt`, Date.now() + REMATCH_COUNTDOWN_MS); } catch { /* onValue resyncs */ }
  }

  // #1f — leader-driven (resilient to the host disconnecting mid-countdown,
  // matching this file's existing isLeader() pattern): resolve the countdown
  // into either a fresh game for whoever stayed opted in, or a cancellation.
  async function resolveRematchCountdown() {
    const participants = Object.entries(room.players)
      .map(([uid, p]) => ({ uid, ...p }))
      .filter((p) => p.rematch && p.connected);
    if (participants.length < 2) {
      try { await fb.update(`/rooms/${code}`, { rematchCountdownEndsAt: null }); } catch { /* ok */ }
      if (isLeader()) { alert('Not enough players stayed opted in for a rematch.'); leaveRoom(); }
      return;
    }
    const newPlayers = {};
    participants.forEach((p, i) => {
      newPlayers[p.uid] = { name: p.name, color: COLORS[i % COLORS.length], score: 0, roundsWon: 0, connected: true, rematch: false, joinedAt: Date.now() };
    });
    try {
      await fb.update(`/rooms/${code}`, {
        players: newPlayers, joinOrder: participants.map((p) => p.uid),
        turnOrder: participants.map((p) => p.uid), currentTurnPos: 0,
        seed: (Math.random() * 2 ** 31) >>> 0,
        status: 'playing', roundNum: 1, pool: room.settings.poolStart,
        phase: room.settings.gameMode === 'rtg' ? 'reveal' : 'guess',
        revealedClueIds: [], guessLog: [], lastRandomRevealCat: null,
        roundResult: null, turnDeadline: Date.now() + TURN_MS, rematchCountdownEndsAt: null,
        updatedAt: Date.now(),
      });
    } catch { /* onValue resyncs */ }
  }

  // ===================================================================== misc
  function mkRng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  async function leaveRoom() {
    // #17b — if a round is actively in progress, this device saw the mystery
    // but never caught it.
    try { const eng = room && room.status === 'playing' ? localEngine() : null; if (eng && eng.mystery) markSeen(eng.mystery.name); } catch { /* ignore */ }
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
