/**
 * PokeGuess — Draft Battle simulator (core)
 * ---------------------------------------------------------------------------
 * A deliberately SIMPLIFIED but faithful facsimile of a Gen 1 / Gen 2 battle.
 * It exists to decide who wins a fight between two "Frankenstein" drafted
 * Pokemon (arbitrary stats / types / moves), fast and deterministically, so the
 * UI can replay one battle step-by-step while the real outcome is a win-% taken
 * over many silent simulations.
 *
 * Design choices (all intentional — see the conversation that produced this):
 *   - Level 100, DV 0, no stat experience. Base stats convert with a fixed rule.
 *   - Moves used each turn are chosen at RANDOM from the mon's 4 (per spec).
 *   - Handles: STAB, per-gen type chart, crits, accuracy/miss, stat stages,
 *     major status (par/brn/psn/tox/slp/frz), flinch, confusion, drain, recoil,
 *     self-heal, high-crit moves, OHKO moves. Anything unrecognised simply deals
 *     damage (or no-ops if it has no base power) — graceful degradation.
 *   - SKIPPED on purpose: PP, multi-turn/charge/lock moves, trapping, Substitute,
 *     Counter, Transform, weather/abilities/items (none exist in gen 1/2 anyway).
 *   - Gen 1 uses a single Special stat ('spc'); gen 2 splits it ('spa'/'spd').
 *     The damage category of a move is type-based in both gens — that's already
 *     baked into each move's `cat` field by the data generator.
 *
 * No imports: the caller passes in the move-stats map and type chart (loaded
 * from movestats-genN.json / typechart-genN.json), so this module is portable
 * to the browser and trivial to unit-test in Node.
 */

// ---- tunable facsimile constants (named so they're easy to rebalance) -------
const CRIT_RATE = 0.0625;        // base crit chance (~1/16)
const CRIT_RATE_HIGH = 0.25;     // high-crit moves (Slash, Razor Leaf, ...)
const CRIT_MULT = 2.0;           // gen 1/2 crit is x2 (not the modern x1.5)
const STAB = 1.5;
const PARA_SPEED = 0.25;         // paralysis quarters speed
const PARA_FULL = 0.25;          // chance a paralysed mon can't move
const FREEZE_THAW = 0.20;        // chance a frozen mon thaws each turn
const BRN_FRACTION = 1 / 16;     // burn end-of-turn chip
const PSN_FRACTION = 1 / 8;      // poison end-of-turn chip
const TOX_FRACTION = 1 / 16;     // toxic chip, multiplied by counter
const CONFUSE_SELF = 0.33;       // chance a confused mon hits itself
const CONFUSE_BP = 40;           // self-hit power (typeless physical)
const DEFAULT_TURN_CAP = 100;
const LEVEL = 100;

// fallback for a move we somehow have no data for: a plain Normal tackle
const FALLBACK_MOVE = { bp: 50, acc: 100, type: 'Normal', cat: 'Physical', pp: 0, prio: 0 };

// Hidden Power: the draft keeps its elemental type in the name, e.g.
// "Hidden Power (Rock)". We borrow base hiddenpower stats but override the type
// (so STAB / effectiveness / immunity are correct) and the damage category,
// which in gen 1/2 is decided by the move's TYPE, not the move itself.
const HP_TYPE_RE = /^hidden power\s*\(([a-z]+)\)/i;
const GEN12_PHYSICAL_TYPES = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const gen12Category = (type) => (GEN12_PHYSICAL_TYPES.has(type) ? 'Physical' : 'Special');

