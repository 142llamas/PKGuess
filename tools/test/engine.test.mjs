/**
 * @file tools/test/engine.test.mjs 
 * @version 1.0.0
 * Unit tests for the guess-game engine (docs/js/lib/engine.js): name
 * normalization, round setup from a difficulty, clue purchase deducting points,
 * wrong-guess cost, and a correct guess scoring the remaining points.
 * Run via `node tools/test/run.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PokeGuessRound, normalizeName, poolFilterForData, matchesPool, computeScoreMultiplier, SCORE_MULTIPLIERS } from '../../docs/js/lib/engine.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const gen2 = load('../../docs/data/gen2.json');

export default function (t) {
  t.section('engine.js — normalizeName (trim + lowercase only)');
  {
    t.eq(normalizeName('  Pikachu '), normalizeName('pikachu'), 'case + whitespace insensitive');
    t.eq(normalizeName("Farfetch'd"), "farfetch'd", 'lowercases but KEEPS punctuation');
    t.ok(normalizeName('Mr. Mime') !== normalizeName('mrmime'), 'dots/spaces are NOT stripped (exact match needed)');
    t.note("note: guesses must match punctuation exactly — e.g. \"Farfetch'd\", \"Mr. Mime\"");
  }

  const mystery = gen2.pokedex.find((p) => p.name === 'Pikachu') || gen2.pokedex[24];

  t.section('engine.js — round setup (Normal)');
  let round;
  {
    round = new PokeGuessRound({ genData: gen2, rng: () => 0 });
    round.start({ difficultyId: 'normal', mystery, guessMode: 'free', clueMode: 'choose' });
    const normal = gen2.difficulties.find((d) => d.id === 'normal');
    t.eq(round.startingPoints, normal.points, 'starting points from difficulty config');
    t.eq(round.pointsRemaining, normal.points, 'points start full');
    t.ok(!round.gameOver, 'game not over at start');
    t.eq(round.mystery.name, mystery.name, 'mystery is the one we passed');
  }

  t.section('engine.js — Gen 2 mode pool includes Gen 1 + Gen 2 (#13)');
  {
    // The mapping every mode controller must use: Gen 1 stays Kanto-only,
    // Gen 2 means the FULL dex, never the narrow 152-251-only primitive.
    t.eq(poolFilterForData('gen1'), 'gen1', 'Gen 1 data -> gen1 filter (Kanto only)');
    t.eq(poolFilterForData('gen2'), 'both', 'Gen 2 data -> both filter (Kanto + Johto)');
    t.eq(poolFilterForData('anything-else'), 'both', 'unknown data id defaults to both (safe)');

    // matchesPool is the one primitive every caller now shares.
    t.ok(matchesPool(1, 'gen1') && !matchesPool(152, 'gen1'), 'gen1 filter = #1-151 only');
    t.ok(matchesPool(152, 'gen2') && !matchesPool(1, 'gen2'), 'gen2 filter (primitive) = #152-251 only');
    t.ok(matchesPool(1, 'both') && matchesPool(251, 'both'), 'both filter spans #1-251');

    // End-to-end: a Gen 2 round actually draws from the full dex over many trials.
    const r = new PokeGuessRound({ genData: gen2, rng: Math.random });
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      r.start({ difficultyId: 'normal', poolFilter: poolFilterForData('gen2'), clueMode: 'choose' });
      seen.add(parseInt(r.state.mystery.num, 10));
    }
    const sawKanto = [...seen].some((n) => n <= 151);
    const sawJohto = [...seen].some((n) => n >= 152);
    t.ok(sawKanto, `Gen 2 mode round drew at least one Kanto mon over 60 trials (saw #s: ${[...seen].slice(0, 5)}\u2026)`);
    t.ok(sawJohto, 'Gen 2 mode round drew at least one Johto mon over 60 trials');
  }

  t.section('engine.js — category diversity is enforced for manual reveals too (#15c)');
  {
    const dragonite = gen2.pokedex.find((p) => p.name === 'Dragonite');
    const mk = (catDiversity) => {
      const r = new PokeGuessRound({ genData: gen2, rng: () => 0 });
      r.start({ difficultyId: 'normal', mystery: dragonite, clueMode: 'choose', catDiversity });
      return r;
    };
    // helper: first available clue id in a given category, right now
    const firstIn = (r, catId) => r.clues.find((c) => c.cat === catId && r.clueAvailable(c));

    // ---- Force Different --------------------------------------------------
    let r = mk('diff');
    const cat1a = firstIn(r, 1), cat1b = r.clues.find((c) => c.cat === 1 && c.id !== cat1a.id && r.clueAvailable(c));
    t.ok(r.buyClue(cat1a.id).ok, 'first cat-1 clue reveals fine');
    t.eq(r.categoryDiversityBlocked(1), true, 'UI predicate: cat 1 is now blocked (force-different)');
    t.eq(r.categoryDiversityBlocked(4), false, 'UI predicate: a different category (4) is NOT blocked');
    if (cat1b) {
      const res = r.buyClue(cat1b.id);
      t.eq(res.ok, false, 'a SECOND cat-1 clue is rejected under Force Different (was a silent no-op before #15c)');
      t.eq(res.reason, 'sameCategory', 'rejection reason is sameCategory');
    }
    const cat4 = firstIn(r, 4);
    t.ok(cat4 && r.buyClue(cat4.id).ok, 'switching to a different category (4) succeeds');

    // ---- Cycle All ----------------------------------------------------------
    r = mk('cycle');
    const availCats = [...new Set(r.clues.filter((c) => r.clueAvailable(c)).map((c) => c.cat))].sort();
    t.ok(availCats.length >= 3, `test mon has clues in >=3 categories (got ${availCats.length})`);
    const c0 = firstIn(r, availCats[0]);
    t.ok(r.buyClue(c0.id).ok, 'first reveal of the cycle succeeds');
    const c0b = r.clues.find((c) => c.cat === availCats[0] && c.id !== c0.id && r.clueAvailable(c));
    if (c0b) {
      const res = r.buyClue(c0b.id);
      t.eq(res.ok, false, 'a 2nd clue from an ALREADY-VISITED category is rejected mid-cycle (Cycle All gap — manual reveals were never enforced before #15c)');
    }
    // visit every remaining available category once — each should succeed
    let allOk = true;
    for (let i = 1; i < availCats.length; i++) {
      const c = firstIn(r, availCats[i]);
      if (!c || !r.buyClue(c.id).ok) { allOk = false; break; }
    }
    t.ok(allOk, 'visiting each remaining category once each succeeds');
    // the cycle should now have reset — the first category is revealable again
    t.eq(r.categoryDiversityBlocked(availCats[0]), false, 'after a full cycle, the first category opens back up');
  }

  t.section('engine.js — "By category" reveal: autoRevealFromCategory (#11/#15b.iii)');
  {
    const dragonite = gen2.pokedex.find((p) => p.name === 'Dragonite');
    const r = new PokeGuessRound({ genData: gen2, rng: Math.random });
    r.start({ difficultyId: 'normal', mystery: dragonite, clueMode: 'category', catDiversity: 'free' });
    const res = r.autoRevealFromCategory(1);
    t.ok(res.ok, 'reveals a clue from category 1');
    t.ok(res.id != null && r.clue(res.id).cat === 1, 'the revealed clue actually belongs to category 1');
    t.ok(res.id in r.state.revealedClues, 'the reveal is recorded (so the tracker/grid update)');

    // diversity interaction: category mode + force-different
    const r2 = new PokeGuessRound({ genData: gen2, rng: Math.random });
    r2.start({ difficultyId: 'normal', mystery: dragonite, clueMode: 'category', catDiversity: 'diff' });
    const first = r2.autoRevealFromCategory(1);
    t.ok(first.ok, 'category 1 reveals fine the first time');
    const again = r2.autoRevealFromCategory(1);
    t.eq(again.ok, false, 'clicking the SAME category header again is blocked under Force Different');
    t.eq(again.reason, 'categoryBlocked', 'rejection reason is categoryBlocked');
    const other = r2.autoRevealFromCategory(4);
    t.ok(other.ok, 'a DIFFERENT category header still works');
  }

  t.section('engine.js — auto-reveal respects the forced guess phase (UI safety net)');
  {
    const dragonite = gen2.pokedex.find((p) => p.name === 'Dragonite');
    const r = new PokeGuessRound({ genData: gen2, rng: Math.random });
    r.start({ difficultyId: 'normal', mystery: dragonite, guessMode: 'forced', clueMode: 'category' });
    t.eq(r.state.forcedPhase, 'guess', 'forced game starts in the guess phase');
    const blocked = r.autoRevealFromCategory(1);
    t.eq(blocked.ok, false, 'a UI-style category reveal is rejected during the guess phase');
    t.eq(blocked.reason, 'forcedGuessPhase', 'rejection reason is forcedGuessPhase');
    const bypass = r.autoRevealFromCategory(1, { respectForcedPhase: false });
    t.ok(bypass.ok, 'the internal/explicit bypass still works (used by the engine\u2019s own auto-trigger)');

    const r2 = new PokeGuessRound({ genData: gen2, rng: Math.random });
    r2.start({ difficultyId: 'normal', mystery: dragonite, guessMode: 'forced', clueMode: 'random' });
    const blocked2 = r2.autoRevealRandom();
    t.eq(blocked2.ok, false, 'a UI-style random reveal is rejected during the guess phase');
    t.eq(blocked2.reason, 'forcedGuessPhase', 'rejection reason is forcedGuessPhase');
    // ...but the engine's OWN internal auto-trigger (wrong guess -> auto reveal) still fires:
    const wrong = r2.allNames.find((n) => normalizeName(n) !== normalizeName(dragonite.name));
    const before = Object.keys(r2.state.clueHistory).length;
    r2.submitGuess(wrong);
    const after = Object.keys(r2.state.clueHistory).length;
    t.ok(after > before, 'forced+random still auto-reveals a clue after a wrong guess (internal bypass intact)');
  }

  t.section('engine.js — Gen 1 gym/E4 clues are Yes/No only (#10)');
  {
    const gen1 = load('../../docs/data/gen1.json');
    const mk = (poke) => { const r = new PokeGuessRound({ genData: gen1, rng: () => 0 }); r.start({ difficultyId: 'custom', mystery: poke, guessMode: 'free', clueMode: 'choose', custom: { points: 99, guessCost: 0, startClueMode: 'none' } }); return r; };
    const onix = gen1.pokedex.find((p) => p.name === 'Onix');      // gym: Brock, e4: Bruno
    const dragonite = gen1.pokedex.find((p) => p.name === 'Dragonite'); // gym: No, e4: Lance
    const yn = (v) => v === 'Yes' || v === 'No';
    let r = mk(onix);
    const g = r.buyClue(25), e = r.buyClue(26);
    t.ok(yn(g.value), `gym clue is Yes/No, not a name (got ${g.value})`);
    t.eq(g.value, 'Yes', 'Onix used by a Gym Leader → Yes');
    t.eq(e.value, 'Yes', 'Onix used by Elite Four → Yes');
    r = mk(dragonite);
    t.eq(r.buyClue(25).value, 'No', 'Dragonite not used by a Gym Leader → No');
    t.eq(r.buyClue(26).value, 'Yes', 'Dragonite used by Lance → Yes');
  }

  t.section('engine.js — guesses must come from the list (#15)');
  {
    const r = new PokeGuessRound({ genData: gen2, rng: () => 0 });
    r.start({ difficultyId: 'custom', mystery, guessMode: 'free', clueMode: 'choose', custom: { points: 50, guessCost: 5, startClueMode: 'none' } });
    const before = r.pointsRemaining;
    const junk = r.submitGuess('Notarealmon');
    t.ok(!junk.ok && junk.reason === 'unknown', 'unknown name rejected');
    t.eq(r.pointsRemaining, before, 'unknown guess costs nothing');
    const real = r.submitGuess('Bulbasaur'); // valid, wrong
    t.ok(real.ok && real.correct === false, 'a real but wrong name still counts as a guess');
    t.eq(r.pointsRemaining, before - 5, 'wrong (valid) guess deducts guessCost');
  }

  t.section('engine.js — evolution deductions (#14)');
  {
    const charizard = gen2.pokedex.find((p) => p.name === 'Charizard');
    const tauros = gen2.pokedex.find((p) => p.name === 'Tauros');
    const mk = (poke) => { const r = new PokeGuessRound({ genData: gen2, rng: () => 0 }); r.start({ difficultyId: 'custom', mystery: poke, guessMode: 'free', clueMode: 'choose', custom: { points: 99, guessCost: 0, startClueMode: 'none' } }); return r; };
    const avail = (r, id) => r.clueAvailable(r.clue(id));

    // Charizard: final stage. Revealing Stage (9) must lock Can Evolve (10) + Evolves From (11).
    let r = mk(charizard);
    t.ok(avail(r, 10) && avail(r, 11), 'before: Can Evolve + Evolves From available');
    t.ok(r.buyClue(9).ok, 'reveal Current Evolution Stage');
    t.ok(!avail(r, 10), 'after stage reveal: Can Evolve locked (deducible)');
    t.ok(!avail(r, 11), 'after stage reveal: Evolves From locked (deducible)');
    t.ok(avail(r, 12), 'Evolution Method stays available (stage implies it evolves from something)');

    // Reverse: revealing both 10 + 11 locks Stage (9).
    r = mk(charizard);
    t.ok(avail(r, 9), 'before: Stage available');
    r.buyClue(10); r.buyClue(11);
    t.ok(!avail(r, 9), 'after Can Evolve + Evolves From: Stage locked (deducible)');

    // Single-stage (Tauros): revealing Stage pins family size (8) and locks 10/11.
    r = mk(tauros);
    t.ok(avail(r, 8), 'before: Number of Family Members available');
    t.ok(r.buyClue(9).ok, 'reveal Stage (single-stage)');
    t.ok(!avail(r, 8), 'single-stage pins family size → Family Members locked');
    t.ok(!avail(r, 10) && !avail(r, 11), 'single-stage locks Can Evolve + Evolves From');
  }

  t.section('engine.js — buying a clue deducts points');
  {
    const before = round.pointsRemaining;
    const res = round.buyClue(1); // Pokédex Habitat (cat 1) — available on Normal
    t.ok(res.ok, `clue purchase ok (${res.reason || 'bought'})`);
    t.ok(round.pointsRemaining === before - res.cost, `points dropped by cost (${res.cost})`);
    t.ok(1 in round.revealedClues, 'clue recorded as revealed');
  }

  t.section('engine.js — wrong guess costs guessCost, correct guess wins');
  {
    const normal = gen2.difficulties.find((d) => d.id === 'normal');
    const before = round.pointsRemaining;
    const wrong = round.submitGuess('Bulbasaur'); // not Pikachu
    t.ok(wrong.ok && wrong.correct === false, 'wrong guess accepted as incorrect');
    t.eq(round.pointsRemaining, before - normal.guessCost, 'wrong guess deducts guessCost');
    t.ok(!round.gameOver || round.pointsRemaining <= 0, 'still playing (points remain)');

    const pts = round.pointsRemaining;
    const win = round.submitGuess('  pikachu '); // case/space-insensitive
    t.ok(win.ok && win.correct === true, 'correct guess (normalized) wins');
    t.eq(win.score, pts, 'score = points remaining at the win');
    t.ok(round.gameOver && round.gameResult === 'win', 'round marked won');
  }

  t.section('engine.js — computeScoreMultiplier (#5): stacks difficulty \u00d7 guessMode \u00d7 clueMode \u00d7 catDiversity');
  {
    // Easiest possible combo: lowest multiplier on every axis.
    const easiest = computeScoreMultiplier({ difficultyId: 'easy', guessMode: 'free', clueMode: 'choose', catDiversity: 'free' });
    t.eq(easiest, 0.8 * 1.0 * 0.8 * 1.0, 'easiest settings across all four axes multiply out correctly');

    // Hardest possible combo: highest multiplier on every axis.
    const hardest = computeScoreMultiplier({ difficultyId: 'extreme', guessMode: 'forced', clueMode: 'random', catDiversity: 'cycle' });
    t.eq(hardest, 2.0 * 1.3 * 1.6 * 1.5, 'hardest settings across all four axes multiply out correctly');
    t.ok(hardest > easiest, 'hardest combo scores a strictly higher multiplier than the easiest combo');

    // Every individual axis: harder option > easier option, holding the rest fixed.
    const base = { difficultyId: 'normal', guessMode: 'free', clueMode: 'choose', catDiversity: 'free' };
    t.ok(computeScoreMultiplier({ ...base, difficultyId: 'hard' }) > computeScoreMultiplier(base), 'Hard > Normal');
    t.ok(computeScoreMultiplier({ ...base, difficultyId: 'extreme' }) > computeScoreMultiplier({ ...base, difficultyId: 'hard' }), 'Extreme > Hard');
    t.ok(computeScoreMultiplier({ ...base, guessMode: 'forced' }) > computeScoreMultiplier(base), 'Forced Reveal > Guess Anytime');
    t.ok(computeScoreMultiplier({ ...base, clueMode: 'category' }) > computeScoreMultiplier(base), 'By-category > Choose');
    t.ok(computeScoreMultiplier({ ...base, clueMode: 'random' }) > computeScoreMultiplier({ ...base, clueMode: 'category' }), 'Random > By-category');
    t.ok(computeScoreMultiplier({ ...base, catDiversity: 'diff' }) > computeScoreMultiplier(base), 'Force-Different > Free Choice');
    t.ok(computeScoreMultiplier({ ...base, catDiversity: 'cycle' }) > computeScoreMultiplier({ ...base, catDiversity: 'diff' }), 'Cycle-All > Force-Different');

    // Custom has no multiplier at all (not leaderboard-eligible).
    t.eq(computeScoreMultiplier({ difficultyId: 'custom', guessMode: 'free', clueMode: 'choose', catDiversity: 'free' }), null, 'Custom difficulty returns null (no multiplier, not submitted)');

    // Defensive: an unrecognized value on any axis returns null rather than NaN or a silent wrong number.
    t.eq(computeScoreMultiplier({ difficultyId: 'normal', guessMode: 'bogus', clueMode: 'choose', catDiversity: 'free' }), null, 'an unrecognized guessMode value returns null rather than NaN');

    // The exported table itself matches the locked-in values (catches accidental edits).
    t.eq(SCORE_MULTIPLIERS.difficulty.hard, 1.6, 'Hard multiplier is locked at 1.6');
    t.eq(SCORE_MULTIPLIERS.difficulty.extreme, 2.0, 'Extreme multiplier is locked at 2.0');
    t.eq(SCORE_MULTIPLIERS.clueMode.choose, 0.8, 'Choose multiplier is locked at 0.8');
    t.eq(SCORE_MULTIPLIERS.clueMode.random, 1.6, 'Random multiplier is locked at 1.6');
    t.eq(SCORE_MULTIPLIERS.catDiversity.cycle, 1.5, 'Cycle-All multiplier is locked at 1.5');
  }
}
