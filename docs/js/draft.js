/**
 * @file        docs/js/draft.js   (PokeGuess — Draft Battle engine)
 * @version     0.10.0
 * @updated     2026-07-15
 * @changelog
 *   0.10.0 — Added resolveDefeatedCascade(): the down-the-ladder bump for a
 *           normal gauntlet claim. When a player takes a spot, the DEFEATED
 *           standing holder is pushed down one rung, chaining through any
 *           further player-held rungs below (each shifts down one), while
 *           NPC-held rungs absorb the cascade and a human pushed off the
 *           bottom falls off the ladder. This is the "cascade the previous
 *           champion down" behavior that the claim path never actually
 *           performed — resolveThroneCascade only ever handled the separate
 *           one-mon-two-spots case. Pure / unit-tested.
 *   0.9.4 — Hidden Power type selection: Hidden Power is no longer stripped
 *           from learnsets; when it is offered on a draft card it is assigned a
 *           random Gen-2-legal elemental type (any type except Normal) and
 *           shown as "Hidden Power (Type)". The type is deterministic per
 *           (seed, card position, reroll) so drafts still replay identically,
 *           and per-occurrence so re-rolling or a later card can surface a
 *           different type. The sim already resolves the typed name (HP_TYPE_RE
 *           in sim.js); the draft-card UI renders the move name verbatim, so no
 *           UI change was needed. See HP_DRAFT_TYPES / _typeHiddenPower below.
 *   0.9.3 — Simplified-moves pass pool adjustments: un-banned MIST (now
 *           implemented in sim.js — blocks opponent-induced stat drops for 5
 *           turns, meaningful in 1v1); banned HEAL BELL and PSYCH UP (tiny
 *           wins not worth the special-casing, per request). Perish Song stays
 *           banned.
 *   0.9.2 — Tier-3 pool adjustments (requested rule of thumb: implement if
 *           clean, otherwise ban). Un-banned SNORE (now implemented in sim.js
 *           2.7.0 as an asleep-only move). Banned SLEEP TALK (needs nested
 *           random-move execution while asleep — disproportionate risk; it was
 *           also a draftable dead no-op until now) and FUTURE SIGHT (real
 *           delayed 2-turn hit is a new timing system; had been firing as an
 *           immediate 120 nuke). Disable/Encore remain banned as before.
 *   0.9.1 — Added Destiny Bond to BANNED_DRAFT_MOVES (requested alongside the
 *           sim.js Tier-2 batch). Like the other faint/switch-dependent bans,
 *           it has no meaningful behavior in a switchless 1v1 win-% sim, so
 *           it's kept out of the pool rather than modeled in sim.js.
 *   0.9.0 — Requested: no Pokemon can appear more than once in a single
 *           draft. _speciesAt() now excludes species already shown earlier
 *           in the same draft (tracked in a new _seenSpecies set, populated
 *           by _refresh() the moment a card is displayed — a rerolled-past
 *           card counts as "shown" too, not just one a pick was taken from).
 *           This makes _speciesAt() history-dependent rather than a pure
 *           function of (position, pokeReroll) alone, but replaying the same
 *           seed still reproduces the exact same sequence, since the history
 *           leading to any given position is itself deterministic. Changed
 *           WINNING_SEED's greedy-drafted result in throne.smoke.mjs (seed 7
 *           happened to draw the same species twice; excluding the repeat
 *           changes which card gets picked from that point on) — re-found a
 *           new seed that still sweeps every Elite-4 tier.
 *   0.8.0 — #12/#13: added isTierUnlocked + nextProgressRank. The Elite-4 unlock
 *           gate was based on "do you CURRENTLY hold the previous tier's
 *           throne," which the #14a one-throne cascade AND every tier's own
 *           cadence reset both silently break (moving up — or just time
 *           passing — vacates a lower throne, relocking everything above it
 *           even though the player genuinely already beat it). Progress is now
 *           tracked as a separate, monotonic "highest tier ever reached" value
 *           (draftbattle.js persists it at /draft/progress/{uid}), so vacating
 *           a lower throne can no longer erase earned progress.
 *   0.7.0 — #14a: added resolveThroneCascade (pure decision logic) + TIER_RANK. A single Pokémon/session can only hold one Elite-4 spot: claiming a higher throne while already holding a lower one vacates the lower one (bumping the just-defeated holder down into it if they were human, or leaving it for a fresh NPC if not); trying to claim a lower throne while already holding a higher one keeps the higher one instead.
 *   0.6.0 — #7: added autoDraftScaled — rejection-samples autoDraft with a deterministic incrementing sub-seed until the resulting base-stat total lands in a target band (e.g. 525–550 for Bruno), preserving the "every stat is a real Pokémon’s real stat" design rather than mutating totals directly. Falls back to the closest-fit result if a band is unreachable within maxAttempts.
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
    // #2 (requested) — species already SHOWN this draft (whether a pick was
    // taken from them or not — a rerolled-past card still counts as "shown"),
    // excluded from every later card so no Pokemon can appear twice in one
    // draft. Populated by _refresh() the moment a card is displayed.
    this._seenSpecies = new Set();
    this._refresh();
  }

  // ---- deterministic derivations ----
  // Deterministic given the seed + indices, EXCEPT for the exclusion of
  // species already shown earlier in this same draft (this._seenSpecies) —
  // that's inherently a history-dependent constraint (see #2 above), not a
  // pure function of (position, pokeReroll) alone. Replaying the exact same
  // draft from the same seed reproduces the exact same sequence either way,
  // since the history leading to any given position is itself deterministic.
  _speciesAt(position, pokeReroll) {
    const rng = makeRng(subSeed(this.seed, 1, position, pokeReroll));
    const pool = this.species.filter((s) => !this._seenSpecies.has(s.name));
    // Guard only: with a species pool in the hundreds and a draft showing at
    // most a couple dozen cards even with every reroll used, the pool should
    // never actually run out — but never let an edge case throw.
    return pickFrom(rng, pool.length ? pool : this.species);
  }
  // Predetermined move view for (position, pokeReroll, moveReroll). Replays
  // rerolls 0..moveReroll so the "seen" set (and thus the new-move weighting) is
  // reproducible. Pure function of the seed + indices.
  _moveListAt(species, position, pokeReroll, moveReroll) {
    const pool = species.learnset || [];
    const K = this.moveSample;
    if (pool.length <= K) return this._typeHiddenPower(pool.slice(), position, pokeReroll, moveReroll);   // fewer than K moves → show them all
    let seen = new Set();
    let view = [];
    for (let r = 0; r <= moveReroll; r++) {
      const rng = makeRng(subSeed(this.seed, 2, position, pokeReroll, r));
      view = weightedSampleDistinct(rng, pool, K, seen);
      for (const m of view) seen.add(m);
      if (seen.size >= pool.length) seen = new Set();   // wrapped the pool → reset
    }
    return this._typeHiddenPower(view, position, pokeReroll, moveReroll);
  }
  // Replace a plain "Hidden Power" offered on this card with a randomly-typed
  // "Hidden Power (Type)" (Gen-2-legal types only — see HP_DRAFT_TYPES). The
  // type is a pure function of (seed, position, pokeReroll, moveReroll, slot),
  // so a replayed draft is identical, while a different card / reroll / slot
  // can surface a different type ("random per occurrence"). Already-typed
  // names (containing "(") are left untouched so this never double-types.
  _typeHiddenPower(view, position, pokeReroll, moveReroll) {
    return view.map((nm, i) => {
      if (!isHiddenPower(nm) || String(nm).includes('(')) return nm;
      const rng = makeRng(subSeed(this.seed, 7, position, pokeReroll, moveReroll, i));
      const type = HP_DRAFT_TYPES[Math.floor(rng() * HP_DRAFT_TYPES.length)];
      return `Hidden Power (${type})`;
    });
  }
  _refresh() {
    this._card = this._speciesAt(this.position, this.pokeReroll);
    this._seenSpecies.add(this._card.name);
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

/**
 * #7 — an NPC Elite-4 opponent scaled to a target base-stat-total band (e.g.
 * Koga: 475–500). autoDraft's stat "cards" are each a REAL Pok\u00e9mon's real
 * stat, so a target total can't just be assigned directly without either
 * breaking that "every stat is real" property or reimplementing the card
 * picker's internals. Rejection sampling preserves it exactly: keep
 * autoDraft-ing with a deterministic, incrementing sub-seed until the result
 * lands in-band. Empirically fast (sampled distribution has a natural median
 * around 410, so even the rarest target band above 575 converges within a
 * few hundred attempts, and each attempt is well under a millisecond) — and
 * this only ever runs once per (tier, period), not per render. Falls back to
 * the closest-to-band result seen if maxAttempts is somehow exhausted, so a
 * pathological pool never causes an infinite loop or a thrown error.
 */