// ---- tiny seeded PRNG (mulberry32) — deterministic given a seed -------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const chance = (rng, p) => rng() < p;
const randint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---- stats ------------------------------------------------------------------
// Base -> real at level 100, DV 0, no stat exp (gen 1/2). HP gets +110, rest +5.
export function toRealStats(base, gen) {
  const r = { hp: 2 * base.hp + 110, atk: 2 * base.atk + 5, def: 2 * base.def + 5, spe: 2 * base.spe + 5 };
  if (gen === 1) r.spc = 2 * base.spc + 5;
  else { r.spa = 2 * base.spa + 5; r.spd = 2 * base.spd + 5; }
  return r;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function stageMul(stage) {
  stage = clamp(stage, -6, 6);
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

export function moveId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---- combatant construction -------------------------------------------------
function makeCombatant(spec, gen, moveData) {
  const types = (spec.types || []).filter(Boolean);
  const boosts = { atk: 0, def: 0, spe: 0 };
  if (gen === 1) boosts.spc = 0; else { boosts.spa = 0; boosts.spd = 0; }
  return {
    name: spec.name,
    types,
    stats: spec.stats,            // already real stats
    maxhp: spec.stats.hp,
    hp: spec.stats.hp,
    boosts,
    status: null,                 // 'par'|'brn'|'psn'|'tox'|'slp'|'frz'
    toxCounter: 0,
    sleepTurns: 0,
    confuseTurns: 0,
    flinch: false,
    moves: (spec.moves || []).map((nm) => {
      const hp = HP_TYPE_RE.exec(nm);
      if (hp) {
        const type = hp[1].charAt(0).toUpperCase() + hp[1].slice(1).toLowerCase();
        const base = moveData['hiddenpower'] || { bp: 70, acc: 100, pp: 15, prio: 0 };
        return { name: nm, id: 'hiddenpower', ...base, type, cat: gen12Category(type) };
      }
      const id = moveId(nm);
      const data = moveData[id] || FALLBACK_MOVE;
      return { name: nm, id, ...data };
    }),
  };
}

// gen 1 collapses spa/spd boost keys onto the single special stage
function boostKey(stat, gen) {
  if (gen === 1 && (stat === 'spa' || stat === 'spd' || stat === 'spc')) return 'spc';
  return stat;
}
function specialOff(gen) { return gen === 1 ? 'spc' : 'spa'; }
function specialDef(gen) { return gen === 1 ? 'spc' : 'spd'; }

function effectiveSpeed(c) {
  let s = c.stats.spe * stageMul(c.boosts.spe);
  if (c.status === 'par') s *= PARA_SPEED;
  return s;
}

// ---- damage -----------------------------------------------------------------
function typeEffectiveness(moveType, defTypes, chart) {
  let m = 1;
  for (const t of defTypes) {
    const row = chart[moveType];
    if (row && row[t] != null) m *= row[t];
  }
  return m;
}

function calcDamage(atkr, defr, move, rng, gen, chart, log) {
  const physical = move.cat === 'Physical';
  let A, D;
  if (physical) {
    A = atkr.stats.atk * stageMul(atkr.boosts.atk);
    D = defr.stats.def * stageMul(defr.boosts.def);
    if (atkr.status === 'brn') A *= 0.5; // burn halves physical attack
  } else {
    A = atkr.stats[specialOff(gen)] * stageMul(atkr.boosts[boostKey('spa', gen)]);
    D = defr.stats[specialDef(gen)] * stageMul(defr.boosts[boostKey('spd', gen)]);
  }

  const eff = typeEffectiveness(move.type, defr.types, chart);
  if (eff === 0) { log.push({ t: 'immune', target: defr.name, move: move.name }); return 0; }

  if (move.ohko) { // one-hit KO: if it lands, it's lethal
    log.push({ t: 'ohko', target: defr.name, move: move.name });
    return defr.hp;
  }

  const crit = chance(rng, move.highCrit ? CRIT_RATE_HIGH : CRIT_RATE);
  if (crit) { A = atkr.stats[physical ? 'atk' : specialOff(gen)]; } // crit ignores boosts (facsimile)

  let dmg = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * move.bp * A) / Math.max(1, D)) / 50) + 2;
  const stab = atkr.types.includes(move.type) ? STAB : 1;
  dmg = Math.floor(dmg * stab);
  dmg = Math.floor(dmg * eff);
  if (crit) dmg = Math.floor(dmg * CRIT_MULT);
  const roll = (217 + Math.floor(rng() * 39)) / 255; // gen 1/2 random spread ~0.85–1.0
  dmg = Math.max(1, Math.floor(dmg * roll));

  log.push({
    t: 'damage', source: atkr.name, target: defr.name, move: move.name,
    amount: dmg, crit, eff,
  });
  return dmg;
}

// ---- applying a move --------------------------------------------------------
function applyBoosts(target, boosts, gen, log, who) {
  for (const [stat, delta] of Object.entries(boosts)) {
    const k = boostKey(stat, gen);
    if (target.boosts[k] == null) continue;
    const before = target.boosts[k];
    target.boosts[k] = clamp(before + delta, -6, 6);
    if (target.boosts[k] !== before) log.push({ t: 'boost', target: target.name, stat: k, delta });
  }
}

function tryStatus(target, status, rng, log) {
  if (target.status) return false;            // one major status at a time
  // simple type-based immunities for the common cases
  if ((status === 'brn') && target.types.includes('Fire')) return false;
  if ((status === 'frz') && target.types.includes('Ice')) return false;
  if ((status === 'psn' || status === 'tox') && (target.types.includes('Poison') || target.types.includes('Steel'))) return false;
  target.status = status;
  if (status === 'slp') target.sleepTurns = randint(rng, 1, 3);
  if (status === 'tox') target.toxCounter = 1;
  log.push({ t: 'status', target: target.name, status });
  return true;
}

