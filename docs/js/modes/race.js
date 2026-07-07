/**
 * @file        docs/js/modes/race.js
 * @version     2.2.0
 * @updated     2026-07-05
 * @changelog
 *   2.2.0 — Host-disconnect resilience, ported from online.js's isLeader()
 *           pattern via the newly-shared mp-rules.leaderUid() (previously a
 *           known, disclosed gap: race.js used a hard `room.hostUid ===
 *           me.uid` check everywhere). Every action previously gated on that
 *           hard check now goes through isLeader() instead: the individual
 *           and team-builder lobbies' "Start" buttons, the individual and
 *           team post-game "Start rematch" buttons, the turn-timeout/round-
 *           ending duties (maybeEndGameAsHost/maybeEndTeamGameAsHost), and
 *           the rematch-countdown resolution trigger. `room.hostUid` itself
 *           is untouched — it still identifies the original creator for the
 *           crown-icon display; only WHO currently has authority to act
 *           changes. Added a host-left banner (lobby, team lobby, and both
 *           game-over screens) telling every player when the original host
 *           has disconnected and who has taken over.
 *           Found and fixed along the way: `renderTeamGameOver()` was
 *           missing its own `bestByCol`/`worstByCol` array declaration
 *           entirely (renderGameOver's individual-mode copy had it;
 *           renderTeamGameOver's did not) — a `ReferenceError` thrown the
 *           moment BOTH teams' game-over screen tried to render. This was
 *           newly EXPOSED (not introduced) by the earlier #17 fix: before
 *           that fix, the shared cap-timer interval never correctly called
 *           team mode's own ending logic, so this exact code path was
 *           unreachable via that route. Root-caused via direct instrumentation
 *           after ruling out every host-resilience change individually as the
 *           cause (none of them were) — confirmed by reverting ALL of this
 *           entry's changes and finding race-teams.smoke.mjs's #17 assertion
 *           still failing, which is what led to finding the real bug instead
 *           of continuing to chase a false lead. Also hardened
 *           race.smoke.mjs's and race-teams.smoke.mjs's fake Firebase: a
 *           write triggered synchronously from within another write's own
 *           listener callback was being silently dropped by a bare
 *           reentrancy guard (`if (notifying) return;`) instead of queued —
 *           real Firebase is eventually consistent but never loses a write.
 *   2.1.2 — #17: startCapTimer()'s shared 1-second interval unconditionally
 *           called the INDIVIDUAL-mode renderProgressStrip()/
 *           maybeEndGameAsHost() even in a team game (both render() and
 *           renderTeam() start the SAME timer) — hijacking the standings
 *           strip with a bogus "everyone stuck at 0/target" per-player
 *           display (team progress lives in teamState, never in a player's
 *           own `solved`), and giving the game-over check no CORRECT,
 *           periodic second chance to run. Root-caused via a deterministic
 *           multi-client repro: if the reactive end-of-game write from one
 *           client's winning guess doesn't reach every other listener on the
 *           first try, an individual client could get stuck showing a stale
 *           "waiting for the other team" screen indefinitely, even though the
 *           game had genuinely ended — matching "correctly guessing the
 *           pokemon not recognized." Interval now dispatches to the correct
 *           team-aware or individual pair of functions every second, exactly
 *           like render()/renderTeam() already do, so it self-heals within a
 *           second even if a reactive update is ever missed.
 *   2.1.1 — #16: individual (non-team) room create AND join failed with "Could
 *           not create/join the room" because the player object was written with
 *           `team: undefined`, and the Firebase RTDB SDK throws synchronously on
 *           any undefined value in a set()/update(). Team mode wrote `team:null`
 *           (legal), which is why only team mode worked. Fix: omit `team` unless
 *           team mode is on. (No behavior change to team mode.)
 *   2.1.0 — #3 Team Mode: a "Team Mode" toggle on room creation; a
 *           team-builder lobby (manual assign per player + a Randomize Teams
 *           button, even split or n/n+1 for odd counts); each team shares ONE
 *           position through the mystery sequence (not per-player pacing) —
 *           everyone on the team sees the same clues, but only the member
 *           named by a rotating index may submit a guess, advancing to the
 *           next member on every correct answer. Standings show 2 team bars;
 *           "advanced to round N" toasts go to the OTHER team, not your own.
 *           Game ends once BOTH active teams finish (or the time cap hits).
 *           Results rank by team; rematch requires EVERY connected player
 *           opted in (not just 2, unlike individual Cycling Road), and
 *           preserves existing team assignments on restart. Implemented as
 *           parallel functions alongside individual mode rather than
 *           interleaved branches, to keep the already-tested individual game
 *           loop untouched.
 *   2.0.0 — Full Cycling Road rework (#1), replacing the old "buy clues, first
 *           to target wins" loop entirely:
 *           • #1a — clues are PREDETERMINED per mystery (mp-rules.buildRevealSequence,
 *             seeded from room.seed + mystery index) — every player who reaches
 *             a given mystery sees the exact same clue set in the exact same order.
 *           • #1b — the first clue shows the instant a mystery is presented;
 *             one more reveals every 5s after that (own clock per player).
 *           • #1c — correct guess advances to the next mystery independently;
 *             the live standings bar stays, plus a toast ("X advanced to round
 *             N") for every OTHER player's progress, detected by diffing solved
 *             counts across snapshots.
 *           • #1d — rooms hold up to 12; the game ends once every ACTIVE
 *             (connected, hasn't left) player has solved the target OR a
 *             room-wide time cap (target × 2 min) elapses, whichever first;
 *             Quit shows a warned confirm (results become unreachable).
 *           • #1e — results: ranked by total time (DNF/cut-off players last),
 *             a full per-mystery split table with the fastest/slowest split in
 *             EACH mystery column highlighted green/red.
 *           • #1f — players stay in a persistent post-game lobby (not kicked
 *             out) until Main Menu or leaving; Rematch is an opt-in count with
 *             a host-triggered 5s countdown that only pulls in whoever still
 *             has it selected when the countdown ends; if nobody else does,
 *             the host sees an error and returns to the main menu.
 *           Room cap raised via a join-time check (was unbounded before).
 *
 *           Testable: params._getFirebase / params._getIdentity inject fakes.
 */

import { el, clear } from '../lib/dom.js';
import { normalizeName } from '../lib/engine.js';
import { makeRoomCode, seedFor, buildRevealSequence, makeRng, leaderUid as sharedLeaderUid } from '../lib/mp-rules.js';

const MAX_PLAYERS = 12;
const REVEAL_INTERVAL_MS = 5000;
const TIME_CAP_MS_PER_MYSTERY = 120000; // 2 minutes
const REMATCH_COUNTDOWN_MS = 5000;
const TEAM_LABELS = ['\uD83D\uDD34 Team Red', '\uD83D\uDD35 Team Blue']; // #3

function buildOrder(seed, n) {
  const r = makeRng((seed >>> 0) || 0x9e3779b9);
  const idx = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}
