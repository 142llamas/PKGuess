/**
 * @file        docs/js/lib/mp-rules.js
 * @version     1.5.0
 * @updated     2026-07-12
 * @changelog
 *   1.5.0 — Added makeServerNow(fb): a shared factory wrapping firebase.js's
 *           server-aligned clock (falling back to Date.now() when fb is
 *           absent/predates serverNow, e.g. a test fake). Lives here, shared,
 *           so every cross-device mode (online, Cycling Road individual +
 *           team, and any future one) aligns clocks identically instead of
 *           re-defining its own guard — same "one source of truth" rationale
 *           as leaderUid/computeAutoDeducedIds. Replaced the two identical
 *           local serverNow definitions in race.js and online.js.
 *   1.4.0 — Added leaderUid(room): a single, shared host-disconnect-resilience
 *           helper (the room's original host if still connected, otherwise
 *           the earliest-joined still-connected player). Extracted from
 *           online.js's existing local implementation so race.js can use the
 *           EXACT same logic instead of a second, hand-written copy — both
 *           controllers share the identical room shape (players[uid].connected,
 *           hostUid, joinOrder), so a second implementation risked the same
 *           "two meanings drift apart" bug class as computeAutoDeducedIds/
 *           poolFilter before those were unified.
 *   1.3.1 — #8: computeAutoDeducedIds now uses the engine's EXACT evolution
 *           determination rules instead of a looser heuristic that revealed
 *           family size whenever Can Evolve OR Evolves From was known — which
 *           leaked family size after revealing "Can Evolve = No" alone (the mon
 *           could still be the final form of a 2- or 3-member family). Affects
 *           hot-seat + online (they share this helper).
 *   1.3.0 — #4: buildEngine() accepts clueMode/catDiversity (backward-compatible) so online can support By-category + real diversity. Extracted computeAutoDeducedIds — evolution auto-deduction is now ONE shared implementation used by both hot-seat and online, instead of hot-seat-only duplicated logic.
 *   1.2.0 — Exported makeRng (Cycling Road reuses it instead of duplicating). Added buildRevealSequence: deterministic, points-free clue ordering for Cycling Road (#1a) — reuses the engine’s own weighted-random algorithm rather than a second implementation, with a local repeat cap for "Reveal One Example Moveset" (which has no real exhaustion rule in the engine; every points-based mode masks that via cost, which doesn’t exist here).
 *   1.1.0 — poolFor delegates to engine.js matchesPool (#13, one source of truth).
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

import { PokeGuessRound, normalizeName, matchesPool } from './engine.js';

// ---- deterministic seeds ----------------------------------------------------
/** Stable uint32 from a room seed + round (+ optional salt e.g. reveal index). */
export function seedFor(roomSeed, roundNum, salt = 0) {
  let h = (roomSeed >>> 0) || 0x9e3779b9;
  for (const n of [roundNum, salt, 0x85ebca6b]) {
    h = (Math.imul(h ^ (n >>> 0), 2654435761) + 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const poolFor = (pokedex, poolFilter) => (pokedex || []).filter((p) => matchesPool(p.num, poolFilter));

/**
 * Build the round for a given seed — the SAME mystery + engine for every client.
 * Mirrors the hot-seat start() (custom difficulty, no locks, no pre-reveals).
 * @returns {{ round: PokeGuessRound, mystery: object }}
 */
export function buildEngine({ data, movelist, seed, poolFilter = 'both', poolStart = 75, clueMode = 'choose', catDiversity = 'free' }) {
  const pool = poolFor(data.pokedex, poolFilter);
  if (!pool.length) throw new Error('no Pokémon in pool for ' + poolFilter);
  const rng = makeRng(seed >>> 0);
  const mystery = pool[Math.floor(rng() * pool.length)];
  const round = new PokeGuessRound({ genData: data, movelist: movelist || {}, rng });
  round.start({
    difficultyId: 'custom', poolFilter, mystery, clueMode, catDiversity,
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

/**
 * Evolution auto-deduction (#4 parity, corrected in #8): given a round's
 * CURRENT revealed clues, auto-reveal (for free) any evolution-cluster clue
 * (8 familySize / 9 evoStage / 10 canEvolve / 11 evolvesFrom) whose value is
 * now *logically determined* by what's already revealed — and ONLY those.
 *
 * #8 bug it fixes: the old heuristic revealed family size whenever EITHER "Can
 * Evolve" or "Evolves From" was known, so revealing "Can Evolve = No" alone
 * leaked the family size (which could still be 1, 2, or 3 — a final evolution).
 * The determination rules below are exactly the engine's own cross-inference
 * rules (see engine.js clueAvailable): a clue is determined precisely when the
 * engine would mark it unavailable. Because of that, buyClue() will refuse to
 * apply a genuinely-determined clue (it's "unavailable" by design), so this
 * helper only ever surfaces a value the engine still permits — it can no longer
 * reveal something the player hasn't actually earned. `excludedIds` (hot-seat's
 * per-clue exclusion panel) is honored identically in hot-seat and online.
 * @returns {number[]} ids that were actually revealed
 */
export function computeAutoDeducedIds(round, excludedIds) {
  const EVO_IDS = [8, 9, 10, 11];
  const excluded = excludedIds || new Set();
  const out = [];
  // A clue is DETERMINED iff the engine's own cross-inference (engine.js) would
  // already consider it fixed by the currently-revealed clues:
  //   • stage (9)      ⟸ Can Evolve (10) AND Evolves From (11) both known
  //   • canEvolve (10) ⟸ stage (9) known           (stage alone fixes it)
  //   • evolvesFrom(11)⟸ stage (9) known
  //   • familySize (8) ⟸ stage ∈ {single-stage, middle}, OR (canEvolve=No AND evolvesFrom=No)
  //   • additionally, familySize = 1 fixes 9/10/11 (a lone standalone Pokémon)
  const determined = (id, rv) => {
    const fam = rv[8], stage = rv[9], canEvo = rv[10], evoFrom = rv[11];
    if (fam === '1' && (id === 9 || id === 10 || id === 11)) return true;
    if (id === 9) return canEvo != null && evoFrom != null;
    if (id === 10 || id === 11) return stage != null;
    if (id === 8) return stage === 'single-stage' || stage === 'middle' || (canEvo === 'No' && evoFrom === 'No');
    return false;
  };
  // Re-check after each reveal — one deduction can unlock another; the loop is
  // order-independent and bounded.
  for (let guard = 0; guard < 12; guard++) {
    let did = false;
    const rv = round.revealedClues;
    for (const id of EVO_IDS) {
      if (id in rv || excluded.has(id) || out.includes(id)) continue;
      if (!round.clue(id)) continue;
      if (!determined(id, rv)) continue;
      const res = round.buyClue(id, { auto: true }); // succeeds only if the engine still permits the reveal
      if (res.ok) { out.push(id); did = true; }
    }
    if (!did) break;
  }
  return out;
}

/**
 * Cycling Road (#1a): with no point-buying, something else has to pick which
 * clues appear and in what order. Reuses the SAME weighted-random algorithm
 * every other "Random" clue mode already uses (cheap/easy clues first,
 * category-diversity-aware) rather than inventing a second one — the only
 * difference is an effectively-infinite point budget, so the sequence runs
 * until every revealable clue for this Pokémon has been shown (respecting
 * multi-use caps and contextual dependencies) instead of stopping when points
 * run out. Fully deterministic from `seed` — every client (and a late joiner)
 * rebuilds the IDENTICAL sequence with no data sent over the wire.
 * @returns {{id:number, value:string}[]}
 */
export function buildRevealSequence({ data, movelist, mystery, seed }) {
  const rng = makeRng((seed >>> 0) || 0x9e3779b9);
  const round = new PokeGuessRound({ genData: data, movelist: movelist || {}, rng });
  round.start({
    difficultyId: 'custom', mystery, clueMode: 'random', catDiversity: 'diff',
    custom: { points: 999999, guessCost: 0, startClueMode: 'none' },
  });
  const seq = [];
  // "Reveal One Example Moveset" has no real exhaustion rule in the engine —
  // every OTHER mode self-limits it via point cost, which doesn't exist here,
  // so left unchecked it would dominate the whole sequence (confirmed: 161 of
  // 200 draws in testing). Capping repeats HERE — not in the shared engine —
  // keeps every points-based mode's behavior completely unchanged.
  const repeatCounts = {};
  const MAX_REPEATS_PER_CLUE = 3;
  const SAFETY_CAP = 200;
  let consecutiveRejects = 0;
  for (let i = 0; i < SAFETY_CAP; i++) {
    const res = round.autoRevealRandom();
    if (!res.ok) break;
    repeatCounts[res.id] = (repeatCounts[res.id] || 0) + 1;
    if (repeatCounts[res.id] > MAX_REPEATS_PER_CLUE) {
      if (++consecutiveRejects >= 8) break; // nothing new left to offer — stop spinning
      continue;
    }
    consecutiveRejects = 0;
    seq.push({ id: res.id, value: String(res.value) });
  }
  return seq;
}

// ---- turn-by-turn rules (pure) ----------------------------------------------
/** Next seat index, wrapping. */
export function nextTurnPos(pos, n) { return n > 0 ? (pos + 1) % n : 0; }

/**
 * Server-aligned clock factory for cross-device timing. Any mode that stores
 * an absolute deadline in Firebase (turn timers, round-transition or rematch
 * countdowns, room-wide time caps) MUST compare it with THIS instead of a raw
 * Date.now(): each device's own clock can be seconds off, which made
 * countdowns disagree across devices (a rematch "stuck" at 2s on one screen
 * while the other had already started; RTG turn timers 1-2s apart). The fb
 * helper (firebase.js) exposes serverNow() = Date.now() + the measured offset
 * to Firebase's server clock; this wrapper falls back to a plain local clock
 * when fb is absent or predates serverNow (e.g. a test fake), so callers never
 * need their own guard. This lives here, shared, precisely so a future
 * cross-device mode inherits correct behavior by default rather than having to
 * remember to reimplement the guard — the same "one source of truth" reason
 * leaderUid/computeAutoDeducedIds/poolFilter were unified.
 * @param {object|null} fb  the firebase helper (or a fake) — may be null early
 * @returns {() => number}  server-aligned "now" in epoch ms
 */
export function makeServerNow(fb) {
  return () => (fb && typeof fb.serverNow === 'function' ? fb.serverNow() : Date.now());
}

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

// ---- host-disconnect resilience ---------------------------------------------
/**
 * Who should currently act with host authority: the room's original host
 * (`room.hostUid`) if they're still connected, otherwise the earliest-joined
 * still-connected player (falling back to the very first joiner if somehow
 * nobody is marked connected, so this never returns null for a real room).
 * Pure function of `room` — single source of truth so online.js and race.js
 * (both hot-seat-over-Firebase controllers with the identical room shape:
 * `players[uid].connected`, `hostUid`, `joinOrder`) can't drift apart on this,
 * the way computeAutoDeducedIds/poolFilter drifted before they were unified.
 */
export function leaderUid(room) {
  if (!room || !room.players) return null;
  if (room.players[room.hostUid] && room.players[room.hostUid].connected) return room.hostUid;
  const order = room.joinOrder || Object.keys(room.players);
  for (const uid of order) if (room.players[uid] && room.players[uid].connected) return uid;
  return order[0] || null;
}
