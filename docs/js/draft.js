/**
 * @file        docs/js/draft.js   (PokeGuess — Draft Battle engine)
 * @version     0.4.1
 * @updated     2026-06-23
 * @changelog
 *   0.4.1 — Rescue stat-block bleed glued to real moves ("Ice Beam Maximum
 *           Stats…" → "Ice Beam"). Exclude Ditto & Unown from the draft.
 *   0.4.0 — Draft moves from the FULL movepool (movelist-gen2.json) via
 *           buildLearnsetMap(): sim-valid moves only, typo rescue, Hidden Power
 *           dropped. 10 moves shown per card; move-reroll resamples without
 *           replacement. result() now carries the silhouette sprite id.
 *   0.3.0 — "No type" is a real pick from a mono-typed card (advances + names);
 *           position-anchored predetermined rerolls; name/face from first aspect.
 *   0.2.0 — Adapter targets real gen2.json fields (fullStats, comp movesets).
 *   0.1.0 — Initial engine (spin/keep/reroll, autoDraft).
 * ---------------------------------------------------------------------------
 * Builds a "Frankenstein" Pokemon by spinning random species one at a time and
 * keeping ONE aspect from each spin until all slots are full:
 *   - 6 stat slots (hp, atk, def, spa, spd, spe)            [Gen 2]
 *   - 2 type slots — >= 1 real type; the 2nd may be "—" (mono-typed)
 *   - 4 move slots — chosen from 10 shown, sampled from the species' FULL pool
 *
 * "NO TYPE": a mono-typed species (Charmander = Fire / —) offers its real type
 * AND the "—". Taking "—" makes the slot empty and, like any pick, advances the
 * deck and sets the name/face. Taken at most once; >= 1 real type is guaranteed
 * by completion (both type slots must fill and you can't take "—" twice).
 *
 * DETERMINISM: indexed by POSITION = number of advancing picks taken. Each card
 * and its move list are pure functions of (seed, position, pokeReroll[, moveReroll]).
 * A Pokemon-reroll shows a PREDETERMINED alternative for the SAME position and
 * never shifts later positions — so a well-timed reroll changes only the current
 * card, never the rest of the (daily) puzzle. Same seed + same choices reproduce
 * the same draft. Free-play uses a random seed; the daily passes a fixed seed
 * and a reduced budget ({ pokemon: 1, moves: 1 }).
 *
 * HIDDEN POWER is excluded from the draft pool in this mode (no fixed type/power
 * to assign to an arbitrary Frankenstein), so the simulator never has to type it.
 *
 * BLIND STATS: availablePicks() always exposes each stat value; the UI decides
 * whether to paint it (blind by default, reveal optional).
 *
 * Pure logic, no DOM. Data adapters at the bottom map the real gen2.json +
 * movelist-gen2.json into the engine's clean shape.
 */

import { toRealStats, moveId } from './sim.js';

export const STAT_KEYS = { 1: ['hp', 'atk', 'def', 'spc', 'spe'], 2: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] };
const MOVE_SLOTS = 4;             // moves on the finished mon
const TYPE_SLOTS = 2;
const MOVE_CHOICE_COUNT = 10;     // moves shown per card, sampled from the full pool
const DEFAULT_REROLLS = { pokemon: 3, moves: 3 };