export function autoDraftScaled({ species, gen = 2, seed, playerName, minTotal, maxTotal, maxAttempts = 800 }) {
  let best = null, bestDist = Infinity;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptSeed = subSeed(seed >>> 0, attempt);
    const result = autoDraft({ species, gen, seed: attemptSeed, playerName });
    const total = Object.values(result.baseStats).reduce((a, b) => a + b, 0);
    if (total >= minTotal && total <= maxTotal) return result;
    const dist = total < minTotal ? minTotal - total : total - maxTotal;
    if (dist < bestDist) { bestDist = dist; best = result; }
  }
  return best;
}

/**
 * #14a — pure decision logic for "a single Pok\u00e9mon/session can only hold ONE
 * Elite-4 spot at a time." Given that a player already holds `oldTierKey` and
 * has just won a battle to claim `newTierKey`, decide what happens — no I/O,
 * fully testable in isolation from claimThrone's Firebase reads/writes.
 * @returns {{action:'claimNewVacateOld', vacatedTier:string, bump:object|null} | {action:'keepOld', keptTier:string}}
 */
export function resolveThroneCascade({ newTierKey, oldTierKey, tierRank, defeatedUid, defeatedMon, champLabel }) {
  const newRank = tierRank[newTierKey] || 0;
  const oldRank = tierRank[oldTierKey] || 0;
  if (newRank > oldRank) {
    return {
      action: 'claimNewVacateOld',
      vacatedTier: oldTierKey,
      bump: (defeatedUid && defeatedMon) ? { holderUid: defeatedUid, mon: defeatedMon, holderName: champLabel || 'A challenger' } : null,
    };
  }
  return { action: 'keepOld', keptTier: oldTierKey };
}

