/**
 * @file        docs/js/draft.js   (PokeGuess — Draft Battle engine)
 * @version     0.5.0
 * @updated     2026-06-25
 * @changelog
 *   0.5.0 — TWO PICKS PER CARD (authorised engine change; supersedes the
 *           one-aspect-per-spin model). Picks now RECORD on the current card
 *           WITHOUT advancing; the deck advances only on commitCard(). So both
 *           of a card's picks read THAT card's data — fixing the bug where a
 *           second pick read the next card. Other rule changes per spec:
 *             • A type may be drafted twice → the build becomes mono of that
 *               type (Fire + Fire ⇒ Fire / —). Types keep the commutative
 *               property (no fixed slot 1/2). "—" is a pickable attribute on
 *               mono cards; at most one "—" so ≥1 real type is guaranteed.
 *             • Move reroll samples WITH replacement but heavily weighted toward
 *               moves not shown in earlier rerolls of the same card.
 *           New API: commitCard(picks), advance(), typeDisplay(); pick* no
 *           longer advance. position now indexes CARDS, not individual picks.
 *   0.4.1 — Rescue stat-block bleed; exclude Ditto & Unown.
 *   0.4.0 — Draft moves from the FULL movepool via buildLearnsetMap().
 *   0.3.0 — "No type" pick; position-anchored predetermined rerolls.
 *   0.2.0 — Adapter targets real gen2.json fields.
 *   0.1.0 — Initial engine.
 * ---------------------------------------------------------------------------
 * Builds a "Frankenstein" Pokemon by spinning random species one CARD at a time
 * and keeping up to TWO aspects from each card until all slots are full:
 *   - 6 stat slots (hp, atk, def, spa, spd, spe)            [Gen 2]
 *   - 2 type slots — a type drafted twice collapses to mono; "—" fills a slot
 *     as "no type" (mono); ≥1 real type guaranteed at completion.
 *   - 4 move slots — chosen from up to 10 shown, sampled from the full pool;
 *     a move can never be drafted twice.
 *
 * EACH CARD: the player picks up to two attributes (the values/types/moves all
 * come from the CURRENTLY shown card), then commits — which advances the deck to
 * the next card. A card may yield only one pick near the end (when one slot
 * remains) or zero pickable attributes (then reroll or skip).
 *
 * DETERMINISM: indexed by POSITION = number of committed cards. Each card and
 * its move list are pure functions of (seed, position, pokeReroll[, moveReroll]).
 * A Pokemon-reroll shows a PREDETERMINED alternative for the SAME position; a
 * move-reroll resamples the same card. Same seed + same choices reproduce the
 * same draft. Free-play uses a random seed; the daily passes a fixed seed and a
 * reduced budget ({ pokemon: 1, moves: 1 }).
 *
 * BLIND STATS: availablePicks() always exposes each stat value; the UI decides
 * whether to paint it (blind by default). Pure logic, no DOM.
 */

import { toRealStats, moveId } from './sim.js';

export const STAT_KEYS = { 1: ['hp', 'atk', 'def', 'spc', 'spe'], 2: ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] };
const MOVE_SLOTS = 4;             // moves on the finished mon
const TYPE_SLOTS = 2;
const MOVE_CHOICE_COUNT = 10;     // moves shown per card, sampled from the full pool
const NEW_MOVE_WEIGHT = 12;       // weight for an unseen move vs 1 for a seen one
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

/**
 * Draw K distinct moves, weighting moves NOT in `seen` far higher than seen ones
 * (so rerolls "show new moves when possible") while still permitting a seen move
 * to reappear — i.e. with replacement across rerolls. Deterministic given rng.
 */