// ---- seeded PRNG (same family as sim.js, independent stream) ----------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function subSeed(master, ...ints) {
  let h = master >>> 0;
  for (const n of ints) { h = (Math.imul(h ^ (n >>> 0), 2654435761) + 0x9E3779B9) >>> 0; }
  return h >>> 0;
}
const pickFrom = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffled(rng, arr) {                       // full deterministic shuffle (copy)
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class DraftSession {
  constructor({ species, gen = 2, playerName = 'Player', seed = (Math.random() * 2 ** 31) | 0, rerolls, moveSample } = {}) {
    if (!species || !species.length) throw new Error('DraftSession needs a non-empty species list');
    this.species = species;
    this.gen = gen;
    this.playerName = playerName;
    this.seed = seed >>> 0;
    this.statKeys = STAT_KEYS[gen];
    this.rerolls = { ...DEFAULT_REROLLS, ...(rerolls || {}) };
    this.moveSample = moveSample || MOVE_CHOICE_COUNT;

    this.stats = {};                 // statKey -> value
    this.types = [];                 // real type names (0..2, distinct)
    this.typeNone = false;           // true once the player has taken a "—"
    this.moves = [];                 // up to 4 distinct move names
    this.silhouette = null;          // species object of the FIRST aspect pulled

    this.position = 0;               // advancing picks taken
    this.pokeReroll = 0;             // Pokemon-rerolls used at the current position
    this.moveReroll = 0;             // move-rerolls used at the current (position, pokeReroll)
    this._card = null;
    this._moveList = [];
    this._refresh();
  }

  // ---- deterministic derivations ----
  _speciesAt(position, pokeReroll) {
    return pickFrom(makeRng(subSeed(this.seed, 1, position, pokeReroll)), this.species);
  }
  // PREDETERMINED candidate list. One deterministic shuffle per (position,
  // pokeReroll); move-reroll r shows the cyclic window [r*K, r*K+K). Within a
  // window every move is distinct (K <= pool); consecutive rerolls don't overlap
  // until they wrap the pool — "without replacement when possible". Pure function
  // of (seed, position, pokeReroll, moveReroll); ownership applied at pick time.
  _moveListAt(species, position, pokeReroll, moveReroll) {
    const pool = species.learnset || [];
    const K = this.moveSample;
    if (pool.length <= K) return pool.slice();
    const order = shuffled(makeRng(subSeed(this.seed, 2, position, pokeReroll)), pool);
    const start = (moveReroll * K) % order.length;
    const out = [];
    for (let i = 0; i < K; i++) out.push(order[(start + i) % order.length]);
    return out;
  }
  _refresh() {
    this._card = this._speciesAt(this.position, this.pokeReroll);
    this._moveList = this._moveListAt(this._card, this.position, this.pokeReroll, this.moveReroll);
  }
  _advance() { this.position++; this.pokeReroll = 0; this.moveReroll = 0; this._refresh(); }
  _markFace() { if (!this.silhouette) this.silhouette = this._card; }

  // ---- queries ----
  get current() { return this._card; }
  cardIsMono() { return (this._card.types || []).filter(Boolean).length === 1; }
  openStatSlots() { return this.statKeys.filter((k) => !(k in this.stats)); }
  typeSlotsFilled() { return this.types.length + (this.typeNone ? 1 : 0); }
  typeSlotsOpen() { return TYPE_SLOTS - this.typeSlotsFilled(); }
  moveSlotsOpen() { return MOVE_SLOTS - this.moves.length; }
  canPickNoType() { return this.cardIsMono() && this.typeSlotsOpen() > 0 && !this.typeNone; }

  availablePicks() {
    const picks = { stats: [], types: [], moves: [], canPickNoType: this.canPickNoType() };
    const c = this._card;
    for (const k of this.openStatSlots()) picks.stats.push({ stat: k, value: c.baseStats[k] }); // UI may hide value
    if (this.typeSlotsOpen() > 0) {
      const seen = new Set();
      for (const t of c.types) {
        if (!t || seen.has(t)) continue; seen.add(t);
        if (!this.types.includes(t)) picks.types.push(t);
      }
    }
    if (this.moveSlotsOpen() > 0) picks.moves = this._moveList.filter((m) => !this.moves.includes(m));
    return picks;
  }

  hasLegalPick() {
    const p = this.availablePicks();
    return p.stats.length || p.types.length || p.moves.length || p.canPickNoType;
  }
  isComplete() {
    return this.openStatSlots().length === 0 && this.typeSlotsOpen() === 0 && this.moveSlotsOpen() === 0;
  }

  // ---- actions ----
  pickStat(statKey) {
    if (!(statKey in this.stats) && this.statKeys.includes(statKey)) {
      this.stats[statKey] = this._card.baseStats[statKey];
      this._markFace(); this._advance(); return true;
    }
    return false;
  }
  pickType(typeName) {
    if (this.typeSlotsOpen() > 0 && this._card.types.includes(typeName) && !this.types.includes(typeName)) {
      this.types.push(typeName); this._markFace(); this._advance(); return true;
    }
    return false;
  }
  pickNoType() {
    if (!this.canPickNoType()) return false;
    this.typeNone = true; this._markFace(); this._advance(); return true;
  }
  pickMove(moveName) {
    if (this.moveSlotsOpen() > 0 && this._moveList.includes(moveName) && !this.moves.includes(moveName)) {
      this.moves.push(moveName); this._markFace(); this._advance(); return true;
    }
    return false;
  }

  rerollPokemon() {
    if (this.rerolls.pokemon <= 0) return false;
    this.rerolls.pokemon--; this.pokeReroll++; this.moveReroll = 0; this._refresh(); return true;
  }
  rerollMoves() {
    if (this.rerolls.moves <= 0) return false;
    this.rerolls.moves--; this.moveReroll++;
    this._moveList = this._moveListAt(this._card, this.position, this.pokeReroll, this.moveReroll);
    return true;
  }

  /** Full predetermined choice list for the current card (owned moves included
   *  so the UI can render them as already-taken). */
  get moveChoices() { return this._moveList.slice(); }

  /** Free skip — only when the card offers no valid pick (anti-soft-lock). */
  skipIfStuck() { if (!this.hasLegalPick()) { this._advance(); return true; } return false; }

  result() {
    if (!this.isComplete()) throw new Error('draft not complete');
    const baseStats = { ...this.stats };
    const types = [this.types[0] || null, this.types[1] || null];
    const sil = this.silhouette || this._card;
    return {
      name: `${this.playerName}'s ${sil.name}`,
      player: this.playerName,
      silhouetteSpecies: sil.name,
      silhouetteSpriteId: sil.spriteId != null ? sil.spriteId : (sil.num != null ? sil.num : null),
      types,
      baseStats,
      stats: toRealStats(baseStats, this.gen),
      moves: this.moves.slice(),
      gen: this.gen,
    };
  }
}

/** Auto-draft a full mon with random legal picks (default/throne champion). */
export function autoDraft({ species, gen = 2, seed = (Math.random() * 2 ** 31) | 0, playerName = 'The Champion' }) {
  const s = new DraftSession({ species, gen, seed, playerName });
  const rng = makeRng(subSeed(seed >>> 0, 99));
  let guard = 0;
  while (!s.isComplete()) {
    if (++guard > 5000) throw new Error('auto-draft failed to converge');
    if (s.skipIfStuck()) continue;
    const p = s.availablePicks();
    const bag = [];
    for (const st of p.stats) bag.push(() => s.pickStat(st.stat));
    for (const t of p.types) bag.push(() => s.pickType(t));
    for (const m of p.moves) bag.push(() => s.pickMove(m));
    if (p.canPickNoType) bag.push(() => s.pickNoType());
    pickFrom(rng, bag)();
  }
  return s.result();
}

// ===========================================================================
//  DATA ADAPTERS
// ===========================================================================

const DASH = /^[\s\-\u2012\u2013\u2014\u2015\u2212]*$/;
const isBlank = (v) => v == null || DASH.test(String(v).trim()) || String(v).trim() === '';
const isHiddenPower = (n) => /^(hidden\s*power|hp)\b/i.test(String(n));

/** Parse "39/52/43/60/50/65" → base stats (HP,Atk,Def,SpA,SpD,Spe). */
export function parseBaseStats(fullStats, gen = 2) {
  if (isBlank(fullStats)) return null;
  const nums = String(fullStats).match(/\d+/g);
  if (!nums || nums.length < 6) return null;
  const [hp, atk, def, spa, spd, spe] = nums.slice(0, 6).map(Number);
  return gen === 1
    ? { hp, atk, def, spc: Math.round((spa + spd) / 2), spe }
    : { hp, atk, def, spa, spd, spe };
}

// Real-move typo/spelling fixes found in the movelist data → movestats spelling.
const MOVE_ALIASES = {
  'faint attack': 'Feint Attack', 'hi jump kick': 'High Jump Kick',
  'foresoght': 'Foresight', 'ponud': 'Pound', 'safegurard': 'Safeguard',
  'whirwind': 'Whirlwind', 'vicegrip': 'Vise Grip',
};

/** Clean one raw move token to a canonical display name, or null to drop it. */
export function canonicalizeMove(raw) {
  let s = String(raw).trim();
  // Rescue spreadsheet "stat block" bleed: a real move glued to a Maximum-Stats
  // dump, e.g. "Ice Beam Maximum Stats : L50: 165 HP" → "Ice Beam".
  s = s.split(/\s+Maximum Stats/i)[0].trim();
  s = s.replace(/^["'(\s]+/, '').replace(/["')\s]+$/, '');
  if (!s || DASH.test(s)) return null;
  const lc = s.toLowerCase();
  if (MOVE_ALIASES[lc]) return MOVE_ALIASES[lc];
  return s;
}

/**
 * Build { speciesNameLower: [valid move display names] } from movelist-genN.json
 * (keyed by lowercase name → [{move, source}]). Keeps only moves the simulator
 * can run (id present in moveStats), drops Hidden Power and duplicates, and
 * rescues the handful of known spreadsheet typos. This is THE move source for
 * the draft, so the two game modes stay in lockstep on move data.
 */
export function buildLearnsetMap(movelist, moveStats) {
  const have = new Set(Object.keys(moveStats || {}));
  const map = {};
  for (const [name, list] of Object.entries(movelist || {})) {
    const out = [];
    const seenIds = new Set();
    for (const item of (list || [])) {
      const raw = typeof item === 'string' ? item : (item && item.move);
      const nm = canonicalizeMove(raw);
      if (!nm || isHiddenPower(nm)) continue;
      const id = moveId(nm);
      if (!have.has(id) || seenIds.has(id)) continue;     // sim-valid + dedupe
      seenIds.add(id); out.push(nm);
    }
    map[name.toLowerCase()] = out;
  }
  return map;
}

/** @param entry gen2.json pokedex entry; @param learnsetMap from buildLearnsetMap. */
export function normalizeSpecies(entry, gen = 2, learnsetMap = null) {
  const types = [entry.type1, entry.type2].filter((t) => !isBlank(t)).map((t) => String(t).trim());
  const baseStats = parseBaseStats(entry.fullStats, gen);
  const learnset = (learnsetMap && learnsetMap[String(entry.name).toLowerCase()]) || [];
  return { name: entry.name, num: entry.num, spriteId: entry.spriteId, types, baseStats, learnset };
}

// Species that exist as stat/type donors in the dex but are NOT draftable:
// Ditto (Transform only) and Unown (Hidden Power only) have no real movepool.
const EXCLUDE_DRAFT = new Set(['ditto', 'unown']);

/** Build the draftable species list. Keeps any species with valid stats and
 *  >= 1 type; a small/empty movepool is still a fine stat/type donor. Ditto and
 *  Unown are excluded entirely. */
export function buildSpeciesList(genData, learnsetMap = null, gen = 2) {
  return (genData.pokedex || [])
    .map((entry) => normalizeSpecies(entry, gen, learnsetMap))
    .filter((s) => s.baseStats && s.types.length >= 1 && !EXCLUDE_DRAFT.has(String(s.name).toLowerCase()));
}