function doMove(attacker, defender, move, rng, gen, chart, log) {
  // accuracy
  if (move.acc !== true && move.acc != null && move.acc < 100) {
    if (!chance(rng, move.acc / 100)) { log.push({ t: 'miss', source: attacker.name, move: move.name }); return; }
  }
  log.push({ t: 'use', source: attacker.name, move: move.name });

  let dealt = 0;
  if (move.cat !== 'Status' && move.bp > 0 || move.ohko) {
    dealt = calcDamage(attacker, defender, move, rng, gen, chart, log);
    defender.hp = Math.max(0, defender.hp - dealt);
  }

  // self heal (Recover / Softboiled / Rest-like)
  if (move.heal && move.cat === 'Status') {
    const heal = Math.floor(attacker.maxhp * move.heal[0] / move.heal[1]);
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxhp, attacker.hp + heal);
    if (attacker.hp !== before) log.push({ t: 'heal', target: attacker.name, amount: attacker.hp - before });
  }
  // drain (Absorb / Mega Drain / Leech Life)
  if (move.drain && dealt > 0) {
    const heal = Math.max(1, Math.floor(dealt * move.drain[0] / move.drain[1]));
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxhp, attacker.hp + heal);
    if (attacker.hp !== before) log.push({ t: 'drain', target: attacker.name, amount: attacker.hp - before });
  }
  // recoil (Double-Edge / Take Down / Submission)
  if (move.recoil && dealt > 0) {
    const r = Math.max(1, Math.floor(dealt * move.recoil[0] / move.recoil[1]));
    attacker.hp = Math.max(0, attacker.hp - r);
    log.push({ t: 'recoil', target: attacker.name, amount: r });
  }

  // guaranteed status / boosts from STATUS moves
  if (move.status && defender.hp > 0) tryStatus(defender, move.status, rng, log);
  if (move.confuse && defender.hp > 0 && defender.confuseTurns === 0) {
    defender.confuseTurns = randint(rng, 2, 4); log.push({ t: 'confuse', target: defender.name });
  }
  if (move.boosts) {
    const tgt = move.boostTarget === 'self' ? attacker : defender;
    if (tgt.hp > 0) applyBoosts(tgt, move.boosts, gen, log);
  }

  // secondary effects (from damaging moves)
  if (move.secondary && defender.hp > 0 && dealt > 0) {
    if (chance(rng, move.secondary.chance / 100)) {
      if (move.secondary.status) tryStatus(defender, move.secondary.status, rng, log);
      if (move.secondary.flinch) defender.flinch = true;
      if (move.secondary.boosts) applyBoosts(defender, move.secondary.boosts, gen, log);
      if (move.secondary.selfBoosts) applyBoosts(attacker, move.secondary.selfBoosts, gen, log);
    }
  }
}

// can this mon act this turn? handles slp/frz/par/flinch/confusion
function preMove(c, rng, log) {
  if (c.status === 'slp') {
    if (c.sleepTurns > 0) { c.sleepTurns--; if (c.sleepTurns === 0) { c.status = null; log.push({ t: 'wake', target: c.name }); } else { log.push({ t: 'asleep', target: c.name }); return false; } }
  }
  if (c.status === 'frz') {
    if (chance(rng, FREEZE_THAW)) { c.status = null; log.push({ t: 'thaw', target: c.name }); }
    else { log.push({ t: 'frozen', target: c.name }); return false; }
  }
  if (c.flinch) { c.flinch = false; log.push({ t: 'flinch', target: c.name }); return false; }
  if (c.status === 'par' && chance(rng, PARA_FULL)) { log.push({ t: 'fullpara', target: c.name }); return false; }
  if (c.confuseTurns > 0) {
    c.confuseTurns--;
    if (chance(rng, CONFUSE_SELF)) {
      // hit self: typeless physical, 40 bp, own atk vs own def
      const A = c.stats.atk * stageMul(c.boosts.atk);
      const D = c.stats.def * stageMul(c.boosts.def);
      let dmg = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * CONFUSE_BP * A) / Math.max(1, D)) / 50) + 2;
      dmg = Math.max(1, dmg);
      c.hp = Math.max(0, c.hp - dmg);
      log.push({ t: 'confused-hit', target: c.name, amount: dmg });
      return false;
    }
  }
  return true;
}

