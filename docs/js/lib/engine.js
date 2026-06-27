/**
 * @file        js/lib/engine.js
 * @version     1.1.0
 * @updated     2026-06-23
 * @changelog
 *   1.1.0 — Evolution cross-deductions: revealing Current Evolution Stage
 *           locks Can Evolve + Evolves From (and the reverse); single-stage/middle
 *           pins family size; Evolution Method stays reachable via stage. Guesses
 *           must be a real Pokémon from this gen's list (unknown → no penalty).
 *   1.0.0 — Initial port. A DOM-free `PokeGuessRound` that owns the guess-game
 *           round rules: clue pools, availability (difficulty locks, prereqs,
 *           contextual cross-inference, exhaustion, single-use), rising/discounted
 *           costs, purchase limits, clue-value computation (all specials),
 *           category-diversity, the weighted random reveal, guessing and scoring.
 *           Ported VERBATIM from the canonical Gen 2 HTML (the newer superset);
 *           the only structural change is that the moveset clues (which have
 *           different numeric ids in Gen 1 vs Gen 2) are resolved by `special`/
 *           `field` instead of hard-coded ids, so ONE engine drives BOTH gens
 *           from data. Concepts with ids ≤26 are identical across gens and keep
 *           their literal ids. No rule was changed.
 *
 * Contract (SPEC §6): `export class PokeGuessRound`, `export function normalizeName`.
 * A controller builds one round, calls clueAvailable/clueCurrentCost/buyClue/
 * submitGuess, and reads round state — it never re-implements rules.
 */