export const TIER_RANK = { day: 1, week: 2, month: 3, year: 4, all: 5 };

/**
 * Down-the-ladder cascade for a normal gauntlet claim: the player takes
 * `takenTierKey`, and whoever was HOLDING that spot (if a real player, not an
 * NPC) is pushed DOWN exactly one rung. If that lower rung was itself held by a
 * real player, that player is pushed down too, and so on — a chain of human
 * holders each shifting down one spot. An NPC-held rung (no persisted holder)
 * ABSORBS the cascade: a displaced player landing there simply overwrites the
 * NPC, and the chain stops (there was no human there to displace further). A
 * human pushed off the bottom rung falls off the ladder entirely.
 *
 * This is deliberately SEPARATE from resolveThroneCascade (#14a), which handles
 * the different case of one Pokémon trying to hold two spots at once. This one
 * is about the DEFEATED standing holder(s), and only ever moves players DOWN.
 *
 * Pure: no Firebase, no DOM. Takes the current throne map as plain data and
 * returns the set of writes to apply.
 *
 * @param {object} args
 * @param {string} args.takenTierKey        the tier the player is claiming
 * @param {object} args.playerRecord        {holderUid, holderName, mon} to install at takenTierKey
 * @param {Record<string, object|null>} args.thrones  current holders by tier key; a value is a real
 *        player only if it has a truthy holderUid (NPC/vacant spots are null/absent or lack holderUid)
 * @param {string[]} args.tierKeysHighToLow tier keys ordered HIGHEST first (e.g. ['all','year',...,'day'])
 * @returns {Record<string, object|null>} writes to apply: tierKey -> record to set, or null to clear
 *          (clearing lets that tier fall back to a fresh NPC). Only changed tiers are included.
 */
export function resolveDefeatedCascade({ takenTierKey, playerRecord, thrones, tierKeysHighToLow }) {
  const writes = {};
  const isPlayerHeld = (rec) => !!(rec && rec.holderUid);
  const asHolder = (rec) => ({ holderUid: rec.holderUid, holderName: rec.holderName || 'A challenger', mon: rec.mon });

  // The chain starts with whoever the player just displaced from the taken spot.
  let displaced = isPlayerHeld(thrones[takenTierKey]) ? asHolder(thrones[takenTierKey]) : null;
  // Install the player at the taken spot.
  writes[takenTierKey] = asHolder(playerRecord);

  // Walk strictly downward from the taken tier, carrying the displaced holder.
  const startIdx = tierKeysHighToLow.indexOf(takenTierKey);
  for (let i = startIdx + 1; i < tierKeysHighToLow.length; i++) {
    if (!displaced) break; // nothing left to place — the rest of the ladder is untouched
    const key = tierKeysHighToLow[i];
    const occupant = writes[key] !== undefined ? writes[key] : thrones[key];
    const occupantIsPlayer = isPlayerHeld(occupant);
    // Place the carried player here…
    writes[key] = displaced;
    // …and carry whoever WAS here only if they were a real player (NPCs absorb
    // the cascade and just get overwritten — no further push).
    displaced = occupantIsPlayer ? asHolder(occupant) : null;
  }
  // If `displaced` is still set here, a human was pushed off the bottom rung —
  // they simply fall off the ladder (no write needed; they're gone).
  return writes;
}