function weightedSampleDistinct(rng, pool, K, seen) {
  const avail = pool.map((m) => ({ m, w: seen.has(m) ? 1 : NEW_MOVE_WEIGHT }));
  const out = [];
  for (let k = 0; k < K && avail.length; k++) {
    let total = 0; for (const it of avail) total += it.w;
    let x = rng() * total, idx = 0;
    for (; idx < avail.length; idx++) { x -= avail[idx].w; if (x <= 0) break; }
    if (idx >= avail.length) idx = avail.length - 1;
    out.push(avail[idx].m);
    avail.splice(idx, 1);                 // distinct within a single draw
  }
  return out;
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

    this.stats = {};                 // statKey -> value (from the card it was taken on)
    this.typePicks = [];             // entries: real type string, or null for "—"
    this.moves = [];                 // up to 4 distinct move names
    this.silhouette = null;          // species object of the FIRST aspect pulled

    this.position = 0;               // committed cards
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
  // Predetermined move view for (position, pokeReroll, moveReroll). Replays
  // rerolls 0..moveReroll so the "seen" set (and thus the new-move weighting) is
  // reproducible. Pure function of the seed + indices.
  _moveListAt(species, position, pokeReroll, moveReroll) {
    const pool = species.learnset || [];
    const K = this.moveSample;
    if (pool.length <= K) return pool.slice();   // fewer than K moves → show them all
    let seen = new Set();
    let view = [];
    for (let r = 0; r <= moveReroll; r++) {
      const rng = makeRng(subSeed(this.seed, 2, position, pokeReroll, r));
      view = weightedSampleDistinct(rng, pool, K, seen);
      for (const m of view) seen.add(m);
      if (seen.size >= pool.length) seen = new Set();   // wrapped the pool → reset
    }
    return view;
  }
  _refresh() {
    this._card = this._speciesAt(this.position, this.pokeReroll);
    this._moveList = this._moveListAt(this._card, this.position, this.pokeReroll, this.moveReroll);
  }
  _advance() { this.position++; this.pokeReroll = 0; this.moveReroll = 0; this._refresh(); }
  advance() { this._advance(); }
  _markFace() { if (!this.silhouette) this.silhouette = this._card; }

  // ---- queries ----
  get current() { return this._card; }
  cardIsMono() { return (this._card.types || []).filter(Boolean).length === 1; }
  openStatSlots() { return this.statKeys.filter((k) => !(k in this.stats)); }

  /** Resolved real types: unique, in pick order (a repeat collapses to mono). */
  get types() {
    const seen = new Set(), out = [];
    for (const t of this.typePicks) { if (t === null || seen.has(t)) continue; seen.add(t); out.push(t); }
    return out;
  }
  /** True if the player explicitly took a "—" pick. */
  get typeNone() { return this.typePicks.includes(null); }
  typeSlotsFilled() { return this.typePicks.length; }
  typeSlotsOpen() { return TYPE_SLOTS - this.typePicks.length; }
  moveSlotsOpen() { return MOVE_SLOTS - this.moves.length; }
  canPickNoType() { return this.cardIsMono() && this.typeSlotsOpen() > 0 && !this.typePicks.includes(null); }

  /** Two-slot display, e.g. ['Fire','—'] for Fire+Fire; '?' pads empty slots. */
  typeDisplay() {
    const seen = new Set(), disp = [];
    for (const t of this.typePicks) {
      if (t === null) disp.push('\u2014');
      else if (seen.has(t)) disp.push('\u2014');     // duplicate type → mono dash
      else { seen.add(t); disp.push(t); }
    }
    while (disp.length < 2) disp.push('?');
    return disp;
  }

  availablePicks() {
    const picks = { stats: [], types: [], moves: [], canPickNoType: this.canPickNoType() };
    const c = this._card;
    for (const k of this.openStatSlots()) picks.stats.push({ stat: k, value: c.baseStats[k] }); // UI may hide value
    if (this.typeSlotsOpen() > 0) {                  // a card type is pickable even if already owned (→ mono)
      const seen = new Set();
      for (const t of c.types) { if (!t || seen.has(t)) continue; seen.add(t); picks.types.push(t); }
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

  // ---- record a pick on the CURRENT card (does NOT advance) ----------------
  pickStat(statKey) {
    if (!(statKey in this.stats) && this.statKeys.includes(statKey) && this.openStatSlots().length > 0) {
      this.stats[statKey] = this._card.baseStats[statKey];     // value comes from THIS card
      this._markFace(); return true;
    }
    return false;
  }
  pickType(typeName) {
    if (this.typeSlotsOpen() > 0 && this._card.types.includes(typeName)) {  // twice allowed → mono
      this.typePicks.push(typeName); this._markFace(); return true;
    }
    return false;
  }
  pickNoType() {
    if (!this.canPickNoType()) return false;
    this.typePicks.push(null); this._markFace(); return true;
  }
  pickMove(moveName) {
    if (this.moveSlotsOpen() > 0 && this._moveList.includes(moveName) && !this.moves.includes(moveName)) {
      this.moves.push(moveName); this._markFace(); return true;
    }
    return false;
  }

  _applyPick(p) {
    if (!p) return false;
    if (p.type === 'stat') return this.pickStat(p.key);
    if (p.type === 'type') return this.pickType(p.value);
    if (p.type === 'none') return this.pickNoType();
    if (p.type === 'move') return this.pickMove(p.value);
    return false;
  }

  /**
   * Apply up to two picks taken FROM THE CURRENT CARD, then advance to the next
   * card. Invalid picks are skipped (never corrupt state). Returns the count
   * actually applied. picks: [{type:'stat',key},{type:'type',value},
   * {type:'none'},{type:'move',value}]
   */
  commitCard(picks) {
    let n = 0;
    for (const p of (picks || [])) { if (this._applyPick(p)) n++; }
    this._advance();
    return n;
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

  /** Predetermined choice list for the current card (owned moves included so the
   *  UI can render them as already-taken). */
  get moveChoices() { return this._moveList.slice(); }

  /** Free skip — only when the card offers no valid pick (anti-soft-lock). */
  skipIfStuck() { if (!this.hasLegalPick()) { this._advance(); return true; } return false; }

  result() {
    if (!this.isComplete()) throw new Error('draft not complete');
    const baseStats = { ...this.stats };
    const real = this.types;                                  // unique real types
    const types = [real[0] || null, real[1] || null];
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
    const p = s.availablePicks();
    const bag = [];
    for (const st of p.stats) bag.push({ type: 'stat', key: st.stat });
    for (const t of p.types) bag.push({ type: 'type', value: t });
    for (const m of p.moves) bag.push({ type: 'move', value: m });
    if (p.canPickNoType) bag.push({ type: 'none' });
    if (!bag.length) { s.skipIfStuck(); continue; }
    const slotsRem = s.openStatSlots().length + s.typeSlotsOpen() + s.moveSlotsOpen();
    const need = Math.min(2, slotsRem, bag.length);
    const chosen = [];
    const pool = bag.slice();
    for (let i = 0; i < need; i++) { const idx = Math.floor(rng() * pool.length); chosen.push(pool[idx]); pool.splice(idx, 1); }
    s.commitCard(chosen);
  }
  return s.result();
}

// ===========================================================================
//  DATA ADAPTERS  (unchanged from 0.4.1)
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

const MOVE_ALIASES = {
  'faint attack': 'Feint Attack', 'hi jump kick': 'High Jump Kick',
  'foresoght': 'Foresight', 'ponud': 'Pound', 'safegurard': 'Safeguard',
  'whirwind': 'Whirlwind', 'vicegrip': 'Vise Grip',
};

/** Clean one raw move token to a canonical display name, or null to drop it. */
export function canonicalizeMove(raw) {
  let s = String(raw).trim();
  s = s.split(/\s+Maximum Stats/i)[0].trim();
  s = s.replace(/^["'(\s]+/, '').replace(/["')\s]+$/, '');
  if (!s || DASH.test(s)) return null;
  const lc = s.toLowerCase();
  if (MOVE_ALIASES[lc]) return MOVE_ALIASES[lc];
  return s;
}

/** Build { speciesNameLower: [valid move display names] } from movelist-genN.json */
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

// Ditto (Transform only) and Unown (Hidden Power only) have no real movepool.
const EXCLUDE_DRAFT = new Set(['ditto', 'unown']);

/** Build the draftable species list (valid stats + ≥1 type; Ditto/Unown out). */
export function buildSpeciesList(genData, learnsetMap = null, gen = 2) {
  return (genData.pokedex || [])
    .map((entry) => normalizeSpecies(entry, gen, learnsetMap))
    .filter((s) => s.baseStats && s.types.length >= 1 && !EXCLUDE_DRAFT.has(String(s.name).toLowerCase()));
}
