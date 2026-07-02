/**
 * PokeGuess — Draft Battle simulator (core)
 * ---------------------------------------------------------------------------
 * A deliberately SIMPLIFIED but faithful facsimile of a Gen 1 / Gen 2 battle.
 * It exists to decide who wins a fight between two "Frankenstein" drafted
 * Pokemon (arbitrary stats / types / moves), fast and deterministically, so the
 * UI can replay one battle step-by-step while the real outcome is a win-% taken
 * over many silent simulations.
 *
 * @version 2.1.0 
 * @changelog
 *   2.1.0 — Fixed a significant bug found during verification: OHKO moves
 *           (Guillotine/Horn Drill/Fissure) were completely non-functional.
 *           They have bp:0 in the base data (their damage isn\'t power-based),
 *           but the damage-dispatch condition required bp>0 before ever
 *           calling the function that checks move.ohko — so even a
 *           successful accuracy roll did nothing at all. Also added a
 *           confuse-end log event (confusion previously had no signal when
 *           it wore off, unlike sleep\'s wake and freeze\'s thaw).
 *   2.0.0 — Real move mechanics (#6). Previously the move-stats data only ever
 *           carried {bp, acc, type, cat, pp, prio} — every move fell through to
 *           plain damage (or a complete no-op for Status moves) regardless of
 *           what the engine's applyBoosts/tryStatus/drain/recoil machinery
 *           could already do with it. Added:
 *             • MOVE_EFFECTS — a curated effects table (recoil/drain/heal
 *               fractions, guaranteed and secondary status, confusion, stat
 *               boosts, OHKO, high-crit, fixed/HP-based damage) merged onto
 *               each move's base data at combatant-build time.
 *             • Multi-hit moves (2–5 with the real 3/8·3/8/1/8/1/8 split, and
 *               fixed-count moves like Double Kick/Twineedle/Triple Kick).
 *             • Two-turn charge moves (Fly/Dig/Solarbeam/Razor Wind/Skull
 *               Bash) — Fly/Dig grant a semi-invulnerable charge turn.
 *             • Recharge moves (Hyper Beam) — a forced do-nothing turn after
 *               use, skipped only if the target faints.
 *             • Special-cased moves whose effect isn't just "boost/status/
 *               drain": Curse (Ghost vs non-Ghost are different moves
 *               entirely), Belly Drum (costs 50% max HP, sets Atk to +6,
 *               fails under half HP), Rest (full heal + cures status +
 *               sleeps exactly 2 turns), Pain Split, Dream Eater (fails
 *               unless the target is asleep), Leech Seed (drains 1/8 max HP
 *               per turn into the seeder; Grass-types immune), and
 *               High/Jump Kick crash damage on a miss.
 *           Known, disclosed simplifications: Magnitude/Return/Frustration
 *           use their flat listed base power rather than the real
 *           variable-roll/friendship formulas (no friendship stat exists in
 *           this draft context); moves reclassified as Fairy-type in later
 *           games (Charm, Sweet Kiss, Moonlight) inherited that typing from
 *           the data pipeline — since this type chart has no Fairy row they
 *           resolve as neutral, which is a data-generation quirk, not
 *           something fixed here (their non-damage effects are still
 *           correct). Also: PP, Substitute, Counter, Transform, trapping
 *           moves, weather/abilities/items remain out of scope, unchanged
 *           from the original design notes below.
 *
 * Design choices (all intentional — see the conversation that produced this):
 *   - Level 100, DV 0, no stat experience. Base stats convert with a fixed rule.
 *   - Moves used each turn are chosen at RANDOM from the mon's 4 (per spec).
 *   - Handles: STAB, per-gen type chart, crits, accuracy/miss, stat stages,
 *     major status (par/brn/psn/tox/slp/frz), flinch, confusion, drain, recoil,
 *     self-heal, high-crit moves, OHKO moves. Anything unrecognised simply deals
 *     damage (or no-ops if it has no base power) — graceful degradation.
 *   - SKIPPED on purpose: PP, trapping, Substitute, Counter, Transform,
 *     weather/abilities/items (none exist in gen 1/2 anyway).
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
const LEECH_SEED_FRACTION = 1 / 8;
const CURSE_CHIP_FRACTION = 1 / 4;
const CONFUSE_SELF = 0.33;       // chance a confused mon hits itself
const CONFUSE_BP = 40;           // self-hit power (typeless physical)
const CRASH_FRACTION = 1 / 8;    // Jump Kick / High Jump Kick miss "crash" damage
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

// =============================================================================
// MOVE EFFECTS — the single source of truth for everything the base movestats
// data doesn't carry (#6). Keyed by moveId() (lowercase, alphanumeric-only).
// A move absent from this table just deals plain damage (or is a true no-op
// status move) — exactly as accurate as "no special effect exists".
//
// Shape (all fields optional):
//   recoil:   [num,den]   — attacker takes num/den of damage dealt
//   drain:    [num,den]   — attacker heals num/den of damage dealt
//   heal:     [num,den]   — status move: attacker heals num/den of max HP
//   status:   'par'|'brn'|'psn'|'tox'|'slp'|'frz'  — GUARANTEED on hit (status moves)
//   confuse:  true         — GUARANTEED confuse on hit (status moves)
//   boosts:   {stat:delta} — GUARANTEED stat change (status moves)
//   boostTarget: 'self'|'target' (default 'target' for status moves' boosts)
//   secondary: { chance, status?, flinch?, confuse?, boosts?, selfBoosts? }
//              — chance (0-100) applies AFTER a successful damaging hit
//   multiHit: [lo,hi]      — lo===hi for a fixed count, else weighted 2-5
//   rampBp:   [bp,bp,bp]   — per-hit power for a ramping multi-hit (Triple Kick)
//   ohko:     true
//   highCrit: true
//   fixedDamage: number | 'level' | 'halfhp' | 'psywave'
//   hpBasedPower: true     — Flail/Reversal: power scales with attacker's HP%
//   twoTurn:  true         — charges turn 1, executes turn 2
//   semiInvuln: true       — (with twoTurn) untargetable during the charge turn
//   recharge: true         — a forced blank turn after use (unless it KOs)
//   crashOnMiss: true      — Jump Kick/High Jump Kick: user takes chip on a miss
//   requiresAsleep: true   — Dream Eater: fails unless the target is asleep
//   special: 'curse'|'bellydrum'|'rest'|'painsplit'|'leechseed'
//            — effects that don't fit the generic fields above at all
// =============================================================================
const MOVE_EFFECTS = {
  // ---- recoil -----------------------------------------------------------
  takedown: { recoil: [1, 4] },
  doubleedge: { recoil: [1, 3] },
  submission: { recoil: [1, 4] },
  jumpkick: { crashOnMiss: true },
  highjumpkick: { crashOnMiss: true },

  // ---- drain --------------------------------------------------------------
  absorb: { drain: [1, 2] },
  megadrain: { drain: [1, 2] },
  gigadrain: { drain: [1, 2] },
  leechlife: { drain: [1, 2] },
  dreameater: { drain: [1, 2], requiresAsleep: true },

  // ---- self-heal status moves ---------------------------------------------
  recover: { heal: [1, 2] },
  softboiled: { heal: [1, 2] },
  milkdrink: { heal: [1, 2] },
  morningsun: { heal: [1, 2] },  // weather not modeled — flat 1/2, same simplification as Recover
  synthesis: { heal: [1, 2] },
  moonlight: { heal: [1, 2] },
  rest: { special: 'rest' },
  painsplit: { special: 'painsplit' },

  // ---- multi-hit (real 3/8, 3/8, 1/8, 1/8 split for 2/3/4/5 hits) ----------
  cometpunch: { multiHit: [2, 5] },
  furyattack: { multiHit: [2, 5] },
  pinmissile: { multiHit: [2, 5] },
  spikecannon: { multiHit: [2, 5] },
  barrage: { multiHit: [2, 5] },
  doubleslap: { multiHit: [2, 5] },
  furyswipes: { multiHit: [2, 5] },
  // fixed-count multi-hit
  doublekick: { multiHit: [2, 2] },
  bonemerang: { multiHit: [2, 2] },
  twineedle: { multiHit: [2, 2], secondary: { chance: 20, status: 'psn' } },
  triplekick: { multiHit: [3, 3], rampBp: [10, 20, 30] },

  // ---- two-turn charge moves ------------------------------------------------
  fly: { twoTurn: true, semiInvuln: true },
  dig: { twoTurn: true, semiInvuln: true },
  solarbeam: { twoTurn: true },
  razorwind: { twoTurn: true, highCrit: true },
  skullbash: { twoTurn: true, boosts: { def: 1 }, boostTarget: 'self' }, // banned from draft, kept for any pre-existing drafted mon

  // ---- recharge -------------------------------------------------------------
  hyperbeam: { recharge: true },

  // ---- OHKO -------------------------------------------------------------
  guillotine: { ohko: true },
  horndrill: { ohko: true },
  fissure: { ohko: true },

  // ---- high crit ratio ----------------------------------------------------
  karatechop: { highCrit: true },
  razorleaf: { highCrit: true },
  slash: { highCrit: true },
  crabhammer: { highCrit: true },
  aeroblast: { highCrit: true },
  crosschop: { highCrit: true },

  // ---- fixed / variable damage formulas ------------------------------------
  sonicboom: { fixedDamage: 20 },
  dragonrage: { fixedDamage: 40 },
  seismictoss: { fixedDamage: 'level' },
  nightshade: { fixedDamage: 'level' },
  superfang: { fixedDamage: 'halfhp' },
  psywave: { fixedDamage: 'psywave' },
  flail: { hpBasedPower: true },
  reversal: { hpBasedPower: true },

  // ---- guaranteed status (status-category moves) ---------------------------
  toxic: { status: 'tox' },
  thunderwave: { status: 'par' },
  stunspore: { status: 'par' },
  glare: { status: 'par' },
  sleeppowder: { status: 'slp' },
  spore: { status: 'slp' },
  hypnosis: { status: 'slp' },
  sing: { status: 'slp' },
  lovelykiss: { status: 'slp' },
  poisonpowder: { status: 'psn' },
  poisongas: { status: 'psn' },
  confuseray: { confuse: true },
  sweetkiss: { confuse: true },
  supersonic: { confuse: true },
  swagger: { confuse: true, boosts: { atk: 2 }, boostTarget: 'target' }, // raises the TARGET's attack, then confuses them
  flatter: { confuse: true, boosts: { spa: 1 }, boostTarget: 'target' },
  leechseed: { special: 'leechseed' },
  curse: { special: 'curse' },
  bellydrum: { special: 'bellydrum' },

  // ---- guaranteed self stat boosts -----------------------------------------
  swordsdance: { boosts: { atk: 2 }, boostTarget: 'self' },
  agility: { boosts: { spe: 2 }, boostTarget: 'self' },
  amnesia: { boosts: { spd: 2 }, boostTarget: 'self' },
  growth: { boosts: { spa: 1 }, boostTarget: 'self' },
  meditate: { boosts: { atk: 1 }, boostTarget: 'self' },
  sharpen: { boosts: { atk: 1 }, boostTarget: 'self' },
  harden: { boosts: { def: 1 }, boostTarget: 'self' },
  withdraw: { boosts: { def: 1 }, boostTarget: 'self' },
  defensecurl: { boosts: { def: 1 }, boostTarget: 'self' },
  barrier: { boosts: { def: 2 }, boostTarget: 'self' },
  acidarmor: { boosts: { def: 2 }, boostTarget: 'self' },
  minimize: { boosts: {}, boostTarget: 'self' },   // evasion not modeled — kept as a harmless status use
  doubleteam: { boosts: {}, boostTarget: 'self' },
  focusenergy: { boosts: {}, boostTarget: 'self' }, // crit-rate boost not modeled separately here

  // ---- guaranteed self stat DROPS from a "trade-off" status move ----------
  // (none currently in-pool beyond Curse's non-Ghost branch, handled specially)

  // ---- guaranteed TARGET stat drops -----------------------------------------
  growl: { boosts: { atk: -1 }, boostTarget: 'target' },
  leer: { boosts: { def: -1 }, boostTarget: 'target' },
  tailwhip: { boosts: { def: -1 }, boostTarget: 'target' },
  screech: { boosts: { def: -2 }, boostTarget: 'target' },
  sandattack: { boosts: {}, boostTarget: 'target' }, // accuracy-drop not modeled — harmless no-op beyond the "used move" log
  smokescreen: { boosts: {}, boostTarget: 'target' },
  flash: { boosts: {}, boostTarget: 'target' },
  kinesis: { boosts: {}, boostTarget: 'target' },
  stringshot: { boosts: { spe: -1 }, boostTarget: 'target' },
  scaryface: { boosts: { spe: -2 }, boostTarget: 'target' },
  cottonspore: { boosts: { spe: -2 }, boostTarget: 'target' },

  // ---- secondary effects on damaging moves (chance checked after a hit) ---
  bodyslam: { secondary: { chance: 30, status: 'par' } },
  stomp: { secondary: { chance: 30, flinch: true } },
  rollingkick: { secondary: { chance: 30, flinch: true } },
  headbutt: { secondary: { chance: 30, flinch: true } },
  bite: { secondary: { chance: 30, flinch: true } },
  lick: { secondary: { chance: 30, status: 'par' } },
  hyperfang: { secondary: { chance: 10, flinch: true } },
  icepunch: { secondary: { chance: 10, status: 'frz' } },
  firepunch: { secondary: { chance: 10, status: 'brn' } },
  thunderpunch: { secondary: { chance: 10, status: 'par' } },
  ember: { secondary: { chance: 10, status: 'brn' } },
  flamethrower: { secondary: { chance: 10, status: 'brn' } },
  fireblast: { secondary: { chance: 10, status: 'brn' } },
  // firespin: trapping not modeled — plain damage, no table entry needed.
  flamewheel: { secondary: { chance: 10, status: 'brn' } },
  sacredfire: { secondary: { chance: 50, status: 'brn' } },
  thundershock: { secondary: { chance: 10, status: 'par' } },
  thunderbolt: { secondary: { chance: 10, status: 'par' } },
  thunder: { secondary: { chance: 10, status: 'par' } },
  spark: { secondary: { chance: 30, status: 'par' } },
  zapcannon: { secondary: { chance: 100, status: 'par' } },
  icebeam: { secondary: { chance: 10, status: 'frz' } },
  blizzard: { secondary: { chance: 10, status: 'frz' } },
  powdersnow: { secondary: { chance: 10, status: 'frz' } },
  psybeam: { secondary: { chance: 10, confuse: true } },
  confusion: { secondary: { chance: 10, confuse: true } },
  dizzypunch: { secondary: { chance: 20, confuse: true } },
  acid: { secondary: { chance: 10, boosts: { def: -1 } } },
  psychic: { secondary: { chance: 10, boosts: { spd: -1 } } },
  aurorabeam: { secondary: { chance: 10, boosts: { atk: -1 } } },
  crunch: { secondary: { chance: 20, boosts: { def: -1 } } },
  shadowball: { secondary: { chance: 20, boosts: { spd: -1 } } },
  ancientpower: { secondary: { chance: 10, selfBoosts: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } } },
  triattack: { secondary: { chance: 20, status: 'par' } }, // real Tri Attack picks par/brn/frz at random; simplified to paralysis for determinism
  sludge: { secondary: { chance: 30, status: 'psn' } },
  sludgebomb: { secondary: { chance: 30, status: 'psn' } },
  poisonsting: { secondary: { chance: 20, status: 'psn' } },
  smog: { secondary: { chance: 40, status: 'psn' } },
  rocksmash: { secondary: { chance: 50, boosts: { def: -1 } } },
  rockslide: { secondary: { chance: 30, flinch: true } },
  irontail: { secondary: { chance: 30, boosts: { def: -1 } } },
  // mudslap: accuracy-drop not modeled — plain damage, no table entry needed.
  constrict: { secondary: { chance: 10, boosts: { spe: -1 } } },
  dragonbreath: { secondary: { chance: 30, status: 'par' } },
  twister: { secondary: { chance: 20, flinch: true } },
  metalclaw: { secondary: { chance: 10, boosts: { atk: 1 }, selfBoosts: { atk: 1 } } },
  steelwing: { secondary: { chance: 10, boosts: { def: 1 }, selfBoosts: { def: 1 } } },
};

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

// Real gen 1/2 multi-hit distribution: 2 and 3 hits are equally likely and
// together make up 75%; 4 and 5 hits share the remaining 25% equally.
function rollHitCount(rng) {
  const r = rng();
  if (r < 3 / 8) return 2;
  if (r < 6 / 8) return 3;
  if (r < 7 / 8) return 4;
  return 5;
}

// Flail / Reversal: power rises sharply as the user's HP falls.
function hpBasedBp(user) {
  const pct = user.hp / user.maxhp;
  if (pct >= 0.6875) return 20;
  if (pct >= 0.3542) return 40;
  if (pct >= 0.2083) return 80;
  if (pct >= 0.1042) return 100;
  if (pct >= 0.0417) return 150;
  return 200;
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
    cursed: false,                // #6e — Curse (Ghost-type user variant)
    seededBy: null,                // #6 — Leech Seed: reference to whoever planted it
    chargingMove: null,            // #6b — Fly/Dig/Solarbeam/Razor Wind mid-charge
    invulnThisTurn: false,         // #6b — Fly/Dig semi-invulnerability
    mustRecharge: false,           // #6a — Hyper Beam
    moves: (spec.moves || []).map((nm) => {
      const hp = HP_TYPE_RE.exec(nm);
      if (hp) {
        const type = hp[1].charAt(0).toUpperCase() + hp[1].slice(1).toLowerCase();
        const base = moveData['hiddenpower'] || { bp: 70, acc: 100, pp: 15, prio: 0 };
        return { name: nm, id: 'hiddenpower', ...base, type, cat: gen12Category(type) };
      }
      const id = moveId(nm);
      const data = moveData[id] || FALLBACK_MOVE;
      const fx = MOVE_EFFECTS[id] || {};
      return { name: nm, id, ...data, ...fx };
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

  const bp = move.hpBasedPower ? hpBasedBp(atkr) : move.bp;
  let dmg = Math.floor(Math.floor((Math.floor((2 * LEVEL) / 5 + 2) * bp * A) / Math.max(1, D)) / 50) + 2;
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

// Fixed/variable damage that skips the normal stat formula entirely, but
// still respects type immunity (#6).
function calcFixedDamage(atkr, defr, move, rng, chart, log) {
  const eff = typeEffectiveness(move.type, defr.types, chart);
  if (eff === 0) { log.push({ t: 'immune', target: defr.name, move: move.name }); return 0; }
  let dmg;
  if (move.fixedDamage === 'level') dmg = LEVEL;
  else if (move.fixedDamage === 'halfhp') dmg = Math.max(1, Math.floor(defr.hp / 2));
  else if (move.fixedDamage === 'psywave') dmg = randint(rng, Math.floor(LEVEL * 0.5), Math.ceil(LEVEL * 1.5) - 1);
  else dmg = move.fixedDamage;
  dmg = Math.max(1, Math.min(dmg, defr.hp));
  log.push({ t: 'damage', source: atkr.name, target: defr.name, move: move.name, amount: dmg, crit: false, eff });
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
  if (status === 'slp') target.sleepTurns = randint(rng, 1, 7); // #6 corrected from an earlier 1–3 guess: gen 1/2 sleep is 1–7 turns, not the modern 1–3
  if (status === 'tox') target.toxCounter = 1;
  log.push({ t: 'status', target: target.name, status });
  return true;
}

function doMove(attacker, defender, move, rng, gen, chart, log, releasingCharge) {
  // ---- semi-invulnerable target (Fly/Dig charge turn) — nothing can hit it -
  if (defender.invulnThisTurn) {
    log.push({ t: 'miss', source: attacker.name, move: move.name, reason: 'invuln' });
    return;
  }

  // ---- two-turn charge: turn 1 (not releasing) — just charge, no damage ----
  if (move.twoTurn && !releasingCharge) {
    attacker.chargingMove = move;
    if (move.semiInvuln) attacker.invulnThisTurn = true;
    log.push({ t: 'charge', source: attacker.name, move: move.name });
    return;
  }
  // if releasingCharge is true, fall through — the move executes for real now.

  // ---- special-cased moves that don't fit the generic pipeline (#6) --------
  if (move.special === 'curse') {
    if (attacker.types.includes('Ghost')) {
      const cost = Math.max(1, Math.floor(attacker.maxhp / 2));
      attacker.hp = Math.max(0, attacker.hp - cost);
      log.push({ t: 'curse-cost', target: attacker.name, amount: cost });
      if (!defender.cursed) { defender.cursed = true; log.push({ t: 'curse', target: defender.name }); }
    } else {
      applyBoosts(attacker, { atk: 1, def: 1, spe: -1 }, gen, log);
    }
    return;
  }
  if (move.special === 'bellydrum') {
    const cost = Math.floor(attacker.maxhp / 2);
    if (attacker.hp <= cost) { log.push({ t: 'fail', target: attacker.name, move: move.name }); return; }
    attacker.hp -= cost;
    attacker.boosts[boostKey('atk', gen)] = 6;
    log.push({ t: 'bellydrum', target: attacker.name, amount: cost });
    return;
  }
  if (move.special === 'rest') {
    attacker.hp = attacker.maxhp;
    attacker.status = 'slp';
    attacker.sleepTurns = 2; // Rest always sleeps for exactly 2 turns
    attacker.toxCounter = 0;
    log.push({ t: 'rest', target: attacker.name });
    return;
  }
  if (move.special === 'painsplit') {
    const avg = Math.floor((attacker.hp + defender.hp) / 2);
    attacker.hp = Math.min(attacker.maxhp, avg);
    defender.hp = Math.min(defender.maxhp, avg);
    log.push({ t: 'painsplit', source: attacker.name, target: defender.name });
    return;
  }
  if (move.special === 'leechseed') {
    if (defender.types.includes('Grass') || defender.seededBy) { log.push({ t: 'fail', target: defender.name, move: move.name }); return; }
    defender.seededBy = attacker;
    log.push({ t: 'leechseed', target: defender.name });
    return;
  }

  // ---- accuracy --------------------------------------------------------
  if (move.acc !== true && move.acc != null && move.acc < 100) {
    if (!chance(rng, move.acc / 100)) {
      log.push({ t: 'miss', source: attacker.name, move: move.name });
      if (move.crashOnMiss) { // #6 — Jump Kick / High Jump Kick "crash" on a miss
        const crash = Math.max(1, Math.floor(attacker.maxhp * CRASH_FRACTION));
        attacker.hp = Math.max(0, attacker.hp - crash);
        log.push({ t: 'crash', target: attacker.name, amount: crash });
      }
      return;
    }
  }
  log.push({ t: 'use', source: attacker.name, move: move.name });

  // Dream Eater — fails outright unless the target is asleep
  if (move.requiresAsleep && defender.status !== 'slp') {
    log.push({ t: 'fail', target: defender.name, move: move.name });
    return;
  }

  let dealt = 0;
  if (move.fixedDamage != null) {
    dealt = calcFixedDamage(attacker, defender, move, rng, chart, log);
    defender.hp = Math.max(0, defender.hp - dealt);
  } else if (move.multiHit) {
    const [lo, hi] = move.multiHit;
    const hits = lo === hi ? lo : rollHitCount(rng);
    let total = 0, actualHits = 0;
    for (let i = 0; i < hits; i++) {
      if (defender.hp <= 0) break;
      const hitMove = move.rampBp ? { ...move, bp: move.rampBp[Math.min(i, move.rampBp.length - 1)] } : move;
      const d = calcDamage(attacker, defender, hitMove, rng, gen, chart, log);
      defender.hp = Math.max(0, defender.hp - d);
      total += d; actualHits++;
    }
    dealt = total;
    log.push({ t: 'multihit', target: defender.name, hits: actualHits });
  } else if (move.cat !== 'Status' && (move.bp > 0 || move.ohko)) {
    dealt = calcDamage(attacker, defender, move, rng, gen, chart, log);
    defender.hp = Math.max(0, defender.hp - dealt);
  }

  // self heal (Recover / Softboiled / ...)
  if (move.heal && move.cat === 'Status') {
    const heal = Math.floor(attacker.maxhp * move.heal[0] / move.heal[1]);
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxhp, attacker.hp + heal);
    if (attacker.hp !== before) log.push({ t: 'heal', target: attacker.name, amount: attacker.hp - before });
  }
  // drain (Absorb / Mega Drain / Giga Drain / Leech Life / Dream Eater)
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

  // guaranteed status / confuse / boosts (status moves)
  if (move.status && defender.hp > 0) tryStatus(defender, move.status, rng, log);
  if (move.confuse && defender.hp > 0 && defender.confuseTurns === 0) {
    defender.confuseTurns = randint(rng, 2, 4); log.push({ t: 'confuse', target: defender.name });
  }
  if (move.boosts && Object.keys(move.boosts).length && defender.hp > 0) {
    const tgt = move.boostTarget === 'self' ? attacker : defender;
    if (tgt.hp > 0) applyBoosts(tgt, move.boosts, gen, log);
  }

  // secondary effects (from damaging moves — chance checked AFTER a successful hit)
  if (move.secondary && defender.hp > 0 && dealt > 0) {
    if (chance(rng, move.secondary.chance / 100)) {
      if (move.secondary.status) tryStatus(defender, move.secondary.status, rng, log);
      if (move.secondary.flinch) defender.flinch = true;
      if (move.secondary.confuse && defender.confuseTurns === 0) { defender.confuseTurns = randint(rng, 2, 4); log.push({ t: 'confuse', target: defender.name }); }
      if (move.secondary.boosts) applyBoosts(defender, move.secondary.boosts, gen, log);
      if (move.secondary.selfBoosts) applyBoosts(attacker, move.secondary.selfBoosts, gen, log);
    }
  }

  // recharge (Hyper Beam) — required whenever used, UNLESS it just fainted the target
  if (move.recharge && defender.hp > 0) attacker.mustRecharge = true;
}

// Decide what a combatant does this turn, resolving recharge/charge state
// BEFORE a fresh random move would ever be picked (#6a/#6b).
function chooseMoveForTurn(c, rng) {
  if (c.mustRecharge) { c.mustRecharge = false; return { move: null, releasing: false }; }
  if (c.chargingMove) { const m = c.chargingMove; c.chargingMove = null; return { move: m, releasing: true }; }
  return { move: pick(rng, c.moves), releasing: false };
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
    if (c.confuseTurns === 0) log.push({ t: 'confuse-end', target: c.name });
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
  if (c.hp > 0 && c.cursed) {
    const d = Math.max(1, Math.floor(c.maxhp * CURSE_CHIP_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    log.push({ t: 'chip', target: c.name, cause: 'curse', amount: d });
  }
  if (c.hp > 0 && c.seededBy && c.seededBy.hp > 0) {
    const d = Math.max(1, Math.floor(c.maxhp * LEECH_SEED_FRACTION));
    c.hp = Math.max(0, c.hp - d);
    const before = c.seededBy.hp;
    c.seededBy.hp = Math.min(c.seededBy.maxhp, c.seededBy.hp + d);
    log.push({ t: 'chip', target: c.name, cause: 'leechseed', amount: d, healed: c.seededBy.hp - before });
  }
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
    a.invulnThisTurn = false; b.invulnThisTurn = false; // reset — set fresh by doMove if a charge begins THIS turn

    const aChoice = chooseMoveForTurn(a, rng);
    const bChoice = chooseMoveForTurn(b, rng);
    const aPrio = aChoice.move ? aChoice.move.prio : 0;
    const bPrio = bChoice.move ? bChoice.move.prio : 0;
    const aSpd = effectiveSpeed(a), bSpd = effectiveSpeed(b);
    const aGoesFirst =
      aPrio !== bPrio ? aPrio > bPrio :
      aSpd !== bSpd ? aSpd > bSpd : chance(rng, 0.5);

    let first, second, firstChoice, secondChoice;
    if (aGoesFirst) { first = a; second = b; firstChoice = aChoice; secondChoice = bChoice; }
    else { first = b; second = a; firstChoice = bChoice; secondChoice = aChoice; }

    if (!firstChoice.move) { log.push({ t: 'recharge', target: first.name }); }
    else if (preMove(first, rng, log)) doMove(first, second, firstChoice.move, rng, gen, chart, log, firstChoice.releasing);
    if (second.hp <= 0) { log.push({ t: 'faint', target: second.name }); return finish(a, b, log, turn); }

    if (!secondChoice.move) { log.push({ t: 'recharge', target: second.name }); }
    else if (preMove(second, rng, log)) doMove(second, first, secondChoice.move, rng, gen, chart, log, secondChoice.releasing);
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
