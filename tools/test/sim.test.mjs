/**
 * @file tools/test/sim.test.mjs
 * @version 1.0.0
 * Unit tests for the VETTED battle simulator (docs/js/sim.js): stat conversion,
 * determinism, complementary win counts, and that the damage pipeline lets a
 * clearly-stronger mon win the majority. Run via `node tools/test/run.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toRealStats, moveId, runMatch, simulateBattle } from '../../docs/js/sim.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const movestats = load('../../docs/data/movestats-gen2.json');
const chart = load('../../docs/data/typechart-gen2.json');

const spec = (name, stats, types, moves) => ({ name, stats, types, moves });

export default function (t) {
  t.section('sim.js — stat conversion');
  {
    const r = toRealStats({ hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 }, 2);
    t.eq(r.hp, 310, 'hp = 2*base+110');
    t.eq(r.atk, 205, 'atk = 2*base+5');
    t.eq(r.spa, 205, 'gen2 has spa');
    t.ok(r.spc === undefined, 'gen2 has no spc');
    const g1 = toRealStats({ hp: 50, atk: 50, def: 50, spc: 50, spe: 50 }, 1);
    t.eq(g1.spc, 105, 'gen1 spc = 2*base+5');
  }

  t.section('sim.js — moveId normalization');
  {
    t.eq(moveId('Vise Grip'), 'visegrip', 'lowercases + strips non-alphanum');
    t.eq(moveId('Double-Edge'), 'doubleedge', 'strips hyphen');
  }

  const strong = spec('Strong', toRealStats({ hp: 120, atk: 134, def: 110, spa: 95, spd: 100, spe: 110 }, 2), ['Normal'], ['Body Slam', 'Earthquake', 'Tackle', 'Strength']);
  const weak = spec('Weak', toRealStats({ hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 }, 2), ['Normal'], ['Tackle', 'Scratch', 'Pound', 'Growl']);
  const opts = { gen: 2, moves: movestats, chart, n: 501 };

  t.section('sim.js — determinism & win accounting');
  {
    const a = runMatch(strong, weak, { ...opts, seed: 12345 });
    const b = runMatch(strong, weak, { ...opts, seed: 12345 });
    t.eq(a.challengerWins, b.challengerWins, 'same seed → identical win count');
    t.eq(a.n, 501, 'N = 501');
    t.eq(a.challengerWins + a.championWins, a.n, 'challenger + champion wins = N');
    t.ok(Math.abs(a.challengerWinPct - a.challengerWins / a.n) < 1e-9, 'challengerWinPct = challengerWins / N');
    t.ok(a.challengerWinPct + a.championWins / a.n - 1 < 1e-9, 'win% are complementary');
    t.ok(typeof a.championWinPct === 'undefined', 'no championWinPct field (use championWins/n)');
  }

  t.section('sim.js — stronger mon wins the majority');
  {
    const a = runMatch(strong, weak, { ...opts, seed: 999 });
    t.ok(a.challengerBeatsChampion, `strong beats weak (strict majority): ${a.challengerWins}/${a.n}`);
    t.ok(a.challengerWinPct > 0.8, `win% high (${(a.challengerWinPct * 100).toFixed(1)}%)`);
  }

  t.section('sim.js — type immunity (Normal → Ghost = 0)');
  {
    // A Normal-only attacker vs a Ghost wall: Normal moves should be immune, so
    // the attacker cannot win on damage; the Ghost should take the majority.
    const ghost = spec('Ghost', toRealStats({ hp: 120, atk: 100, def: 120, spa: 120, spd: 120, spe: 100 }, 2), ['Ghost'], ['Shadow Ball', 'Lick', 'Night Shade', 'Confuse Ray']);
    const normalOnly = spec('NormGuy', toRealStats({ hp: 80, atk: 120, def: 80, spa: 60, spd: 60, spe: 90 }, 2), ['Normal'], ['Tackle', 'Body Slam', 'Strength', 'Pound']);
    const a = runMatch(normalOnly, ghost, { ...opts, seed: 7 });
    t.ok(!a.challengerBeatsChampion, `Normal-only loses to Ghost wall (${a.challengerWins}/${a.n})`);
  }

  t.section('sim.js — single battle returns a winner + log');
  {
    const res = simulateBattle(strong, weak, { gen: 2, moves: movestats, chart, seed: 3 });
    t.ok(res.winner === 'a' || res.winner === 'b', 'winner is a or b');
    t.ok(Array.isArray(res.log) && res.log[0].t === 'start', 'log starts with a start event');
    t.ok(res.log[res.log.length - 1].t === 'end', 'log ends with an end event');
  }
}
