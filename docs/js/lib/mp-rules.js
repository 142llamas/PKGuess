/**
 * @file        docs/js/lib/mp-rules.js
 * @version     1.0.0
 * @updated     2026-06-26
 * @changelog
 *   1.0.0 — Pure, DOM-free, Firebase-free multiplayer rules, ported from the
 *           hot-seat controller so online & hot-seat share ONE source of truth
 *           (SPEC §5/§6). The online controller keeps only *shared* state in
 *           Firebase (seed, settings, players, turnOrder, roundNum, pool, phase,
 *           revealedClueIds[], guessLog[]) and DERIVES the mystery + clue values
 *           locally via buildEngine(seed) + replaying revealedClueIds. The answer
 *           is therefore NEVER transmitted — every client computes the same round
 *           from the same seed.
 *
 * Exports (SPEC §6): seedFor, buildEngine, revealOutcome, guessOutcome,
 *   nextTurnPos, champion, makeRoomCode. Plus: weightedRandomClue,
 *   advanceAfterWin, applyReveals (helpers the controller needs).
 */

import { PokeGuessRound, normalizeName } from './engine.js';

// ---- deterministic seeds ----------------------------------------------------
/** Stable uint32 from a room seed + round (+ optional salt e.g. reveal index). */
export function seedFor(roomSeed, roundNum, salt = 0) {
  let h = (roomSeed >>> 0) || 0x9e3779b9;
  for (const n of [roundNum, salt, 0x85ebca6b]) {
    h = (Math.imul(h ^ (n >>> 0), 2654435761) + 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const poolFor = (pokedex, poolFilter) => (pokedex || []).filter((p) => {
  const n = parseInt(p.num, 10);
  if (poolFilter === 'gen1') return n >= 1 && n <= 151;
  if (poolFilter === 'gen2') return n >= 152 && n <= 251;
  return n >= 1 && n <= 251;
});

/**
 * Build the round for a given seed — the SAME mystery + engine for every client.
 * Mirrors the hot-seat start() (custom difficulty, no locks, no pre-reveals).
 * @returns {{ round: PokeGuessRound, mystery: object }}
 */
export function buildEngine({ data, movelist, seed, poolFilter = 'both', poolStart = 75 }) {
  const pool = poolFor(data.pokedex, poolFilter);
  if (!pool.length) throw new Error('no Pokémon in pool for ' + poolFilter);
  const rng = makeRng(seed >>> 0);
  const mystery = pool[Math.floor(rng() * pool.length)];
  const round = new PokeGuessRound({ genData: data, movelist: movelist || {}, rng });
  round.start({
    difficultyId: 'custom', poolFilter, mystery,
    custom: { points: poolStart, guessCost: 0, startClueMode: 'none' },
  });
  return { round, mystery };
}

/** Replay an ordered list of revealed clue ids onto a freshly-built round so a
 *  late joiner (or any client) shows identical clue values. */
export function applyReveals(round, revealedClueIds) {
  for (const id of (revealedClueIds || [])) round.buyClue(id, { auto: true });
  return round;
}

// ---- turn-by-turn rules (pure) ----------------------------------------------
/** Next seat index, wrapping. */
export function nextTurnPos(pos, n) { return n > 0 ? (pos + 1) % n : 0; }

/**
 * Shared-state delta when the active player reveals a clue. The clue VALUE is
 * computed locally by each client's engine; only ids + pool + phase are shared.
 * @returns {{ pool:number, revealedClueIds:string[], phase:string, turnHasRevealed:boolean }}
 */
export function revealOutcome(state, clueId, clueCost, gameMode) {
  const pool = Math.max(0, (state.pool ?? 0) - (clueCost || 0));
  const revealedClueIds = [...(state.revealedClueIds || []), clueId];
  const phase = gameMode === 'rtg' ? 'guess' : (state.phase || 'reveal');
  return { pool, revealedClueIds, phase, turnHasRevealed: true };
}

/**
 * Outcome of a guess (pure). On a correct guess the active player earns the
 * remaining pool; on a wrong guess the pool drops by guessCost.
 * @returns {{ correct:boolean, pool:number, earned:number }}
 */
export function guessOutcome(state, guess, mysteryName, guessCost = 0) {
  const correct = normalizeName(guess) === normalizeName(mysteryName);
  if (correct) return { correct: true, pool: state.pool ?? 0, earned: state.pool ?? 0 };
  return { correct: false, pool: Math.max(0, (state.pool ?? 0) - (guessCost || 0)), earned: 0 };
}

/** Weighted random clue pick (1/cost, same-category penalty). Pure given rng. */
export function weightedRandomClue(available, lastCat, penalty, rng) {
  if (!available.length) return null;
  const weights = available.map((c) => (1 / Math.max(1, c.cost)) * (c.cat === lastCat ? penalty : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * total;
  for (let i = 0; i < available.length; i++) { r -= weights[i]; if (r <= 0) return available[i]; }
  return available[available.length - 1];
}

/** After a win: winner rotates to the END of the order; new turn starts at 0. */
export function advanceAfterWin(turnOrder, winnerUid) {
  const order = turnOrder.filter((u) => u !== winnerUid);
  order.push(winnerUid);
  return { turnOrder: order, currentTurnPos: 0 };
}

/**
 * The champion, if any: the highest scorer at/above the win target (ties broken
 * by who is listed first). `players` may be an array or a {uid:player} map.
 * @returns the winning player object (with uid) or null.
 */
export function champion(players, winTarget) {
  const arr = Array.isArray(players)
    ? players.slice()
    : Object.entries(players || {}).map(([uid, p]) => ({ uid, ...p }));
  let best = null;
  for (const p of arr) {
    if ((p.score || 0) >= winTarget && (!best || (p.score || 0) > (best.score || 0))) best = p;
  }
  return best;
}

// ---- room codes -------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 ambiguity
/** A 6-character room code (matches the DB rule $code.length === 6). */
export function makeRoomCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}
