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

  t.section('engine.js — exhausting a multi-use clue keeps every real revealed value in history (bug: they were being visually erased)');
  {
    // Reveal weaknesses one at a time until the pool is spent and one more buy
    // returns the "No more weaknesses to reveal" sentinel. The bug that the
    // renderers hit was that, once exhausted, the card showed ONLY the last
    // history entry (the sentinel), hiding every real weakness already paid for.
    // The engine must keep the real values in clueHistory so the (fixed) card
    // can still render them — this guards the data the fix depends on.
    const WEAK_ID = 13; // Reveal One Weakness (weaknessMulti)
    // A mystery with a known non-empty weakness list. Pikachu (Electric) is weak
    // to Ground — small, deterministic pool.
    const pika = gen2.pokedex.find((p) => p.name === 'Pikachu');
    const r = new PokeGuessRound({ genData: gen2, rng: () => 0 });
    r.start({ difficultyId: 'custom', mystery: pika, guessMode: 'free', clueMode: 'choose', custom: { points: 99, guessCost: 0, startClueMode: 'none' } });

    const realValues = [];
    let sawSentinel = false;
    // Buy the weakness clue repeatedly until it's exhausted (or a generous cap).
    for (let i = 0; i < 20; i++) {
      const clue = r.clue(WEAK_ID);
      if (r.clueExhausted(clue)) break;
      const res = r.buyClue(WEAK_ID);
      if (!res.ok) break;
      if (String(res.value).startsWith('No more')) sawSentinel = true;
      else realValues.push(res.value);
    }

    t.ok(realValues.length >= 1, `at least one real weakness was revealed (got ${realValues.length}: ${JSON.stringify(realValues)})`);
    t.ok(sawSentinel, 'buying past the pool eventually yields the "No more..." sentinel (the exhaustion state that triggered the bug)');
    t.ok(r.clueExhausted(r.clue(WEAK_ID)), 'the clue is now exhausted');

    // The crux: the FULL history still contains every real value — nothing was
    // overwritten/erased by the sentinel.
    const hist = r.state.clueHistory[WEAK_ID] || [];
    const realInHist = hist.filter((v) => !String(v).startsWith('No more'));
    t.eq(realInHist.length, realValues.length, 'clueHistory still holds every real revealed weakness (none clobbered by the sentinel)');
    t.ok(realValues.every((v) => realInHist.includes(v)), 'each specific revealed weakness is still present in history — this is what the fixed card re-renders instead of collapsing to just the sentinel');
    // And the sentinel, if present, is only the LAST entry — never in place of a real value.
    if (hist.some((v) => String(v).startsWith('No more'))) {
      t.ok(String(hist[hist.length - 1]).startsWith('No more'), 'the sentinel is only ever the final history entry, appended after the real values (not replacing them)');
    }
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

  t.section('engine.js — "Reveal One Example Moveset" never repeats a move within one reveal (bug report)');
  {
    // Mr. Mime's REAL movelist data lists Thunderbolt twice (once via an RBY
    // TM import, once via Move Tutor) -- confirmed directly in
    // docs/data/movelist-gen2.json. This is exactly the shape that produced
    // the reported bug: a shuffled, undeduplicated pool could show the same
    // move twice in one "example moveset." Use the REAL data, not a
    // synthetic case, so this test would have caught the actual bug.
    const movelist = load('../../docs/data/movelist-gen2.json');
    const mrMimeMoves = movelist['mr. mime'] || movelist['mr.mime'] || movelist['mrmime'];
    t.ok(Array.isArray(mrMimeMoves) && mrMimeMoves.filter((m) => m.move === 'Thunderbolt').length >= 2,
      'sanity check: Mr. Mime\'s real movelist data genuinely lists Thunderbolt twice (confirms this test exercises the real reported scenario, not a hypothetical one)');

    const mrMime = gen2.pokedex.find((p) => p.name === 'Mr. Mime');
    t.ok(!!mrMime, 'Mr. Mime exists in the Gen 2 pokedex');
    const r = new PokeGuessRound({ genData: gen2, movelist, rng: () => 0 });
    r.start({ difficultyId: 'normal', mystery: mrMime, guessMode: 'free', clueMode: 'choose' });
    const pool = r.state.allMovesPool || [];
    t.ok(pool.includes('Thunderbolt'), 'Thunderbolt is still present in the pool at least once (not accidentally removed entirely)');
    t.eq(new Set(pool).size, pool.length, 'allMovesPool itself has no duplicate move names (this is the actual fix -- checking it directly, rather than relying on a shuffle randomly placing both original duplicate positions within the same 4-slice, which only has roughly a 0.3% chance per reveal with a 63-move pool and would make this test unreliable as a regression guard)');

    const exampleId = r._exampleId();
    t.ok(exampleId != null, 'the example-moveset clue id resolves for gen 2');

    // Also spot-check several actual reveals, since that's the player-visible
    // behavior — each individual reveal must still never repeat a move.
    let checkedAtLeastOne = false;
    for (let i = 0; i < 6; i++) {
      const res = r.buyClue(exampleId);
      if (!res.ok) break;
      const shown = String(res.value).split('/').map((x) => x.trim()).filter(Boolean);
      checkedAtLeastOne = true;
      t.eq(new Set(shown).size, shown.length, `reveal #${i + 1} of the example moveset has no repeated move (got: "${res.value}")`);
    }
    t.ok(checkedAtLeastOne, 'at least one reveal of the example moveset was actually checked');
  }

  t.section('engine.js — "Has an Immunity" and "Used by E4/Red/Rival" clues are plain Yes/No (requested)');
  {
    // Gengar has type immunities (Fighting, Normal via Ghost) AND is used by
    // the E4/Red/Cal (e4RedCal:"Yes"); Bulbasaur has neither (immunities:"—",
    // e4RedCal:"No") — one of each so both branches (Yes and No) are covered
    // for both clues. (Rattata is NOT a valid "No" case here — being Normal-
    // type, it's immune to Ghost, so its immunities field is populated.)
    const gengar = gen2.pokedex.find((p) => p.name === 'Gengar');
    const rattata = gen2.pokedex.find((p) => p.name === 'Bulbasaur');
    t.ok(!!gengar && !!rattata, 'Gengar and Bulbasaur both exist in the Gen 2 pokedex');

    const immuId = (r) => r._idBySpecial.immunityYesNo;
    const e4Id = (r) => r._idBySpecial.e4;

    const rG = new PokeGuessRound({ genData: gen2, movelist: {}, rng: () => 0 });
    rG.start({ difficultyId: 'normal', mystery: gengar, guessMode: 'free', clueMode: 'choose' });
    if (immuId(rG) != null) t.eq(rG.buyClue(immuId(rG)).value, 'Yes', 'immunity clue is exactly "Yes" for a mon WITH immunities (not "Yes — has at least one immunity")');
    if (e4Id(rG) != null) t.eq(rG.buyClue(e4Id(rG)).value, 'Yes', 'E4/Red/Rival clue is exactly "Yes" for a mon that IS used (no trailing explanation)');

    const rR = new PokeGuessRound({ genData: gen2, movelist: {}, rng: () => 0 });
    rR.start({ difficultyId: 'normal', mystery: rattata, guessMode: 'free', clueMode: 'choose' });
    if (immuId(rR) != null) t.eq(rR.buyClue(immuId(rR)).value, 'No', 'immunity clue is exactly "No" for a mon WITHOUT immunities (not "No — no type immunities")');
    if (e4Id(rR) != null) t.eq(rR.buyClue(e4Id(rR)).value, 'No', 'E4/Red/Rival clue is exactly "No" for a mon that is NOT used (not "No — not used by Elite Four, Red, or Rival")');
  }
}