function endOfTurn(c, log) {
  if (c.hp <= 0) return;
  if (c.status === 'brn') { const d = Math.max(1, Math.floor(c.maxhp * BRN_FRACTION)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'brn', amount: d }); }
  else if (c.status === 'psn') { const d = Math.max(1, Math.floor(c.maxhp * PSN_FRACTION)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'psn', amount: d }); }
  else if (c.status === 'tox') { const d = Math.max(1, Math.floor(c.maxhp * TOX_FRACTION * c.toxCounter)); c.hp = Math.max(0, c.hp - d); log.push({ t: 'chip', target: c.name, cause: 'tox', amount: d }); c.toxCounter++; }
}

/**
 * Simulate ONE battle. `a` is the challenger, `b` the champion/defender.
 * Returns { winner: 'a'|'b', turns, log }. On the turn cap, higher HP% wins;
 * an exact tie goes to 'b' (the reigning champion), per spec.
 */
export function simulateBattle(aSpec, bSpec, opts) {
  const { gen = 1, moves, chart, seed = 1, turnCap = DEFAULT_TURN_CAP } = opts;
  const rng = makeRng(seed);
  const a = makeCombatant(aSpec, gen, moves);
  const b = makeCombatant(bSpec, gen, moves);
  const log = [{ t: 'start', a: a.name, b: b.name }];

  for (let turn = 1; turn <= turnCap; turn++) {
    log.push({ t: 'turn', n: turn });
    // each side picks a random move (per spec)
    const aMove = pick(rng, a.moves);
    const bMove = pick(rng, b.moves);
    // order: priority, then effective speed, then coin flip
    let first, second, firstMove, secondMove;
    const aSpd = effectiveSpeed(a), bSpd = effectiveSpeed(b);
    const aGoesFirst =
      aMove.prio !== bMove.prio ? aMove.prio > bMove.prio :
      aSpd !== bSpd ? aSpd > bSpd : chance(rng, 0.5);
    if (aGoesFirst) { first = a; second = b; firstMove = aMove; secondMove = bMove; }
    else { first = b; second = a; firstMove = bMove; secondMove = aMove; }

    if (preMove(first, rng, log)) doMove(first, second, firstMove, rng, gen, chart, log);
    if (second.hp <= 0) { log.push({ t: 'faint', target: second.name }); return finish(a, b, log, turn); }
    if (preMove(second, rng, log)) doMove(second, first, secondMove, rng, gen, chart, log);
    if (first.hp <= 0) { log.push({ t: 'faint', target: first.name }); return finish(a, b, log, turn); }

    endOfTurn(first, log);
    endOfTurn(second, log);
    if (a.hp <= 0 || b.hp <= 0) {
      if (a.hp <= 0) log.push({ t: 'faint', target: a.name });
      if (b.hp <= 0) log.push({ t: 'faint', target: b.name });
      return finish(a, b, log, turn);
    }
  }
  // turn cap reached -> HP% tiebreak, champion wins exact ties
  log.push({ t: 'cap' });
  return finish(a, b, log, turnCap, true);
}

function finish(a, b, log, turns, cap = false) {
  let winner;
  if (a.hp <= 0 && b.hp <= 0) winner = 'b';            // double KO -> champion
  else if (a.hp <= 0) winner = 'b';
  else if (b.hp <= 0) winner = 'a';
  else {
    const aPct = a.hp / a.maxhp, bPct = b.hp / b.maxhp;
    winner = aPct > bPct ? 'a' : 'b';                  // tie -> champion ('b')
  }
  log.push({ t: 'end', winner, turns, cap, aHp: a.hp, bHp: b.hp });
  return { winner, turns, log };
}

/**
 * Run N silent simulations and report the challenger's win probability, plus a
 * single representative battle log (the first run) for step-by-step playback.
 * Use an odd N so a draft can never land on an exact 50/50 split.
 */
export function runMatch(aSpec, bSpec, opts) {
  const { n = 501, seed = 1 } = opts;
  let aWins = 0;
  let sampleLog = null;
  for (let i = 0; i < n; i++) {
    const res = simulateBattle(aSpec, bSpec, { ...opts, seed: (seed + i * 2654435761) >>> 0 });
    if (i === 0) sampleLog = res.log;
    if (res.winner === 'a') aWins++;
  }
  return {
    n,
    challengerWins: aWins,
    championWins: n - aWins,
    challengerWinPct: aWins / n,
    challengerBeatsChampion: aWins * 2 > n, // strict majority
    sampleLog,
  };
}
