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
import { PokeGuessRound, normalizeName } from '../../docs/js/lib/engine.js';

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

  t.section('engine.js — gen pool filter');
  {
    const r = new PokeGuessRound({ genData: gen2, rng: () => 0 });
    r.start({ difficultyId: 'normal', poolFilter: 'gen2', clueMode: 'choose' });
    const n = parseInt(r.mystery.num, 10);
    t.ok(n >= 152 && n <= 251, `gen2 filter picks a Johto mon (#${n})`);
  }
}