// ---- name matching (used by guess check + autocomplete) --------------------
export function normalizeName(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// ---- small helpers (ported) ------------------------------------------------
const DASH_RE = /^[\u002d\u2010\u2011\u2012\u2013\u2014\u2015\u2212]+$/;
const _isDashOrEmpty = (v) => { v = (v == null ? '' : String(v)).trim(); return !v || DASH_RE.test(v); };

function shuffleArr(a, rng) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const _genLabel = (poke) => (parseInt(poke && poke.num, 10) <= 151 ? '1st' : '2nd');

function animeFirstText(poke) {
  const v = (poke && poke.firstAnime == null ? '' : String(poke.firstAnime)).trim();
  if (_isDashOrEmpty(v)) return 'Does not appear in the anime (Seasons 1\u20135 / first four films)';
  return v;
}
function animeAcqEvoText(poke) {
  const v = (poke && poke.animeAcqEvo == null ? '' : String(poke.animeAcqEvo)).trim();
  if (!v || v.toLowerCase() === 'no' || _isDashOrEmpty(v)) return 'No on-screen acquisition or evolution (in scope)';
  return v.split(';').map((part) => {
    const mm = part.trim().match(/^([CEce])\s*:\s*(.+)$/);
    if (!mm) return part.trim();
    return (mm[1].toUpperCase() === 'C' ? 'Acquired ' : 'Evolved ') + mm[2].trim();
  }).join('; ');
}

// ===========================================================================
export class PokeGuessRound {
  /**
   * @param {object} o
   * @param {object} o.genData  parsed gen{N}.json: { id, pokedex, clues,
   *                            categories, difficulties, multiClue }
   * @param {object} [o.movelist]  parsed movelist-gen{N}.json (for moveset clues)
   * @param {() => number} [o.rng]  injectable RNG (deterministic modes)
   */
  constructor(o) {
    const g = o.genData || {};
    this.pokedex = g.pokedex || [];
    this.clues = g.clues || [];
    this.categories = g.categories || [];
    this.difficulties = g.difficulties || [];
    this.multiClue = g.multiClue || {};
    this.movelist = o.movelist || {};
    this.rng = o.rng || Math.random;
    this.allNames = this.pokedex.map((p) => p.name);
    this._validGuesses = new Set(this.allNames.map((n) => normalizeName(n)));
    this._clueById = new Map(this.clues.map((c) => [c.id, c]));
    // moveset clues differ in id across gens → resolve by special/field
    this._idBySpecial = {};
    this._idByField = {};
    for (const c of this.clues) {
      if (c.special && this._idBySpecial[c.special] == null) this._idBySpecial[c.special] = c.id;
      if (c.field && this._idByField[c.field] == null) this._idByField[c.field] = c.id;
    }
    this.state = null;
  }

  clue(id) { return this._clueById.get(id); }

  // ids of the moveset clues, gen-agnostic
  _compId() { return this._idBySpecial.compMovesetMulti ?? this._idBySpecial.compMoveset ?? this._idByField.compMoveset1; }
  _exampleId() { return this._idBySpecial.exampleMovesetMulti ?? this._idByField.exampleMoveset; }
  _eggId() { return this._idBySpecial.eggMoveMulti ?? this._idBySpecial.eggMove ?? this._idByField.eggMove; }
  _tmId() { return this._idBySpecial.tmHmMulti ?? this._idByField.tmHmMove; }

  // ---- round setup --------------------------------------------------------
  /**
   * Begin a round. For preset difficulties, points/guessCost/start-clues come
   * from difficulties config. Pass `custom` to drive everything yourself.
   */
  start(opts = {}) {
    const {
      difficultyId = 'normal', poolFilter = 'both', mystery = null,
      guessMode = 'free',        // 'free' | 'forced'
      clueMode = 'choose',       // 'choose' | 'random' | 'category'
      catDiversity = 'free',     // 'free' | 'diff' | 'cycle'
      custom = null,             // { points, guessCost, startClueMode, lockedCats, lockedClues, limits }
      startClueIds = null,       // explicit pre-reveals (custom 'pick')
    } = opts;

    const diff = this.difficulties.find((d) => d.id === difficultyId);
    let points, guessCost, startClueMode;
    let diffRestrictions = null;
    if (difficultyId === 'custom') {
      const c = custom || {};
      points = Math.max(1, Math.min(999, c.points ?? 50));
      guessCost = Math.max(0, Math.min(5, c.guessCost ?? 1));
      startClueMode = c.startClueMode || 'none';
      diffRestrictions = null; // custom games have no restrictions
    } else {
      if (!diff) throw new Error(`unknown difficulty: ${difficultyId}`);
      points = diff.points; guessCost = diff.guessCost; startClueMode = diff.startClues;
      diffRestrictions = {
        lockedCats: diff.lockedCats || [],
        lockedClues: diff.lockedClues || [],
        limits: diff.limits || {},
      };
    }

    const pool = this.pokedex.filter((p) => {
      const n = parseInt(p.num, 10);
      if (poolFilter === 'gen1') return n >= 1 && n <= 151;
      if (poolFilter === 'gen2') return n >= 152 && n <= 251;
      return n >= 1 && n <= 251;
    });
    if (!pool.length) throw new Error('no Pokémon in selected pool');
    const chosen = mystery || pool[Math.floor(this.rng() * pool.length)];

    this.state = {
      mystery: chosen,
      pointsRemaining: points, startingPoints: points, guessCost,
      revealedClues: {}, guesses: [], gameOver: false, gameResult: null,
      clueSpendByCat: {}, guessCostTotal: 0, clueHistory: {},
      guessMode, clueMode, forcedPhase: guessMode === 'forced' ? 'guess' : null,
      weaknessesPool: [], resistancesPool: [], tmHmsPool: [], eggMovesPool: [],
      compMovesetsPool: [], allMovesPool: [],
      lastRandomRevealCat: null,
      forceDiffCat: catDiversity === 'diff', cycleCats: catDiversity === 'cycle',
      lastChosenClueCat: null, catCycleVisited: [], lastRevealedClueId: null,
      diffRestrictions,
    };
    this._initCluePools(chosen);

    // pre-revealed start clues
    let startIds = [];
    if (startClueMode === 'easy') {
      const cheap = shuffleArr(this.clues.filter((c) => c.cost <= 4 && this.clueAvailable(c)).map((c) => c.id), this.rng);
      if (cheap.length) startIds.push(cheap[0]);
    } else if (startClueMode === 'custom' && Array.isArray(startClueIds)) {
      startIds = startClueIds.slice();
    }
    const revealed = [];
    for (const id of startIds) {
      const c = this.clue(id); if (!c) continue;
      const v = this._computeClueValue(c); if (v === null) continue;
      (this.state.clueHistory[id] ||= []).push(v);
      this.state.revealedClues[id] = v;
      this.state.clueSpendByCat[c.cat] = (this.state.clueSpendByCat[c.cat] || 0) + c.cost;
      revealed.push(c.name);
    }
    if (startIds.length) {
      const lastPre = this.clue(startIds[startIds.length - 1]);
      if (lastPre && (this.state.forceDiffCat || this.state.cycleCats)) this.state.lastChosenClueCat = lastPre.cat;
      if (this.state.cycleCats) {
        this.state.catCycleVisited = [...new Set(startIds.map((id) => this.clue(id)?.cat).filter(Boolean))];
      }
    }
    return { mystery: chosen, points, preRevealed: revealed };
  }

  _initCluePools(poke) {
    const s = this.state;
    const weaknesses = (poke.allWeaknesses || '').split(',').map((x) => x.trim()).filter(Boolean);
    s.weaknessesPool = shuffleArr(weaknesses, this.rng);
    const resistances = (poke.allResistances || '').split(',').map((x) => x.trim()).filter(Boolean);
    s.resistancesPool = shuffleArr(resistances, this.rng);

    const allMoves = this.movelist[poke.name.toLowerCase()] || [];

    let tmhms = [...new Set(allMoves.filter((m) => m.source === 'TM / HM').map((m) => m.move))];
    if (!tmhms.length && poke.tmHmMove && poke.tmHmMove !== '\u2014') tmhms.push(poke.tmHmMove);
    if (tmhms.some((m) => /all\s+of\s+them/i.test(m))) {
      const set = new Set();
      Object.values(this.movelist).forEach((ms) => ms
        .filter((m) => m.source === 'TM / HM' && !/all\s+of\s+them/i.test(m.move))
        .forEach((m) => set.add(m.move)));
      tmhms = [...set];
    }
    s.tmHmsPool = shuffleArr(tmhms, this.rng);

    let eggs = [...new Set(allMoves.filter((m) => m.source === 'Egg Move').map((m) => m.move))];
    if (!eggs.length && poke.eggMove && poke.eggMove !== 'None' && poke.eggMove !== '\u2014') eggs.push(poke.eggMove);
    if (eggs.some((m) => /all\s+of\s+them/i.test(m))) {
      const set = new Set();
      Object.values(this.movelist).forEach((ms) => ms
        .filter((m) => m.source === 'Egg Move' && !/all\s+of\s+them/i.test(m.move))
        .forEach((m) => set.add(m.move)));
      eggs = [...set];
    }
    s.eggMovesPool = shuffleArr(eggs, this.rng);

    const comps = [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4];
    s.compMovesetsPool = shuffleArr(comps.map((m, i) => (m && m.trim() ? i : -1)).filter((i) => i >= 0), this.rng);

    s.allMovesPool = allMoves.map((m) => m.move).filter(Boolean);
    if (!s.allMovesPool.length && poke.exampleMoveset) {
      s.allMovesPool = poke.exampleMoveset.split('/').map((x) => x.trim()).filter(Boolean);
    }
  }

  // ---- availability / locks / exhaustion ----------------------------------
  difficultyLock(clue) {
    const r = this.state.diffRestrictions;
    if (!r) return null;
    if ((r.lockedCats || []).includes(clue.cat)) {
      const cat = this.categories.find((c) => c.id === clue.cat);
      return 'Locked on this difficulty (' + (cat ? cat.name : 'category') + ')';
    }
    if ((r.lockedClues || []).includes(clue.id)) return 'This clue is locked on this difficulty';
    return null;
  }

  clueExhausted(clue) {
    const s = this.state;
    const uses = (s.clueHistory[clue.id] || []).length;
    const sp = clue.special;
    const M = this.multiClue;
    if (sp === 'weaknessMulti') {
      const pool = s.weaknessesPool || []; if (!pool.length) return true;
      return uses >= Math.min(M.maxWeaknessReveals, pool.length) + 1;
    }
    if (sp === 'resistanceMulti') {
      const pool = s.resistancesPool || []; if (!pool.length) return true;
      return uses >= Math.min(M.maxResistanceReveals, pool.length) + 1;
    }
    if (sp === 'tmHmMulti') return uses >= (s.tmHmsPool || []).length + 1;
    if (sp === 'eggMoveMulti') return uses >= (s.eggMovesPool || []).length + 1;
    if (sp === 'compMovesetMulti') return uses >= (s.compMovesetsPool || []).length + 1;
    if (clue.maxUses && clue.maxUses > 0) return uses >= clue.maxUses;
    return false;
  }

  clueAvailable(clue, revealedOverride) {
    if (clue.enabled === false) return false;
    if (revealedOverride === undefined && this.difficultyLock(clue)) return false;
    const rv = revealedOverride !== undefined ? revealedOverride : this.state.revealedClues;
    const poke = this.state.mystery;

    if (clue.requiresClueId != null && !(clue.requiresClueId in rv)) return false;
    if (this.clueExhausted(clue)) return false;
    if (clue.maxUses === 1 && (clue.id in rv)) return false;

    // contextual cross-inference (ids ≤26 are identical across gens)
    // Evolution cluster — fields: 8 familySize, 9 evoStage, 10 canEvolve,
    //   11 evolvesFrom, 12 evoMethod. evoStage ∈ {single-stage,unevolved,middle,final}.
    // Evolution Method only matters if it evolves from something — known either
    // directly (11=Yes) or implied by stage (middle/final).
    if (clue.id === 12) {
      const efYes = rv[11] === 'Yes' || rv[9] === 'middle' || rv[9] === 'final';
      if (!efYes) return false;
    }
    if ([9, 10, 11, 12].includes(clue.id) && rv[8] === '1') return false;
    // Current Evolution Stage fully determines Can Evolve + Evolves From …
    if ((clue.id === 10 || clue.id === 11) && (9 in rv)) return false;
    // … and the pair (Can Evolve + Evolves From) fully determines the Stage.
    if (clue.id === 9 && (10 in rv) && (11 in rv)) return false;
    // A single-stage or middle reveal pins the family size; so does No+No.
    if (clue.id === 8 && (rv[9] === 'single-stage' || rv[9] === 'middle' || (rv[10] === 'No' && rv[11] === 'No'))) return false;
    if (clue.id === 15 && (16 in rv) && (17 in rv)) return false;
    if ([18, 19, 20, 21, 22].includes(clue.id) && (23 in rv)) return false;
    if ([3, 4, 5, 6].includes(clue.id) && rv[2] !== 'Yes') return false;
    if (clue.id === 2 && (rv[3] === 'Yes' || rv[4] === 'Yes' || rv[5] === 'Yes' || rv[6] === 'Yes')) return false;
    if ([25, 26].includes(clue.id) && rv[24] === 'No') return false;
    if (clue.id === 24) {
      if (rv[25] === 'Yes') return false;
      if (rv[26] && !String(rv[26]).startsWith('No')) return false;
    }

    const sp = clue.special;
    if (sp === 'compMovesetMulti') {
      if (this.state.compMovesetsPool) return this.state.compMovesetsPool.length > 0;
      return [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4].some((m) => m && m.trim());
    }
    if (sp === 'compMoveset') return [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4].some((m) => m && m.trim());
    if (sp === 'firstAnime' && (poke.firstAnime == null || !String(poke.firstAnime).trim())) return false;
    if (sp === 'animeAcqEvo' && (poke.animeAcqEvo == null || !String(poke.animeAcqEvo).trim())) return false;
    return true;
  }

  // ---- cost (rising increments + contextual discounts) --------------------
  clueCurrentCost(clueId) {
    const clue = this.clue(clueId); if (!clue) return 0;
    const hist = this.state.clueHistory, rv = this.state.revealedClues;
    const uses = (hist[clueId] || []).length;
    let cost = clue.cost + (clue.costIncrement || 0) * uses;
    const weakReveals = (hist[13] || []).length;
    const resistReveals = (hist[14] || []).length;
    if (clueId === 23) cost = Math.max(1, cost - [18, 19, 20, 21, 22].filter((id) => id in rv).length);
    if (clueId === 9) cost = Math.max(1, cost - [10, 11].filter((id) => id in rv).length * 2);
    if (clueId === 8) cost = Math.max(1, cost - [10, 11].filter((id) => id in rv).length * 2);
    if (clueId === 16 || clueId === 17) cost = Math.max(1, cost - Math.floor((weakReveals + resistReveals) / 2));
    return cost;
  }

  // ---- purchase limits (Hard/Extreme) — resolved by special/field ----------
  clueLimitInfo(clue) {
    const r = this.state.diffRestrictions;
    if (!r || !r.limits) return { atLimit: false, note: '' };
    const lim = r.limits, hist = this.state.clueHistory;
    const count = (id) => (id == null ? 0 : (hist[id] || []).length);
    const compId = this._compId(), exId = this._exampleId(), eggId = this._eggId(), tmId = this._tmId();
    const sp = clue.special;
    const isComp = sp === 'compMovesetMulti' || sp === 'compMoveset' || clue.id === compId;
    const isExample = clue.id === exId;
    const isEgg = clue.id === eggId;
    const isTm = clue.id === tmId;

    if (isComp && lim.comp != null) {
      const used = count(compId), totalUsed = count(compId) + count(exId);
      if (used >= lim.comp) return { atLimit: true, note: 'Limit reached: ' + lim.comp + ' competitive moveset' + (lim.comp !== 1 ? 's' : '') };
      if (lim.moveTotal != null && totalUsed >= lim.moveTotal) return { atLimit: true, note: 'Limit reached: ' + lim.moveTotal + ' total moveset reveals' };
      let n = 'Limit: ' + lim.comp + ' competitive moveset' + (lim.comp !== 1 ? 's' : '');
      if (lim.moveTotal != null) n += ', ' + lim.moveTotal + ' total moveset reveals';
      return { atLimit: false, note: n };
    }
    if (isExample && lim.moveTotal != null) {
      const totalUsed = count(compId) + count(exId);
      if (totalUsed >= lim.moveTotal) return { atLimit: true, note: 'Limit reached: ' + lim.moveTotal + ' total moveset reveals' };
      return { atLimit: false, note: 'Limit: ' + lim.moveTotal + ' total moveset reveals (example + competitive)' };
    }
    if (isEgg && lim.egg != null) {
      const eggUsed = count(eggId), comboUsed = count(eggId) + count(tmId);
      if (eggUsed >= lim.egg) return { atLimit: true, note: 'Limit reached: ' + lim.egg + ' egg moves' };
      if (lim.eggTm != null && comboUsed >= lim.eggTm) return { atLimit: true, note: 'Limit reached: ' + lim.eggTm + ' egg + TM/HM moves combined' };
      let n = 'Limit: ' + lim.egg + ' egg moves';
      if (lim.eggTm != null) n += ', ' + lim.eggTm + ' egg + TM/HM combined';
      return { atLimit: false, note: n };
    }
    if (isTm && lim.eggTm != null) {
      const comboUsed = count(eggId) + count(tmId);
      if (comboUsed >= lim.eggTm) return { atLimit: true, note: 'Limit reached: ' + lim.eggTm + ' egg + TM/HM moves combined' };
      return { atLimit: false, note: 'Limit: ' + lim.eggTm + ' egg + TM/HM moves combined' };
    }
    return { atLimit: false, note: '' };
  }

  // ---- clue value (all specials) ------------------------------------------
  _computeClueValue(clue) {
    const poke = this.state.mystery;
    const raw = poke[clue.field] || '';
    const hist = this.state.clueHistory ? (this.state.clueHistory[clue.id] || []) : [];
    const uses = hist.length;
    const M = this.multiClue;
    switch (clue.special) {
      case 'weaknessMulti': {
        const pool = this.state.weaknessesPool || [];
        const maxR = Math.min(M.maxWeaknessReveals, pool.length);
        return (uses < maxR && uses < pool.length) ? pool[uses] : 'No more weaknesses to reveal';
      }
      case 'resistanceMulti': {
        const pool = this.state.resistancesPool || [];
        const maxR = Math.min(M.maxResistanceReveals, pool.length);
        return (uses < maxR && uses < pool.length) ? pool[uses] : 'No more resistances to reveal';
      }
      case 'randomType': {
        const types = [poke.type1, ...(poke.type2 && poke.type2 !== '\u2014' && poke.type2 !== '-' ? [poke.type2] : [])];
        return types[Math.floor(this.rng() * types.length)];
      }
      case 'secondType': {
        const already = this.state.revealedClues[16];
        if (!poke.type2 || poke.type2 === '\u2014' || poke.type2 === '-') return '\u2014 (pure ' + poke.type1 + '-type)';
        if (already) { const other = [poke.type1, poke.type2].find((t) => t !== already); return other || poke.type2; }
        return poke.type2;
      }
      case 'immunityYesNo':
        return (raw && raw !== '\u2014') ? 'Yes \u2014 has at least one immunity' : 'No \u2014 no type immunities';
      case 'npcObtain': {
        const v = (raw || '').trim();
        return (!v || DASH_RE.test(v)) ? 'No' : raw;
      }
      case 'e4':
        return (!raw || raw === '\u2014' || raw === 'No') ? 'No \u2014 not used by Elite Four, Red, or Rival' : raw;
      case 'eggMoveMulti': {
        const pool = this.state.eggMovesPool || [];
        if (pool.length === 0) return 'None \u2014 this Pok\u00e9mon has no egg moves';
        return uses < pool.length ? pool[uses] : 'No more egg moves to reveal';
      }
      case 'eggMove':
        return (!raw || raw === 'None' || raw === '\u2014') ? 'None \u2014 no egg moves' : raw;
      case 'tmHmMulti': {
        const pool = this.state.tmHmsPool || [];
        if (pool.length === 0) return 'None \u2014 no TM/HM moves in data';
        return uses < pool.length ? pool[uses] : 'No more TM/HM moves to reveal';
      }
      case 'exampleMovesetMulti': {
        const pool = this.state.allMovesPool || [];
        if (!pool.length) return raw || '(no move data)';
        const s = shuffleArr([...pool], this.rng);
        return s.slice(0, Math.min(4, s.length)).join(' / ');
      }
      case 'compMovesetMulti': {
        const pool = this.state.compMovesetsPool || [];
        const comps = [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4];
        return uses < pool.length ? (comps[pool[uses]] || 'No more competitive movesets to reveal') : 'No more competitive movesets to reveal';
      }
      case 'compMoveset': {
        const opts = [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4].filter((m) => m && m.trim());
        return opts.length ? opts[Math.floor(this.rng() * opts.length)] : null;
      }
      case 'generation': return _genLabel(poke);
      case 'firstAnime': return animeFirstText(poke);
      case 'animeAcqEvo': return animeAcqEvoText(poke);
      default: return raw || '(no data)';
    }
  }

  // ---- actions ------------------------------------------------------------
  /** Buy/reveal a clue. Returns {ok, id, value, cost} or {ok:false, reason}. */
  buyClue(id, { auto = false } = {}) {
    const s = this.state;
    if (s.gameOver) return { ok: false, reason: 'gameOver' };
    if (s.guessMode === 'forced' && s.forcedPhase === 'guess' && !auto) return { ok: false, reason: 'forcedGuessPhase' };
    const clue = this.clue(id);
    if (!clue) return { ok: false, reason: 'noClue' };
    if (!this.clueAvailable(clue)) return { ok: false, reason: 'unavailable' };
    if (this.difficultyLock(clue)) return { ok: false, reason: 'locked' };
    if (this.clueLimitInfo(clue).atLimit) return { ok: false, reason: 'atLimit' };
    if (!auto && s.forceDiffCat && s.lastChosenClueCat !== null && clue.cat === s.lastChosenClueCat) return { ok: false, reason: 'sameCategory' };
    const cost = this.clueCurrentCost(id);
    if (s.pointsRemaining < cost) return { ok: false, reason: 'insufficientPoints' };
    const value = this._computeClueValue(clue);
    if (value === null) return { ok: false, reason: 'noValue' };

    (s.clueHistory[id] ||= []).push(value);
    s.revealedClues[id] = value;
    s.lastRevealedClueId = id;
    s.pointsRemaining -= cost;
    s.clueSpendByCat[clue.cat] = (s.clueSpendByCat[clue.cat] || 0) + cost;
    s.lastChosenClueCat = clue.cat;
    if (s.cycleCats) {
      if (!s.catCycleVisited.includes(clue.cat)) s.catCycleVisited.push(clue.cat);
      const availCats = [...new Set(this.clues
        .filter((c) => this.clueAvailable(c) && !(c.maxUses === 1 && (c.id in s.revealedClues)) && !this.clueExhausted(c))
        .map((c) => c.cat))];
      if (availCats.every((cat) => s.catCycleVisited.includes(cat))) s.catCycleVisited = [];
    }
    if (s.guessMode === 'forced' && s.forcedPhase === 'reveal' && (s.clueMode === 'choose' || s.clueMode === 'category')) {
      s.forcedPhase = 'guess';
    }
    if (s.pointsRemaining <= 0) this._loss();
    return { ok: true, id, value, cost };
  }

  /** Weighted random reveal (Forced→Random). Returns the buyClue result. */
  autoRevealRandom() {
    const s = this.state;
    const candidates = this.clues.filter((c) => {
      if (!this.clueAvailable(c)) return false;
      if (this.clueLimitInfo(c).atLimit) return false;
      const cost = this.clueCurrentCost(c.id);
      return cost > 0 && s.pointsRemaining >= cost;
    });
    if (!candidates.length) return { ok: false, reason: 'noCandidates' };
    let pool = candidates;
    if (s.cycleCats) {
      const unvisited = candidates.filter((c) => !(s.catCycleVisited || []).includes(c.cat));
      if (unvisited.length) pool = unvisited;
    } else if (s.forceDiffCat && s.lastChosenClueCat !== null) {
      const diff = candidates.filter((c) => c.cat !== s.lastChosenClueCat);
      if (diff.length) pool = diff;
    }
    const penalty = this.multiClue.randomRevealCategoryPenalty;
    const weights = pool.map((c) => (1 / Math.max(1, this.clueCurrentCost(c.id))) * (c.cat === s.lastRandomRevealCat ? penalty : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let clue;
    if (total <= 0) clue = pool[Math.floor(this.rng() * pool.length)];
    else { let r = this.rng() * total; clue = pool[pool.length - 1]; for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { clue = pool[i]; break; } } }
    s.lastRandomRevealCat = clue.cat;
    return this.buyClue(clue.id, { auto: true });
  }

  /** Submit a guess. Returns {ok, correct, score?} or {ok:false, reason}. */
  submitGuess(name) {
    const s = this.state;
    if (s.gameOver) return { ok: false, reason: 'gameOver' };
    if (s.guessMode === 'forced' && s.forcedPhase === 'reveal') return { ok: false, reason: 'forcedRevealPhase' };
    const val = String(name || '').trim();
    if (!val) return { ok: false, reason: 'empty' };
    // Guesses must be an actual Pokémon from this generation's list (#15).
    // Unknown names are rejected with no penalty rather than counted as wrong.
    if (!this._validGuesses.has(normalizeName(val))) return { ok: false, reason: 'unknown' };
    if (normalizeName(val) === normalizeName(s.mystery.name)) {
      s.guesses.push({ name: val, correct: true });
      return this._win();
    }
    s.guesses.push({ name: val, correct: false });
    s.pointsRemaining -= s.guessCost;
    s.guessCostTotal += s.guessCost;
    let phaseChanged = false;
    if (s.guessMode === 'forced' && s.pointsRemaining > 0) {
      if (s.clueMode === 'random') { this.autoRevealRandom(); }
      else { s.forcedPhase = 'reveal'; phaseChanged = true; }
    }
    if (s.pointsRemaining <= 0) this._loss();
    return { ok: true, correct: false, pointsRemaining: s.pointsRemaining, phaseChanged };
  }

  _win() {
    const s = this.state; s.gameOver = true; s.gameResult = 'win';
    return { ok: true, correct: true, score: s.pointsRemaining };
  }
  _loss() {
    const s = this.state; s.pointsRemaining = Math.max(0, s.pointsRemaining);
    s.gameOver = true; s.gameResult = 'loss';
  }

  // ---- read-only accessors for controllers --------------------------------
  get pointsRemaining() { return this.state.pointsRemaining; }
  get startingPoints() { return this.state.startingPoints; }
  get gameOver() { return this.state.gameOver; }
  get gameResult() { return this.state.gameResult; }
  get mystery() { return this.state.mystery; }
  get revealedClues() { return this.state.revealedClues; }
  get guesses() { return this.state.guesses; }
  get wrongGuesses() { return this.state.guesses.filter((g) => !g.correct); }
}