/**
 * #12/#13 — throne unlock gate, corrected.
 *
 * Previously, "have you beaten tier i-1" was computed as "does tier i-1's
 * throne CURRENTLY show your uid as holder." That's unreliable in two real
 * situations, both of which silently erase progress the player already
 * earned:
 *   1. The one-Pok\u00e9mon-one-throne cascade (#14a) itself: claiming a HIGHER
 *      tier vacates whatever lower tier you held, so the immediately-lower
 *      tier stops showing you as its holder the moment you move past it —
 *      relocking every tier above it as a side effect.
 *   2. A tier's own cadence reset (Day at midnight CT, Week/Month/Year on
 *      their own schedules): the throne you conquered can revert to a fresh
 *      NPC purely due to time passing, with the identical relocking effect.
 *
 * Fix: track the highest tier rank a player has EVER reached as a separate,
 * monotonic, persisted value (see claimThrone's write to /draft/progress).
 * Unlocking a tier now asks "have I EVER reached the tier just below this
 * one," not "do I physically hold it RIGHT NOW" — so vacating a lower throne
 * (by cascade or by reset) can no longer relock tiers above it.
 *
 * @param {number} tierIndex index into the TIERS display array (0 = Will/day)
 * @param {number} myProgressRank the player's persisted highest-ever rank (0 if none)
 * @param {string[]} tierKeysInOrder TIERS.map(t => t.key), in display order
 * @param {Record<string, number>} tierRank TIER_RANK
 */
export function isTierUnlocked(tierIndex, myProgressRank, tierKeysInOrder, tierRank) {
  if (tierIndex <= 0) return true;
  const prevKey = tierKeysInOrder[tierIndex - 1];
  return (myProgressRank || 0) >= (tierRank[prevKey] || 0);
}

/** The new persisted progress value after claiming `claimedTierKey` — monotonic
 *  (never decreases), so a later vacate/reset of that same throne can't undo it. */
export function nextProgressRank(currentRank, claimedTierKey, tierRank) {
  return Math.max(currentRank || 0, tierRank[claimedTierKey] || 0);
}

// ===========================================================================
//  DATA ADAPTERS  (unchanged from 0.4.1)
// ===========================================================================

const DASH = /^[\s\-\u2012\u2013\u2014\u2015\u2212]*$/;
const isBlank = (v) => v == null || DASH.test(String(v).trim()) || String(v).trim() === '';
const isHiddenPower = (n) => /^(hidden\s*power|hp)\b/i.test(String(n));

// Gen-2-legal Hidden Power types: every type EXCEPT Normal (Gen 2's DV-based
// type calc can never produce Normal, and Fairy doesn't exist in Gen 2). When
// Hidden Power is offered in a draft it's assigned one of these at random (see
// DraftSession._typeHiddenPower); the sim resolves the resulting
// "Hidden Power (Type)" name via HP_TYPE_RE in sim.js.
const HP_DRAFT_TYPES = [
  'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
  'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark',
];

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
// #6j — removed from the draft pool: mostly switch/trapping/opponent-move-set
// effects that don't make sense in a switchless 1v1 sim (Whirlwind, Roar,
// Baton Pass, Disable, Mean Look, Mind Reader, Mist, Spider Web), moves with
// dynamically-changing movesets the sim can't model (Metronome, Mimic,
// Sketch, Transform, Mirror Move), and a handful of others called out
// explicitly. Never even offered during a draft, regardless of a species'
// real movepool.
const BANNED_DRAFT_MOVES = new Set([
  'attract', 'selfdestruct', 'explosion', 'batonpass', 'mirrormove', 'skullbash',
  'rage', 'teleport', 'perishsong', 'conversion', 'disable', 'encore',
  'falseswipe', 'foresight', 'meanlook', 'metronome', 'mimic', 'mindreader',
  'roar', 'whirlwind', 'sketch', 'skyattack', 'spite',
  'spikes', 'spiderweb', 'sweetscent', 'thief', 'transform', 'destinybond',
  'sleeptalk', 'futuresight', 'healbell', 'psychup',
].map(moveId));

export function buildLearnsetMap(movelist, moveStats) {
  const have = new Set(Object.keys(moveStats || {}));
  const map = {};
  for (const [name, list] of Object.entries(movelist || {})) {
    const out = [];
    const seenIds = new Set();
    for (const item of (list || [])) {
      const raw = typeof item === 'string' ? item : (item && item.move);
      const nm = canonicalizeMove(raw);
      if (!nm) continue;
      // Hidden Power is kept (previously stripped): it stays as the plain
      // "Hidden Power" name in the learnset pool and is assigned a random
      // elemental type only when actually offered on a card, by
      // DraftSession._typeHiddenPower — see HP_DRAFT_TYPES.
      const id = moveId(nm);
      if (!have.has(id) || seenIds.has(id) || BANNED_DRAFT_MOVES.has(id)) continue;     // sim-valid + dedupe + not banned
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