function fmtTime(ms) {
  if (ms == null) return '\u2014';
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${String((s % 60).toFixed(1)).padStart(4, '0')}` : `${s.toFixed(1)}s`;
}
// #3b — even split if possible, n/n+1 otherwise; order is shuffled per team.
function randomizeTeams(uids, rng = Math.random) {
  const shuffled = uids.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const half = Math.ceil(shuffled.length / 2);
  return { 0: shuffled.slice(0, half), 1: shuffled.slice(half) };
}

export function createRace({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'mp-content online-root race-root' });
  clear(mount).appendChild(root);

  const getFB = params._getFirebase || (() => import('../lib/firebase.js').then((m) => m.getFirebase()));
  const getID = params._getIdentity || (() => import('../lib/identity.js').then((m) => m.getIdentity()));

  if (!Array.isArray(data.difficulties) || !Array.isArray(data.clues) || !Array.isArray(data.categories)) {
    root.append(el('p', { class: 'placeholder-text' }, 'This generation\u2019s data file is missing its clue configuration. Re-run the data pipeline and re-upload it.'),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
    return { destroy() { clear(mount); } };
  }

  const genLabel = data.id === 'gen1' ? 'Gen 1' : 'Gen 2';
  let fb = null, me = null, movelist = {};
  let code = null, room = null, unsub = null;
  let order = null;              // shared Pokémon order (indices into data.pokedex)
  let mySolved = 0;
  let mySplits = [];
  let myMysteryStartedAt = 0;
  let myRevealSeq = null;        // this mystery's predetermined [{id,value}]
  let myRevealIdx = 0;
  let revealTimer = null;
  let boardMysteryIdx = -1;      // which mystery index the CURRENT board is showing (guards double-load)
  let lastKnownSolved = {};      // uid -> last-seen solved count, for the toast
  let toastSeenOnce = false;     // suppress a toast storm on the very first snapshot
  let capTimer = null;
  let destroyed = false;

  // #3 — Teams mode kept as PARALLEL, separate state/functions rather than
  // interleaved with the above: individual Cycling Road is already tested
  // and working, and a team's progress is fundamentally shared (one position
  // per team, not per player), so trying to force both models through the
  // same variables would risk the individual mode to build the team one.
  let teamRevealSeq = null, teamRevealIdx = 0, teamRevealTimer = null;
  let teamBoardKey = null;       // `${team}:${mysteryIdx}` the CURRENT board reflects (guards double-load)
  let teamMysteryStartedAt = 0;
  let lastKnownTeamSolved = {};  // team index -> last-seen solved count, for the toast
  let teamToastSeenOnce = false;

  // ---- boot ------------------------------------------------------------------
  Promise.all([
    getFB(), getID(),
    fetch(`data/movelist-${data.id}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([fbi, idi, ml]) => {
    if (destroyed) return;
    fb = fbi; me = idi; movelist = ml || {};
    showEntry();
  }).catch(() => {
    root.append(el('p', { class: 'placeholder-text' }, 'Couldn\u2019t connect. Cycling Road needs an internet connection.'),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
  });

  function put(parent, ...kids) { clear(parent); for (const k of kids) if (k != null && k !== false) parent.appendChild(k); return parent; }
  function topbar(title) {
    return el('div', { class: 'game-topbar' },
      el('button', { class: 'btn-secondary game-exit', onClick: confirmQuit }, '\u2190 Quit'),
      el('div', { class: 'vr-topbar-center' }, el('div', { class: 'online-title' }, title), el('div', { class: 'gen-bar-label' }, genLabel)));
  }
  // #1d.ii — quitting mid-game forfeits your ability to see results; warn first.
  function confirmQuit() {
    const midGame = room && room.status === 'playing';
    const msg = midGame
      ? 'Quit Cycling Road? You won\u2019t be able to see this game\u2019s results if you leave now.'
      : 'Leave Cycling Road?';
    if (!confirm(msg)) return;
    if (midGame && fb && code && me) {
      fb.set(`/rooms/${code}/players/${me.uid}/left`, true).catch(() => {});
      fb.set(`/rooms/${code}/players/${me.uid}/connected`, false).catch(() => {});
    }
    onExit && onExit();
  }

  // ===== ENTRY / LOBBY ========================================================
  function showEntry() {
    put(root,
      topbar('\uD83C\uDFC1 Cycling Road'),
      el('div', { class: 'mp-form-section', style: { maxWidth: '420px', margin: '16px auto' } },
        el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
          'Everyone cycles through the SAME Pok\u00e9mon, in the same clue order \u2014 clues reveal automatically every few seconds. Race to solve them all fastest!'),
        el('div', { class: 'sp-start-row', style: { justifyContent: 'center' } },
          el('button', { class: 'btn-primary', onClick: showCreate }, 'Create a room'),
          el('button', { class: 'btn-secondary', onClick: showJoin }, 'Join with a code'))));
  }

  function showCreate() {
    const s = { target: 5, teams: false };
    const targetInput = el('input', { class: 'mp-input', type: 'number', min: '1', max: '50', value: '5' });
    const setT = (n) => { s.target = n; targetInput.value = String(n); };
    targetInput.addEventListener('input', () => { s.target = Math.max(1, Math.min(50, parseInt(targetInput.value, 10) || 5)); });
    const teamsBtn = el('button', { class: 'btn-secondary' }, 'Team Mode: Off');
    teamsBtn.addEventListener('click', () => { s.teams = !s.teams; teamsBtn.textContent = s.teams ? 'Team Mode: On \u2705' : 'Team Mode: Off'; teamsBtn.classList.toggle('active', s.teams); });
    put(root,
      topbar('\uD83C\uDFC1 Create Cycling Road'),
      el('div', { class: 'mp-form-section', style: { maxWidth: '420px', margin: '16px auto' } },
        el('div', { class: 'mp-form-label' }, 'How many Pok\u00e9mon in this race?'),
        el('div', { class: 'sp-start-row' },
          el('button', { class: 'btn-secondary', onClick: () => setT(5) }, '5'),
          el('button', { class: 'btn-secondary', onClick: () => setT(10) }, '10')),
        el('div', { class: 'mp-form-label', style: { marginTop: '10px' } }, 'Or set a custom number'),
        targetInput,
        el('div', { class: 'mp-form-label', style: { marginTop: '14px' } }, '\uD83E\uDD1D Team Mode'),
        el('p', { class: 'identity-hint' }, '2 teams share one position through the mysteries \u2014 only one member per team answers at a time, rotating after each correct guess.'),
        teamsBtn,
        el('p', { class: 'identity-hint' }, `Up to ${MAX_PLAYERS} players \u00b7 time limit = target \u00d7 2 minutes.`),
        el('div', { class: 'sp-start-row', style: { marginTop: '14px' } },
          el('button', { class: 'btn-secondary', onClick: showEntry }, '\u2190 Back'),
          el('button', { class: 'btn-primary', onClick: () => createRoom(s) }, 'Create room'))));
  }

  async function createRoom(settings) {
    code = makeRoomCode();
    const seed = (Math.random() * 2 ** 31) | 0;
    // #16 — NEVER put `undefined` in a value written to Firebase: the RTDB SDK
    // throws synchronously on any undefined child, which is what made individual
    // (non-team) room creation fail while team mode (team:null) worked. Only set
    // `team` when team mode is on; otherwise omit the key entirely.
    const player = { name: me.name, connected: true, left: false, solved: 0, splits: [], finishedAt: null, rematch: false, joinedAt: Date.now() };
    if (settings.teams) player.team = null; // #3 — unassigned until the lobby team-builder sets it
    const initial = {
      code, seed, game: 'race', hostUid: me.uid, status: 'lobby', settings,
      players: { [me.uid]: player }, joinOrder: [me.uid],
      gameStartedAt: null, rematchCountdownEndsAt: null,
      teamState: settings.teams ? [
        { solved: 0, splits: [], answererIdx: 0, memberOrder: [], finishedAt: null },
        { solved: 0, splits: [], answererIdx: 0, memberOrder: [], finishedAt: null },
      ] : null,
    };
    try { await fb.set(`/rooms/${code}`, initial); attach(); }
    catch { put(root, topbar('\uD83C\uDFC1 Cycling Road'), errorBox('Could not create the room. Try again.'), backBtn(showEntry)); }
  }

  function showJoin() {
    const input = el('input', { class: 'mp-input', maxlength: '6', placeholder: 'ABC123', style: { textTransform: 'uppercase' } });
    const err = el('div', { class: 'mp-error' });
    put(root,
      topbar('\uD83C\uDFC1 Join Cycling Road'),
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
    if (snap.status === 'playing' && !rejoin) { err.textContent = 'That race already started.'; return; }
    // #1d — room cap of 12 (new joiners only; a rejoining player is always let back in).
    const activeCount = Object.values(snap.players || {}).filter((p) => p && p.connected && !p.left).length;
    if (!rejoin && activeCount >= MAX_PLAYERS) { err.textContent = `This room is full (${MAX_PLAYERS}/${MAX_PLAYERS}).`; return; }
    code = c;
    try {
      if (!rejoin) {
        // #16 — same undefined-in-Firebase pitfall as createRoom(): omit `team`
        // entirely for individual mode instead of writing `undefined`.
        const player = { name: me.name, connected: true, left: false, solved: 0, splits: [], finishedAt: null, rematch: false, joinedAt: Date.now() };
        if (snap.settings.teams) player.team = null;
        await fb.update(`/rooms/${code}/players/${me.uid}`, player);
        await fb.set(`/rooms/${code}/joinOrder`, [...(snap.joinOrder || []), me.uid]);
      } else {
        await fb.update(`/rooms/${code}/players/${me.uid}`, { connected: true, left: false });
      }
      attach();
    } catch { err.textContent = 'Could not join. Try again.'; }
  }

  function attach() {
    try { fb.onDisconnectSet(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
    unsub = fb.onValue(`/rooms/${code}`, (snap) => {
      if (destroyed) return;
      room = snap;
      if (!room) { put(root, topbar('\uD83C\uDFC1 Cycling Road'), errorBox('The room was closed.'), backBtn(showEntry)); return; }
      render();
    });
  }

  function connectedPlayers() {
    const jo = room.joinOrder || Object.keys(room.players || {});
    return jo.map((uid) => ({ uid, ...(room.players[uid] || {}) })).filter((p) => p.name);
  }
  function activePlayers() { return connectedPlayers().filter((p) => p.connected && !p.left); }

  // ---- host-disconnect resilience --------------------------------------------
  // Ported from online.js's isLeader() pattern, via the SHARED leaderUid() in
  // mp-rules.js so the two controllers can't drift apart on this. Every
  // previously-hard `room.hostUid === me.uid` check that GATES an action
  // (starting the game/rematch, the turn-timeout/round-advance/rematch-
  // resolution duties) now goes through this instead, so the room survives
  // the original host disconnecting rather than getting permanently stuck.
  // `room.hostUid` itself is left untouched — it still identifies the
  // original creator for the crown-icon display.
  const leaderUid = () => sharedLeaderUid(room);
  const isLeader = () => room && leaderUid() === me.uid;
  const hostHasLeft = () => room && room.hostUid && room.players && room.players[room.hostUid] && !room.players[room.hostUid].connected;
  function hostLeftBanner() {
    if (!hostHasLeft()) return null;
    const origHost = room.players[room.hostUid];
    const leader = leaderUid();
    const leaderName = leader === me.uid ? 'you are' : `${(room.players[leader] || {}).name || 'another player'} is`;
    return el('div', { class: 'host-left-banner' },
      `\u26A0\uFE0F ${origHost.name || 'The host'} has disconnected \u2014 ${leaderName} now in control.`);
  }

  // ===== RENDER ROUTING ========================================================
  let waitingScreenShown = false;
  function render() {
    if (room.status === 'lobby') { stopCapTimer(); return renderLobby(); }
    if (room.status === 'gameOver') { stopCapTimer(); return room.settings.teams ? renderTeamGameOver() : renderGameOver(); }
    if (room.settings.teams) { renderTeam(); return; }
    // playing (individual mode)
    if (!order) order = buildOrder(room.seed, data.pokedex.length);
    detectProgressToasts();
    if (boardMysteryIdx !== mySolved && !finishedLocally()) {
      loadMystery(); // builds a fresh board for the NEW mystery
    } else if (finishedLocally()) {
      if (!waitingScreenShown) { waitingScreenShown = true; renderWaitingForOthers(); }
    }
    // else: the board already correctly reflects local state — rebuilding it
    // on every remote snapshot would wipe whatever the player is mid-typing
    // in the guess box, so only the targeted bits below get refreshed.
    renderProgressStrip();
    startCapTimer();
    maybeEndGameAsHost();
  }
  function finishedLocally() { return mySolved >= (room.settings.target || 0); }

  function renderLobby() {
    if (room.settings.teams) return renderTeamLobby();
    const players = connectedPlayers();
    const isHost = isLeader();
    const canStart = isHost && players.filter((p) => p.connected).length >= 1;
    put(root,
      topbar('\uD83C\uDFC1 Cycling Road Lobby'),
      el('div', { class: 'online-room-meta' },
        el('div', { class: 'online-code-big' }, `Code: ${code}`),
        el('div', { class: 'sf-intro' }, `${room.settings.target} Pok\u00e9mon \u00b7 ${genLabel} \u00b7 ${players.length}/${MAX_PLAYERS} in the room`)),
      hostLeftBanner(),
      el('div', { class: 'online-players' },
        ...players.map((p) => el('div', { class: 'online-player' + (p.connected ? '' : ' offline') },
          el('span', {}, p.name + (p.uid === room.hostUid ? ' \uD83D\uDC51' : '') + (p.uid === me.uid ? ' (you)' : '')),
          el('span', { class: 'online-player-state' }, p.connected ? 'ready' : 'offline')))),
      isHost
        ? el('div', { class: 'sp-start-row', style: { justifyContent: 'center', marginTop: '16px' } },
            el('button', { class: 'btn-primary', disabled: !canStart, style: canStart ? {} : { opacity: 0.5 }, onClick: startGame },
              canStart ? 'Start \u25b6' : 'Waiting for players\u2026'))
        : el('div', { class: 'sf-intro', style: { textAlign: 'center', marginTop: '16px' } }, 'Waiting for the host to start\u2026'));
  }

  // #3b — team-builder lobby: assign players to Team Red/Blue, or randomize.
  function renderTeamLobby() {
    const players = connectedPlayers();
    const isHost = isLeader();
    const teamOf = (uid) => { const p = room.players[uid]; return p ? p.team : null; };
    const unassigned = players.filter((p) => p.connected && teamOf(p.uid) == null);
    const teamRoster = (t) => players.filter((p) => teamOf(p.uid) === t);
    const canStart = isHost && unassigned.length === 0
      && teamRoster(0).some((p) => p.connected) && teamRoster(1).some((p) => p.connected);

    const playerRow = (p, showMoveButtons) => el('div', { class: 'online-player' + (p.connected ? '' : ' offline') },
      el('span', {}, p.name + (p.uid === room.hostUid ? ' \uD83D\uDC51' : '') + (p.uid === me.uid ? ' (you)' : '')),
      isHost && showMoveButtons ? el('span', { style: { display: 'flex', gap: '4px' } },
        teamOf(p.uid) !== 0 ? el('button', { class: 'btn-secondary', style: { fontSize: '10px', padding: '3px 7px' }, onClick: () => assignTeam(p.uid, 0) }, TEAM_LABELS[0]) : null,
        teamOf(p.uid) !== 1 ? el('button', { class: 'btn-secondary', style: { fontSize: '10px', padding: '3px 7px' }, onClick: () => assignTeam(p.uid, 1) }, TEAM_LABELS[1]) : null,
        teamOf(p.uid) != null ? el('button', { class: 'btn-secondary', style: { fontSize: '10px', padding: '3px 7px' }, onClick: () => assignTeam(p.uid, null) }, 'Unassign') : null)
        : el('span', { class: 'online-player-state' }, p.connected ? 'ready' : 'offline'));

    put(root,
      topbar('\uD83C\uDFC1 Cycling Road Lobby \u2014 Team Mode'),
      el('div', { class: 'online-room-meta' },
        el('div', { class: 'online-code-big' }, `Code: ${code}`),
        el('div', { class: 'sf-intro' }, `${room.settings.target} Pok\u00e9mon \u00b7 ${genLabel} \u00b7 ${players.length}/${MAX_PLAYERS} in the room`)),
      hostLeftBanner(),
      isHost ? el('div', { class: 'sp-start-row', style: { justifyContent: 'center', margin: '10px 0' } },
        el('button', { class: 'btn-secondary', onClick: randomizeTeamsNow }, '\uD83C\uDFB2 Randomize Teams')) : null,
      unassigned.length ? el('div', { class: 'identity-section' },
        el('div', { class: 'identity-label' }, `Unassigned (${unassigned.length})`),
        ...unassigned.map((p) => playerRow(p, true))) : null,
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' } },
        el('div', { class: 'identity-section' }, el('div', { class: 'identity-label' }, `${TEAM_LABELS[0]} (${teamRoster(0).length})`), ...teamRoster(0).map((p) => playerRow(p, true))),
        el('div', { class: 'identity-section' }, el('div', { class: 'identity-label' }, `${TEAM_LABELS[1]} (${teamRoster(1).length})`), ...teamRoster(1).map((p) => playerRow(p, true)))),
      isHost
        ? el('div', { class: 'sp-start-row', style: { justifyContent: 'center', marginTop: '16px' } },
            el('button', { class: 'btn-primary', disabled: !canStart, style: canStart ? {} : { opacity: 0.5 }, onClick: startGame },
              canStart ? 'Start \u25b6' : (unassigned.length ? 'Assign everyone to a team first\u2026' : 'Both teams need at least 1 player\u2026')))
        : el('div', { class: 'sf-intro', style: { textAlign: 'center', marginTop: '16px' } }, 'Waiting for the host to start\u2026'));
  }

  async function assignTeam(uid, team) {
    try { await fb.set(`/rooms/${code}/players/${uid}/team`, team); } catch { /* onValue resyncs */ }
  }

  async function randomizeTeamsNow() {
    const uids = connectedPlayers().filter((p) => p.connected).map((p) => p.uid);
    const split = randomizeTeams(uids);
    const updates = {};
    for (const uid of split[0]) updates[uid] = 0;
    for (const uid of split[1]) updates[uid] = 1;
    try { await Promise.all(Object.entries(updates).map(([uid, t]) => fb.set(`/rooms/${code}/players/${uid}/team`, t))); } catch { /* onValue resyncs */ }
  }

  async function startGame() {
    mySolved = 0; mySplits = []; boardMysteryIdx = -1; order = null; lastKnownSolved = {}; toastSeenOnce = false; waitingScreenShown = false;
    teamRevealSeq = null; teamRevealIdx = 0; teamBoardKey = null; lastKnownTeamSolved = {}; teamToastSeenOnce = false;
    try {
      const updates = { status: 'playing', gameStartedAt: Date.now() };
      if (room.settings.teams) {
        const jo = room.joinOrder || Object.keys(room.players);
        const teamOf = (uid) => room.players[uid] && room.players[uid].team;
        updates.teamState = [
          { solved: 0, splits: [], answererIdx: 0, memberOrder: jo.filter((uid) => teamOf(uid) === 0), finishedAt: null },
          { solved: 0, splits: [], answererIdx: 0, memberOrder: jo.filter((uid) => teamOf(uid) === 1), finishedAt: null },
        ];
      }
      await fb.update(`/rooms/${code}`, updates);
    } catch { /* onValue re-renders once it lands */ }
  }

  // ===== PER-MYSTERY BOARD =====================================================
  function loadMystery() {
    stopRevealTimer();
    const idx = mySolved;
    boardMysteryIdx = idx;
    const poke = data.pokedex[order[idx % order.length]];
    myRevealSeq = buildRevealSequence({ data, movelist, mystery: poke, seed: seedFor(room.seed, idx) });
    myRevealIdx = 0;
    myMysteryStartedAt = Date.now();
    renderBoard();
    revealNext(); // #1b — the first clue shows immediately when the mystery is presented
    revealTimer = setInterval(revealNext, REVEAL_INTERVAL_MS);
  }
  function stopRevealTimer() { if (revealTimer) { clearInterval(revealTimer); revealTimer = null; } }
  function revealNext() {
    if (myRevealIdx >= myRevealSeq.length) { stopRevealTimer(); return; }
    myRevealIdx++;
    renderRevealed();
  }

  function renderBoard() {
    const target = room.settings.target;
    if (finishedLocally()) { renderWaitingForOthers(); return; }
    const board = el('div', { class: 'race-board' });
    board.append(
      el('div', { class: 'race-head' },
        el('div', { class: 'race-solved' }, `Pok\u00e9mon ${mySolved + 1} / ${target}`),
        el('div', { class: 'race-mystery' }, `\u23F1\uFE0F next clue every 5s`)),
      el('div', { class: 'race-feedback', id: 'race-feedback' }),
      guessRow(),
      el('div', { class: 'revealed-summary', id: 'race-revealed' }),
      el('div', { class: 'race-toasts', id: 'race-toasts' }));
    put(root, topbar('\uD83C\uDFC1 Cycling Road'), board, el('div', { class: 'race-progress', id: 'race-progress' }));
    renderRevealed();
  }

  function renderWaitingForOthers() {
    put(root, topbar('\uD83C\uDFC1 Cycling Road'),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card', style: { textAlign: 'center' } },
          el('div', { class: 'summary-result' }, '\u2705 You finished!'),
          el('p', { class: 'sf-intro' }, 'Waiting for the rest of the room to finish (or the time limit to hit)\u2026'))),
      el('div', { class: 'race-progress', id: 'race-progress' }));
  }

  function guessRow() {
    const listId = 'race-names';
    const dl = el('datalist', { id: listId }, ...data.pokedex.map((p) => el('option', { value: p.name })));
    const input = el('input', { class: 'mp-input', list: listId, placeholder: 'Guess the Pok\u00e9mon\u2026', id: 'race-guess' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });
    return el('div', { class: 'race-guess-row' }, dl, input,
      el('button', { class: 'btn-primary', onClick: submitGuess }, 'Guess'));
  }

  async function submitGuess() {
    const input = root.querySelector('#race-guess'); if (!input) return;
    const val = String(input.value || '').trim();
    if (!val) return;
    const poke = data.pokedex[order[mySolved % order.length]];
    if (!data.pokedex.some((p) => normalizeName(p.name) === normalizeName(val))) { feedback('Pick a Pok\u00e9mon from the list.', '#e0a060'); return; }
    if (normalizeName(val) !== normalizeName(poke.name)) {
      input.value = '';
      feedback('\u274C Not quite!', '#e06060');
      return;
    }
    await solveMystery();
  }

  function feedback(msg, color) {
    const fb0 = root.querySelector('#race-feedback'); if (!fb0) return;
    fb0.textContent = msg; fb0.style.color = color || 'var(--text-secondary)';
  }

  function renderRevealed() {
    const box = root.querySelector('#race-revealed'); if (!box) return;
    clear(box);
    if (!myRevealIdx) { box.append(el('div', { class: 'rev-empty' }, 'The first clue is loading\u2026')); return; }
    box.append(el('div', { class: 'rev-cat-label' }, 'Revealed'));
    for (let i = 0; i < myRevealIdx; i++) {
      const r = myRevealSeq[i];
      const clue = data.clues.find((c) => c.id === r.id);
      box.append(el('div', { class: 'rev-item' + (i === myRevealIdx - 1 ? ' rev-new' : '') },
        el('span', { class: 'rev-item-name' }, clue ? clue.name : `#${r.id}`),
        el('span', { class: 'rev-item-value' }, r.value)));
    }
  }

  // ---- advance ---------------------------------------------------------------
  async function solveMystery() {
    stopRevealTimer();
    const elapsed = Date.now() - myMysteryStartedAt;
    mySplits.push(elapsed);
    mySolved++;
    feedback(`\u2705 Solved! (${fmtTime(elapsed)})`, '#50cc80');
    const willFinish = mySolved >= room.settings.target;
    try {
      await fb.update(`/rooms/${code}/players/${me.uid}`, {
        solved: mySolved, splits: mySplits.slice(),
        finishedAt: willFinish ? Date.now() : null,
      });
    } catch { /* keep playing locally; onValue resyncs */ }
    setTimeout(() => { if (!destroyed && room && room.status === 'playing') render(); }, 500);
  }

  // ---- "X advanced to round N" toast (#1c.i) ---------------------------------
  function detectProgressToasts() {
    const wasFirstRun = !toastSeenOnce;
    toastSeenOnce = true;
    for (const p of connectedPlayers()) {
      const prev = lastKnownSolved[p.uid];
      const cur = p.solved || 0;
      if (!wasFirstRun && p.uid !== me.uid && prev != null && cur > prev) {
        showToast(`${p.name} has advanced to round ${cur + 1}`);
      }
      lastKnownSolved[p.uid] = cur;
    }
  }
  function showToast(msg) {
    const box = root.querySelector('#race-toasts'); if (!box) return;
    const t = el('div', { class: 'race-toast' }, msg);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('fade'); setTimeout(() => t.remove(), 400); }, 3200);
  }

  // ---- live standings ---------------------------------------------------------
  function renderProgressStrip() {
    const strip = root.querySelector('#race-progress'); if (!strip || !room) return;
    clear(strip);
    const target = room.settings.target;
    strip.append(el('div', { class: 'rev-cat-label' }, 'Standings'));
    connectedPlayers()
      .slice().sort((a, b) => (b.solved || 0) - (a.solved || 0))
      .forEach((p) => {
        const pct = Math.min(100, Math.round(((p.solved || 0) / target) * 100));
        strip.append(el('div', { class: 'race-bar-row' },
          el('span', { class: 'race-bar-name' }, p.name + (p.uid === me.uid ? ' (you)' : '') + (p.left ? ' (left)' : '')),
          el('div', { class: 'race-bar-track' }, el('div', { class: 'race-bar-fill', style: { width: pct + '%' } })),
          el('span', { class: 'race-bar-count' }, `${p.solved || 0}/${target}`)));
      });
    if (room.gameStartedAt) {
      const capMs = target * TIME_CAP_MS_PER_MYSTERY;
      const remain = Math.max(0, capMs - (Date.now() - room.gameStartedAt));
      strip.append(el('div', { class: 'race-timecap' }, `\u23F3 Time remaining: ${fmtTime(remain)}`));
    }
  }

  // ---- room-wide ending conditions (#1d.i) — host-driven, idempotent --------
  // #17 — this interval used to unconditionally call the INDIVIDUAL-mode
  // renderProgressStrip()/maybeEndGameAsHost(), even in team games (both
  // render() and renderTeam() start the SAME capTimer). In a team game every
  // PLAYER's own `solved` field is never touched (team progress lives at
  // room.teamState[team].solved instead), so this was hijacking the shared
  // #race-progress element once a second with a bogus "everyone at 0/target"
  // individual standings display, and running an irrelevant individual
  // game-over check. Now dispatches the same way render()/renderTeam() do.
  function startCapTimer() {
    if (capTimer) return;
    capTimer = setInterval(() => {
      if (destroyed || !room || room.status !== 'playing') return;
      if (room.settings.teams) { renderTeamProgressStrip(); maybeEndTeamGameAsHost(); }
      else { renderProgressStrip(); maybeEndGameAsHost(); }
    }, 1000);
  }
  function stopCapTimer() { if (capTimer) { clearInterval(capTimer); capTimer = null; } }

  function maybeEndGameAsHost() {
    if (!room || room.status !== 'playing' || !isLeader() || !room.gameStartedAt) return;
    const target = room.settings.target;
    const capMs = target * TIME_CAP_MS_PER_MYSTERY;
    const capHit = Date.now() - room.gameStartedAt >= capMs;
    const active = activePlayers();
    const allFinished = active.length > 0 && active.every((p) => (p.solved || 0) >= target);
    if (capHit || allFinished) {
      fb.set(`/rooms/${code}/status`, 'gameOver').catch(() => {});
    }
  }

  // ===== GAME OVER + PERSISTENT POST-GAME LOBBY (#1e/#1f) ======================
  function renderGameOver() {
    const target = room.settings.target;
    const players = connectedPlayers();
    const finished = players.filter((p) => p.finishedAt);
    const unfinished = players.filter((p) => !p.finishedAt);
    const totalTime = (p) => (p.splits || []).reduce((a, b) => a + b, 0);
    const ranked = [
      ...finished.slice().sort((a, b) => totalTime(a) - totalTime(b)),
      ...unfinished.slice().sort((a, b) => (b.solved || 0) - (a.solved || 0)),
    ];
    const iWon = ranked[0] && ranked[0].uid === me.uid && ranked[0].finishedAt;
    const isHost = isLeader();
    const bestByCol = [], worstByCol = [];
    for (let c = 0; c < target; c++) {
      const vals = players.map((p) => (p.splits || [])[c]).filter((v) => v != null);
      bestByCol[c] = vals.length ? Math.min(...vals) : null;
      worstByCol[c] = vals.length > 1 ? Math.max(...vals) : null;
    }

    const table = el('table', { class: 'mp-history-table race-splits-table' },
      el('tr', {},
        el('th', {}, '#'), el('th', {}, 'Player'), el('th', {}, 'Total'),
        ...Array.from({ length: target }, (_, c) => el('th', {}, `#${c + 1}`))),
      ...ranked.map((p, i) => el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, p.name + (p.uid === me.uid ? ' (you)' : '')),
        el('td', {}, p.finishedAt ? fmtTime(totalTime(p)) : `DNF (${p.solved || 0}/${target})`),
        ...Array.from({ length: target }, (_, c) => {
          const v = (p.splits || [])[c];
          const cls = v == null ? '' : v === bestByCol[c] ? 'race-split-best' : (worstByCol[c] != null && v === worstByCol[c] ? 'race-split-worst' : '');
          return el('td', { class: cls }, v == null ? '\u2014' : fmtTime(v));
        }))));

    const myPlayer = room.players[me.uid] || {};
    const rematchers = players.filter((p) => p.rematch && p.connected && !p.left);
    const countdownActive = room.rematchCountdownEndsAt && room.rematchCountdownEndsAt > Date.now();

    put(root, topbar('\uD83C\uDFC1 Cycling Road \u2014 Results'),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' + (iWon ? ' win' : '') },
            el('div', { class: 'summary-result' }, iWon ? '\uD83C\uDFC6 You had the fastest time!' : `\uD83C\uDFC1 Results`)),
          el('div', { style: { overflowX: 'auto' } }, table),
          el('div', { class: 'identity-section' },
            hostLeftBanner(),
            el('div', { class: 'identity-label' }, `Lobby \u2014 ${players.filter((p) => p.connected).length}/${MAX_PLAYERS} still here`),
            el('div', { class: 'sp-start-row' },
              el('button', { class: 'btn-secondary' + (myPlayer.rematch ? ' active' : ''), onClick: toggleRematch },
                myPlayer.rematch ? '\u2705 Rematch selected' : '\uD83D\uDD01 Want a rematch?'),
              el('span', { class: 'sf-intro' }, `${rematchers.length} player${rematchers.length === 1 ? '' : 's'} want a rematch`)),
            countdownActive
              ? el('div', { class: 'race-rematch-countdown' }, rematchCountdownText())
              : (isHost
                  ? el('button', { class: 'btn-primary', style: { marginTop: '8px' },
                      disabled: !(myPlayer.rematch && rematchers.some((p) => p.uid !== me.uid)),
                      onClick: startRematchCountdown },
                      'Start rematch (5s countdown)')
                  : null)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));

    if (countdownActive) scheduleRematchTick();
  }

  function rematchCountdownText() {
    const remain = Math.max(0, room.rematchCountdownEndsAt - Date.now());
    return `\u23F3 Rematch starting in ${Math.ceil(remain / 1000)}s\u2026 (stay opted in to join)`;
  }
  let rematchTickTimer = null;
  function scheduleRematchTick() {
    if (rematchTickTimer) return;
    rematchTickTimer = setTimeout(() => {
      rematchTickTimer = null;
      if (destroyed || !room || room.status !== 'gameOver') return;
      if (room.rematchCountdownEndsAt && room.rematchCountdownEndsAt <= Date.now()) {
        if (isLeader()) resolveRematchCountdown();
      } else {
        renderGameOver();
      }
    }, 250);
  }

  async function toggleRematch() {
    const cur = (room.players[me.uid] || {}).rematch;
    try { await fb.set(`/rooms/${code}/players/${me.uid}/rematch`, !cur); } catch { /* resync via onValue */ }
  }

  async function startRematchCountdown() {
    try { await fb.set(`/rooms/${code}/rematchCountdownEndsAt`, Date.now() + REMATCH_COUNTDOWN_MS); } catch { /* resync via onValue */ }
  }

  // ===== TEAM MODE (#3) =========================================================
  // A team shares ONE position through the mystery sequence; only the member
  // named in memberOrder[answererIdx % length] may submit a guess for their
  // team. A correct guess advances the team AND rotates the answerer to the
  // next member (#3a). Everyone on the team sees the same clues (each client
  // independently computes the identical deterministic sequence, exactly like
  // individual mode does per-player) — only the ANSWERING right is gated.
  function myTeamIndex() { const p = room.players[me.uid]; return p ? p.team : null; }
  function teamState(t) { return (room.teamState && room.teamState[t]) || { solved: 0, splits: [], answererIdx: 0, memberOrder: [], finishedAt: null }; }
  function isMyTeamTurn() {
    const t = myTeamIndex(); if (t == null) return false;
    const order2 = teamState(t).memberOrder; if (!order2.length) return false;
    return order2[teamState(t).answererIdx % order2.length] === me.uid;
  }
  function teamFinishedLocally(t) { return teamState(t).solved >= (room.settings.target || 0); }
  function stopTeamRevealTimer() { if (teamRevealTimer) { clearInterval(teamRevealTimer); teamRevealTimer = null; } }

  function renderTeam() {
    const myTeam = myTeamIndex();
    if (myTeam == null) {
      put(root, topbar('\uD83C\uDFC1 Cycling Road'), errorBox('You\u2019re not assigned to a team.'), backBtn(() => onExit && onExit()));
      return;
    }
    if (!order) order = buildOrder(room.seed, data.pokedex.length);
    detectTeamProgressToasts();
    const key = `${myTeam}:${teamState(myTeam).solved}`;
    if (teamBoardKey !== key && !teamFinishedLocally(myTeam)) {
      loadTeamMystery(myTeam);
    } else if (teamFinishedLocally(myTeam)) {
      if (!waitingScreenShown) { waitingScreenShown = true; renderTeamWaitingForOthers(myTeam); }
    }
    renderTeamProgressStrip();
    startCapTimer();
    maybeEndTeamGameAsHost();
  }

  function loadTeamMystery(team) {
    stopTeamRevealTimer();
    const idx = teamState(team).solved;
    teamBoardKey = `${team}:${idx}`;
    const poke = data.pokedex[order[idx % order.length]];
    teamRevealSeq = buildRevealSequence({ data, movelist, mystery: poke, seed: seedFor(room.seed, idx) });
    teamRevealIdx = 0;
    teamMysteryStartedAt = Date.now();
    renderTeamBoard(team);
    revealNextTeam(); // #1b — same immediate-then-5s cadence as individual mode
    teamRevealTimer = setInterval(revealNextTeam, REVEAL_INTERVAL_MS);
  }
  function revealNextTeam() {
    if (teamRevealIdx >= teamRevealSeq.length) { stopTeamRevealTimer(); return; }
    teamRevealIdx++;
    renderTeamRevealed();
  }

  function renderTeamBoard(team) {
    const target = room.settings.target;
    if (teamFinishedLocally(team)) { renderTeamWaitingForOthers(team); return; }
    const ts = teamState(team);
    const myTurn = isMyTeamTurn();
    const upUid = ts.memberOrder[ts.answererIdx % ts.memberOrder.length];
    const upName = (room.players[upUid] || {}).name || '?';
    const board = el('div', { class: 'race-board' });
    board.append(
      el('div', { class: 'race-head' },
        el('div', { class: 'race-solved' }, `${TEAM_LABELS[team]} \u2014 Pok\u00e9mon ${ts.solved + 1} / ${target}`),
        el('div', { class: 'race-mystery' }, myTurn ? '\u23F1\uFE0F your turn to answer' : `\u23F1\uFE0F ${upName} is answering for your team`)),
      el('div', { class: 'race-feedback', id: 'race-feedback' }),
      myTurn ? teamGuessRow() : el('p', { class: 'mp-phase-hint' }, `Waiting for ${upName} to answer\u2026 everyone on the team can still see the clues.`),
      el('div', { class: 'revealed-summary', id: 'race-revealed' }),
      el('div', { class: 'race-toasts', id: 'race-toasts' }));
    put(root, topbar('\uD83C\uDFC1 Cycling Road'), board, el('div', { class: 'race-progress', id: 'race-progress' }));
    renderTeamRevealed();
  }

  function renderTeamWaitingForOthers(team) {
    put(root, topbar('\uD83C\uDFC1 Cycling Road'),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card', style: { textAlign: 'center' } },
          el('div', { class: 'summary-result' }, `\u2705 ${TEAM_LABELS[team]} finished!`),
          el('p', { class: 'sf-intro' }, 'Waiting for the other team to finish (or the time limit to hit)\u2026'))),
      el('div', { class: 'race-progress', id: 'race-progress' }));
  }

  function teamGuessRow() {
    const listId = 'race-names';
    const dl = el('datalist', { id: listId }, ...data.pokedex.map((p) => el('option', { value: p.name })));
    const input = el('input', { class: 'mp-input', list: listId, placeholder: 'Guess the Pok\u00e9mon\u2026', id: 'race-guess' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTeamGuess(); });
    return el('div', { class: 'race-guess-row' }, dl, input,
      el('button', { class: 'btn-primary', onClick: submitTeamGuess }, 'Guess'));
  }

  async function submitTeamGuess() {
    const input = root.querySelector('#race-guess'); if (!input) return;
    const val = String(input.value || '').trim();
    if (!val) return;
    const myTeam = myTeamIndex();
    if (!isMyTeamTurn()) return; // defensive — the input shouldn't even render otherwise
    const ts = teamState(myTeam);
    const poke = data.pokedex[order[ts.solved % order.length]];
    if (!data.pokedex.some((p) => normalizeName(p.name) === normalizeName(val))) { feedback('Pick a Pok\u00e9mon from the list.', '#e0a060'); return; }
    if (normalizeName(val) !== normalizeName(poke.name)) {
      input.value = '';
      feedback('\u274C Not quite!', '#e06060');
      return;
    }
    await solveTeamMystery(myTeam);
  }

  function renderTeamRevealed() {
    const box = root.querySelector('#race-revealed'); if (!box) return;
    clear(box);
    if (!teamRevealIdx) { box.append(el('div', { class: 'rev-empty' }, 'The first clue is loading\u2026')); return; }
    box.append(el('div', { class: 'rev-cat-label' }, 'Revealed'));
    for (let i = 0; i < teamRevealIdx; i++) {
      const r = teamRevealSeq[i];
      const clue = data.clues.find((c) => c.id === r.id);
      box.append(el('div', { class: 'rev-item' + (i === teamRevealIdx - 1 ? ' rev-new' : '') },
        el('span', { class: 'rev-item-name' }, clue ? clue.name : `#${r.id}`),
        el('span', { class: 'rev-item-value' }, r.value)));
    }
  }

  async function solveTeamMystery(team) {
    stopTeamRevealTimer();
    const elapsed = Date.now() - teamMysteryStartedAt;
    const ts = teamState(team);
    const newSolved = ts.solved + 1;
    const newSplits = [...ts.splits, elapsed];
    const willFinish = newSolved >= room.settings.target;
    feedback(`\u2705 Solved! (${fmtTime(elapsed)})`, '#50cc80');
    try {
      await fb.update(`/rooms/${code}/teamState/${team}`, {
        solved: newSolved, splits: newSplits,
        answererIdx: ts.answererIdx + 1, // #3a — next team member is up
        finishedAt: willFinish ? Date.now() : null,
      });
    } catch { /* onValue resyncs */ }
    setTimeout(() => { if (!destroyed && room && room.status === 'playing') render(); }, 500);
  }

  // ---- "Team X has advanced to round N" toast (#1c.i / #3) -------------------
  function detectTeamProgressToasts() {
    const myTeam = myTeamIndex();
    const wasFirstRun = !teamToastSeenOnce;
    teamToastSeenOnce = true;
    for (let t = 0; t < 2; t++) {
      const cur = teamState(t).solved || 0;
      const prev = lastKnownTeamSolved[t];
      if (!wasFirstRun && t !== myTeam && prev != null && cur > prev) {
        showToast(`${TEAM_LABELS[t]} has advanced to round ${cur + 1}`);
      }
      lastKnownTeamSolved[t] = cur;
    }
  }

  function renderTeamProgressStrip() {
    const strip = root.querySelector('#race-progress'); if (!strip || !room) return;
    clear(strip);
    const target = room.settings.target;
    const myTeam = myTeamIndex();
    strip.append(el('div', { class: 'rev-cat-label' }, 'Standings'));
    for (let t = 0; t < 2; t++) {
      const ts = teamState(t);
      const pct = Math.min(100, Math.round(((ts.solved || 0) / target) * 100));
      strip.append(el('div', { class: 'race-bar-row' },
        el('span', { class: 'race-bar-name' }, TEAM_LABELS[t] + (t === myTeam ? ' (you)' : '')),
        el('div', { class: 'race-bar-track' }, el('div', { class: 'race-bar-fill', style: { width: pct + '%' } })),
        el('span', { class: 'race-bar-count' }, `${ts.solved || 0}/${target}`)));
    }
    if (room.gameStartedAt) {
      const capMs = target * TIME_CAP_MS_PER_MYSTERY;
      const remain = Math.max(0, capMs - (Date.now() - room.gameStartedAt));
      strip.append(el('div', { class: 'race-timecap' }, `\u23F3 Time remaining: ${fmtTime(remain)}`));
    }
  }

  function maybeEndTeamGameAsHost() {
    if (!room || room.status !== 'playing' || !isLeader() || !room.gameStartedAt) return;
    const target = room.settings.target;
    const capMs = target * TIME_CAP_MS_PER_MYSTERY;
    const capHit = Date.now() - room.gameStartedAt >= capMs;
    const teamActive = (t) => teamState(t).memberOrder.some((uid) => { const p = room.players[uid]; return p && p.connected && !p.left; });
    const activeTeams = [0, 1].filter(teamActive);
    const allFinished = activeTeams.length > 0 && activeTeams.every((t) => (teamState(t).solved || 0) >= target);
    if (capHit || allFinished) {
      fb.set(`/rooms/${code}/status`, 'gameOver').catch(() => {});
    }
  }

  function renderTeamGameOver() {
    const target = room.settings.target;
    const totalTime = (t) => (teamState(t).splits || []).reduce((a, b) => a + b, 0);
    const ranked = [0, 1].slice().sort((a, b) => {
      const aFin = teamState(a).finishedAt, bFin = teamState(b).finishedAt;
      if (aFin && bFin) return totalTime(a) - totalTime(b);
      if (aFin) return -1;
      if (bFin) return 1;
      return (teamState(b).solved || 0) - (teamState(a).solved || 0);
    });
    const myTeam = myTeamIndex();
    const iWonTeam = ranked[0] === myTeam && teamState(ranked[0]).finishedAt;
    const isHost = isLeader();
    const bestByCol = [], worstByCol = [];
    for (let c = 0; c < target; c++) {
      const vals = [0, 1].map((t) => (teamState(t).splits || [])[c]).filter((v) => v != null);
      bestByCol[c] = vals.length ? Math.min(...vals) : null;
      worstByCol[c] = vals.length > 1 ? Math.max(...vals) : null;
    }
    const table = el('table', { class: 'mp-history-table race-splits-table' },
      el('tr', {}, el('th', {}, '#'), el('th', {}, 'Team'), el('th', {}, 'Total'),
        ...Array.from({ length: target }, (_, c) => el('th', {}, `#${c + 1}`))),
      ...ranked.map((t, i) => el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, TEAM_LABELS[t] + (t === myTeam ? ' (you)' : '')),
        el('td', {}, teamState(t).finishedAt ? fmtTime(totalTime(t)) : `DNF (${teamState(t).solved || 0}/${target})`),
        ...Array.from({ length: target }, (_, c) => {
          const v = (teamState(t).splits || [])[c];
          const cls = v == null ? '' : v === bestByCol[c] ? 'race-split-best' : (worstByCol[c] != null && v === worstByCol[c] ? 'race-split-worst' : '');
          return el('td', { class: cls }, v == null ? '\u2014' : fmtTime(v));
        }))));

    const players = connectedPlayers();
    const myPlayer = room.players[me.uid] || {};
    const allConnected = players.filter((p) => p.connected);
    const rematchers = allConnected.filter((p) => p.rematch);
    const countdownActive = room.rematchCountdownEndsAt && room.rematchCountdownEndsAt > Date.now();
    // #3b.i — Team Mode rematch requires ALL connected players (both teams in
    // full), not just 2 total the way individual Cycling Road does.
    const allOptedIn = allConnected.length > 0 && allConnected.every((p) => p.rematch);

    put(root, topbar('\uD83C\uDFC1 Cycling Road \u2014 Results'),
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' + (iWonTeam ? ' win' : '') },
            el('div', { class: 'summary-result' }, iWonTeam ? `\uD83C\uDFC6 ${TEAM_LABELS[myTeam]} had the fastest time!` : '\uD83C\uDFC1 Results')),
          el('div', { style: { overflowX: 'auto' } }, table),
          el('div', { class: 'identity-section' },
            hostLeftBanner(),
            el('div', { class: 'identity-label' }, `Lobby \u2014 ${allConnected.length} still here`),
            el('div', { class: 'sp-start-row' },
              el('button', { class: 'btn-secondary' + (myPlayer.rematch ? ' active' : ''), onClick: toggleRematch },
                myPlayer.rematch ? '\u2705 Rematch selected' : '\uD83D\uDD01 Want a rematch?'),
              el('span', { class: 'sf-intro' }, `${rematchers.length}/${allConnected.length} want a rematch (everyone must opt in)`)),
            countdownActive
              ? el('div', { class: 'race-rematch-countdown' }, rematchCountdownText())
              : (isHost
                  ? el('button', { class: 'btn-primary', style: { marginTop: '8px' }, disabled: !allOptedIn, onClick: startRematchCountdown },
                      allOptedIn ? 'Start rematch (5s countdown)' : 'Waiting for everyone to opt in\u2026')
                  : null)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));
    if (countdownActive) scheduleRematchTick();
  }

  // #3b.i — host-only, team-mode resolution: requires ALL connected players
  // opted in (checked again here defensively — the button is also disabled
  // otherwise); keeps everyone on their EXISTING team, just resets progress.
  async function resolveTeamRematchCountdown() {
    const allConnected = connectedPlayers().filter((p) => p.connected && !p.left);
    if (!allConnected.length || !allConnected.every((p) => p.rematch)) {
      try { await fb.update(`/rooms/${code}`, { rematchCountdownEndsAt: null }); } catch { /* ok */ }
      alert('Not everyone stayed opted in for a rematch.');
      onExit && onExit();
      return;
    }
    const newPlayers = {};
    for (const p of allConnected) newPlayers[p.uid] = { name: p.name, connected: true, left: false, rematch: false, joinedAt: Date.now(), team: p.team };
    const teamOf = (uid) => newPlayers[uid] && newPlayers[uid].team;
    const jo = allConnected.map((p) => p.uid);
    teamRevealSeq = null; teamRevealIdx = 0; teamBoardKey = null; lastKnownTeamSolved = {}; teamToastSeenOnce = false; waitingScreenShown = false; order = null;
    try {
      await fb.update(`/rooms/${code}`, {
        players: newPlayers, joinOrder: jo,
        teamState: [
          { solved: 0, splits: [], answererIdx: 0, memberOrder: jo.filter((uid) => teamOf(uid) === 0), finishedAt: null },
          { solved: 0, splits: [], answererIdx: 0, memberOrder: jo.filter((uid) => teamOf(uid) === 1), finishedAt: null },
        ],
        seed: (Math.random() * 2 ** 31) | 0, status: 'playing',
        gameStartedAt: Date.now(), rematchCountdownEndsAt: null,
      });
    } catch { /* onValue resyncs */ }
  }

  // #1f — host-only: resolve the countdown into either a fresh game or a cancel.
  async function resolveRematchCountdown() {
    if (room.settings.teams) return resolveTeamRematchCountdown();
    const players = connectedPlayers().filter((p) => p.rematch && p.connected && !p.left);
    if (players.length < 2) {
      try { await fb.update(`/rooms/${code}`, { rematchCountdownEndsAt: null }); } catch { /* ok */ }
      alert('Not enough players stayed opted in for a rematch.');
      onExit && onExit();
      return;
    }
    const newPlayers = {};
    for (const p of players) newPlayers[p.uid] = { name: p.name, connected: true, left: false, solved: 0, splits: [], finishedAt: null, rematch: false, joinedAt: Date.now() };
    mySolved = 0; mySplits = []; boardMysteryIdx = -1; order = null; lastKnownSolved = {}; toastSeenOnce = false; waitingScreenShown = false;
    try {
      await fb.update(`/rooms/${code}`, {
        players: newPlayers, joinOrder: players.map((p) => p.uid),
        seed: (Math.random() * 2 ** 31) | 0, status: 'playing',
        gameStartedAt: Date.now(), rematchCountdownEndsAt: null,
      });
    } catch { /* onValue resyncs */ }
  }

  // ---- small helpers -----------------------------------------------------------
  function errorBox(msg) { return el('p', { class: 'placeholder-text' }, msg); }
  function backBtn(fn) { return el('button', { class: 'btn-secondary', onClick: fn }, '\u2190 Back'); }

  return {
    destroy() {
      destroyed = true;
      stopRevealTimer();
      stopCapTimer();
      if (rematchTickTimer) { clearTimeout(rematchTickTimer); rematchTickTimer = null; }
      try { unsub && unsub(); } catch { /* ok */ }
      try { if (fb && code && me) fb.set(`/rooms/${code}/players/${me.uid}/connected`, false); } catch { /* ok */ }
      clear(mount);
    },
  };
}
