/**
 * @file tools/test/mp-rules.test.mjs
 * @version 1.0.0
 * Unit tests for the pure multiplayer rules (docs/js/lib/mp-rules.js): seed
 * determinism, room codes, seed→same-mystery (the no-answer-transmitted basis),
 * reveal/guess outcomes, turn rotation, win advance, and champion detection.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  seedFor, buildEngine, applyReveals, revealOutcome, guessOutcome,
  nextTurnPos, weightedRandomClue, advanceAfterWin, champion, makeRoomCode,
} from '../../docs/js/lib/mp-rules.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const gen2 = load('../../docs/data/gen2.json');

export default function (t) {
  t.section('mp-rules — seedFor determinism');
  {
    t.eq(seedFor(123, 1), seedFor(123, 1), 'same inputs → same seed');
    t.ok(seedFor(123, 1) !== seedFor(123, 2), 'round changes the seed');
    t.ok(seedFor(123, 1, 0) !== seedFor(123, 1, 1), 'salt changes the seed');
    t.ok(Number.isInteger(seedFor(123, 1)) && seedFor(123, 1) >= 0, 'uint32');
  }

  t.section('mp-rules — makeRoomCode');
  {
    const c = makeRoomCode(() => 0.5);
    t.eq(c.length, 6, 'code is 6 chars (matches DB rule)');
    t.ok(/^[A-Z0-9]+$/.test(c), 'uppercase alphanumeric');
    t.ok(!/[IO01]/.test(c), 'avoids ambiguous I/O/0/1');
  }

  t.section('mp-rules — buildEngine: same seed → same mystery (no answer sent)');
  {
    const a = buildEngine({ data: gen2, movelist: {}, seed: seedFor(777, 1), poolFilter: 'both' });
    const b = buildEngine({ data: gen2, movelist: {}, seed: seedFor(777, 1), poolFilter: 'both' });
    t.eq(a.mystery.name, b.mystery.name, 'two clients derive the SAME mystery');
    t.ok(a.round && typeof a.round.buyClue === 'function', 'returns a started round');
    const c = buildEngine({ data: gen2, movelist: {}, seed: seedFor(777, 1), poolFilter: 'gen2' });
    const n = parseInt(c.mystery.num, 10);
    t.ok(n >= 152 && n <= 251, `gen2 filter picks Johto (#${n})`);
  }

  t.section('mp-rules — applyReveals replays clue values identically');
  {
    const seed = seedFor(42, 3);
    const e1 = buildEngine({ data: gen2, movelist: {}, seed });
    const e2 = buildEngine({ data: gen2, movelist: {}, seed });
    applyReveals(e1.round, [1, 19]);   // habitat + a stat clue
    applyReveals(e2.round, [1, 19]);
    t.eq(JSON.stringify(e1.round.revealedClues), JSON.stringify(e2.round.revealedClues), 'same ids → same revealed values on both clients');
  }

  t.section('mp-rules — revealOutcome');
  {
    const r = revealOutcome({ pool: 75, revealedClueIds: [2], phase: 'reveal' }, 5, 3, 'rtg');
    t.eq(r.pool, 72, 'pool drops by cost');
    t.eq(r.revealedClueIds.length, 2, 'id appended');
    t.eq(r.phase, 'guess', 'RTG → guess phase after reveal');
    const g = revealOutcome({ pool: 2, revealedClueIds: [], phase: 'guess' }, 7, 5, 'gtr');
    t.eq(g.pool, 0, 'pool floored at 0');
    t.eq(g.phase, 'guess', 'GTR keeps phase');
  }

  t.section('mp-rules — guessOutcome');
  {
    const win = guessOutcome({ pool: 40 }, 'pikachu', 'Pikachu', 1);
    t.ok(win.correct && win.earned === 40, 'correct (normalized) earns the pool');
    const lose = guessOutcome({ pool: 40 }, 'Bulbasaur', 'Pikachu', 5);
    t.ok(!lose.correct && lose.pool === 35 && lose.earned === 0, 'wrong deducts guessCost, earns 0');
    const lose0 = guessOutcome({ pool: 3 }, 'x', 'Pikachu', 5);
    t.eq(lose0.pool, 0, 'wrong pool floored at 0');
  }

  t.section('mp-rules — nextTurnPos / advanceAfterWin');
  {
    t.eq(nextTurnPos(0, 3), 1, 'wraps forward');
    t.eq(nextTurnPos(2, 3), 0, 'wraps around');
    const adv = advanceAfterWin(['a', 'b', 'c'], 'b');
    t.eq(JSON.stringify(adv.turnOrder), JSON.stringify(['a', 'c', 'b']), 'winner rotates to end');
    t.eq(adv.currentTurnPos, 0, 'new round starts at seat 0');
  }

  t.section('mp-rules — champion');
  {
    const players = { a: { name: 'A', score: 120 }, b: { name: 'B', score: 160 }, c: { name: 'C', score: 80 } };
    const w = champion(players, 150);
    t.ok(w && w.uid === 'b', 'highest scorer at/over target wins');
    t.eq(champion(players, 200), null, 'nobody at target → null');
  }

  t.section('mp-rules — weightedRandomClue');
  {
    const avail = [{ id: 1, cat: 1, cost: 1 }, { id: 2, cat: 2, cost: 10 }];
    let lo = 0;
    const rng = (() => { let i = 0; const seq = [0.01, 0.5, 0.99, 0.2, 0.7]; return () => seq[i++ % seq.length]; })();
    for (let i = 0; i < 200; i++) { const p = weightedRandomClue(avail, null, 0.25, Math.random); if (p.id === 1) lo++; }
    t.ok(lo > 120, `cheap clue favored (~${lo}/200 chose the 1-pt clue)`);
    t.eq(weightedRandomClue([], null, 0.25, rng), null, 'empty pool → null');
  }
}
