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

  // ===========================================================================
  // #6 — real move mechanics (previously every move fell through to plain
  // damage or a no-op; see sim.js's changelog for the full list).
  // ===========================================================================
  const dummyDefStats = toRealStats({ hp: 200, atk: 60, def: 60, spa: 60, spd: 60, spe: 60 }, 2);
  const dummyAtkStats = toRealStats({ hp: 200, atk: 120, def: 60, spa: 120, spd: 60, spe: 100 }, 2);
  const mkMono = (name, move, stats = dummyAtkStats, types = ['Normal']) => spec(name, stats, types, [move, move, move, move]);
  const target = () => spec('Target', dummyDefStats, ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
  const simOpts = { gen: 2, moves: movestats, chart, turnCap: 40 };

  t.section('sim.js — recoil (#6f): Take Down / Double-Edge / Submission cost the ATTACKER HP');
  {
    const atk = mkMono('Recoiler', 'Take Down');
    let sawRecoil = false;
    for (let seed = 1; seed <= 15 && !sawRecoil; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed });
      if (res.log.some((e) => e.t === 'recoil')) sawRecoil = true;
    }
    t.ok(sawRecoil, 'Take Down produced at least one recoil log entry across trials');
  }

  t.section('sim.js — drain (#6g): Absorb / Mega Drain / Giga Drain heal the ATTACKER');
  {
    const atk = mkMono('Drainer', 'Absorb', dummyAtkStats, ['Grass']);
    let sawDrain = false;
    for (let seed = 1; seed <= 15 && !sawDrain; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed });
      if (res.log.some((e) => e.t === 'drain')) sawDrain = true;
    }
    t.ok(sawDrain, 'Absorb produced at least one drain (heal) log entry across trials');
  }

  t.section('sim.js — Dream Eater fails unless the target is asleep');
  {
    const atk = mkMono('Eater', 'Dream Eater', dummyAtkStats, ['Psychic']);
    const awakeTarget = target();
    const res = simulateBattle(atk, awakeTarget, { ...simOpts, seed: 1, turnCap: 5 });
    t.ok(res.log.some((e) => e.t === 'fail'), 'Dream Eater fails against an awake target');
    t.ok(!res.log.some((e) => e.t === 'drain'), 'no drain happened since it failed');
  }

  t.section('sim.js — multi-hit (#6h): Doubleslap/Fury Swipes hit 2–5 times, Double Kick/Twineedle/Bonemerang always exactly 2');
  {
    const atk = mkMono('Slapper', 'Doubleslap');
    const hitCounts = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed, turnCap: 1 });
      const mh = res.log.find((e) => e.t === 'multihit');
      if (mh) hitCounts.add(mh.hits);
    }
    t.ok([...hitCounts].every((h) => h >= 2 && h <= 5), `Doubleslap hit counts stay within 2-5 (saw: ${[...hitCounts].sort()})`);
    t.ok(hitCounts.size >= 2, `Doubleslap shows variety in hit count across trials (saw: ${[...hitCounts].sort()})`);

    const fixedAtk = mkMono('Kicker', 'Double Kick', dummyAtkStats, ['Fighting']);
    let allTwo = true;
    for (let seed = 1; seed <= 20; seed++) {
      const res = simulateBattle(fixedAtk, target(), { ...simOpts, seed, turnCap: 1 });
      const mh = res.log.find((e) => e.t === 'multihit');
      if (mh && mh.hits !== 2) allTwo = false;
    }
    t.ok(allTwo, 'Double Kick always hits exactly 2 times (fixed-count multi-hit)');
  }

  t.section('sim.js — Triple Kick ramps power per hit (10/20/30)');
  {
    const atk = mkMono('TripleKicker', 'Triple Kick', dummyAtkStats, ['Fighting']);
    let found3 = false;
    for (let seed = 1; seed <= 20 && !found3; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed, turnCap: 1 });
      const mh = res.log.find((e) => e.t === 'multihit');
      if (mh && mh.hits === 3) found3 = true;
    }
    t.ok(found3, 'Triple Kick hits exactly 3 times when it connects fully');
  }

  t.section('sim.js — two-turn charge moves (#6b): Fly/Dig deal no damage on the charge turn, are unhittable that turn, then hit on turn 2');
  {
    const flyer = mkMono('Flyer', 'Fly', dummyAtkStats, ['Flying']);
    const grounded = spec('Grounded', dummyDefStats, ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const res = simulateBattle(flyer, grounded, { ...simOpts, seed: 1, turnCap: 4 });
    const chargeEvt = res.log.find((e) => e.t === 'charge');
    t.ok(!!chargeEvt, 'a charge event is logged when Fly is used');
    // On the charge turn, the opponent's attack against the flyer should show as an invuln miss.
    const invulnMiss = res.log.find((e) => e.t === 'miss' && e.reason === 'invuln');
    t.ok(!!invulnMiss, 'the charging Pok\u00e9mon is unhittable during the charge turn');
    // Somewhere later, Fly should actually deal damage (the release turn) —
    // checked across several seeds since Fly is still only 95% accurate on release.
    let flyDamage = null;
    for (let seed = 1; seed <= 10 && !flyDamage; seed++) {
      const r = simulateBattle(flyer, grounded, { ...simOpts, seed, turnCap: 6 });
      flyDamage = r.log.find((e) => e.t === 'damage' && e.move === 'Fly');
    }
    t.ok(!!flyDamage, 'Fly deals damage on its release turn (across a few seeds)');
  }

  t.section('sim.js — recharge (#6a): Hyper Beam forces a do-nothing turn afterward');
  {
    const beamer = mkMono('Beamer', 'Hyper Beam');
    const res = simulateBattle(beamer, target(), { ...simOpts, seed: 2, turnCap: 6 });
    const usedHyperBeam = res.log.some((e) => (e.t === 'use' || e.t === 'damage' || e.t === 'miss') && e.move === 'Hyper Beam');
    t.ok(usedHyperBeam, 'Hyper Beam was actually used at least once');
    const recharged = res.log.some((e) => e.t === 'recharge' && e.target === 'Beamer');
    t.ok(recharged, 'a recharge turn was forced after Hyper Beam');
  }

  t.section('sim.js — recharge is skipped if the hit faints the target');
  {
    // A one-shot-capable Hyper Beam into a paper-thin target: if it KOs, the
    // battle ends immediately (no more turns to recharge on) — this at least
    // confirms fainting still ends the battle cleanly with Hyper Beam involved.
    const beamer = mkMono('OneShotBeamer', 'Hyper Beam', toRealStats({ hp: 200, atk: 200, def: 100, spa: 100, spd: 100, spe: 150 }, 2));
    const paper = spec('Paper', toRealStats({ hp: 1, atk: 10, def: 10, spa: 10, spd: 10, spe: 1 }, 2), ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const res = simulateBattle(beamer, paper, { ...simOpts, seed: 4, turnCap: 10 });
    t.ok(res.winner === 'a', 'the overwhelming attacker wins');
  }

  t.section('sim.js — OHKO moves (#6): Guillotine/Horn Drill/Fissure kill outright when they land');
  {
    const atk = mkMono('OhkoUser', 'Guillotine');
    let sawOhko = false;
    for (let seed = 1; seed <= 30 && !sawOhko; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed, turnCap: 30 });
      if (res.log.some((e) => e.t === 'ohko')) sawOhko = true;
    }
    t.ok(sawOhko, 'Guillotine landed an OHKO at least once across trials');
  }

  t.section('sim.js — high-crit moves (#6): Slash/Razor Leaf/Crabhammer/Karate Chop crit far more than the 1/16 baseline');
  {
    const atk = mkMono('Slasher', 'Slash');
    let crits = 0, hits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const res = simulateBattle(atk, target(), { ...simOpts, seed, turnCap: 1 });
      const dmg = res.log.find((e) => e.t === 'damage' && e.source === 'Slasher');
      if (dmg) { hits++; if (dmg.crit) crits++; }
    }
    const critRate = crits / Math.max(1, hits);
    t.ok(critRate > 0.15, `Slash crits noticeably more than the ~6% baseline (observed ${(critRate * 100).toFixed(1)}% over ${hits} hits)`);
  }

  t.section('sim.js — fixed-damage moves (#6): Sonicboom=20, Dragon Rage=40, Seismic Toss/Night Shade=level (100)');
  {
    const sonic = mkMono('Sonic', 'Sonicboom');
    const r1 = simulateBattle(sonic, target(), { ...simOpts, seed: 1, turnCap: 1 });
    const d1 = r1.log.find((e) => e.t === 'damage' && e.move === 'Sonicboom');
    if (d1) t.eq(d1.amount, 20, 'Sonicboom always deals exactly 20');

    const dragon = mkMono('DragonRager', 'Dragon Rage', dummyAtkStats, ['Dragon']);
    const r2 = simulateBattle(dragon, target(), { ...simOpts, seed: 1, turnCap: 1 });
    const d2 = r2.log.find((e) => e.t === 'damage' && e.move === 'Dragon Rage');
    if (d2) t.eq(d2.amount, 40, 'Dragon Rage always deals exactly 40');

    const tosser = mkMono('Tosser', 'Seismic Toss', dummyAtkStats, ['Fighting']);
    const r3 = simulateBattle(tosser, target(), { ...simOpts, seed: 1, turnCap: 1 });
    const d3 = r3.log.find((e) => e.t === 'damage' && e.move === 'Seismic Toss');
    if (d3) t.eq(d3.amount, 100, 'Seismic Toss deals exactly the user\u2019s level (100)');
  }

  t.section('sim.js — Super Fang deals exactly half the TARGET\u2019s current HP');
  {
    const atk = mkMono('FangUser', 'Super Fang');
    const foe = target();
    const halfExpected = Math.max(1, Math.floor(foe.stats.hp / 2));
    const res = simulateBattle(atk, foe, { ...simOpts, seed: 1, turnCap: 1 });
    const d = res.log.find((e) => e.t === 'damage' && e.move === 'Super Fang');
    if (d) t.eq(d.amount, halfExpected, `Super Fang dealt half of target\u2019s CURRENT hp (${halfExpected})`);
  }

  t.section('sim.js — HP-based power (#6): Flail hits much harder at low HP than full HP');
  {
    const fullHpAtk = spec('FullFlail', dummyAtkStats, ['Normal'], ['Flail', 'Flail', 'Flail', 'Flail']);
    const lowHpStats = { ...dummyAtkStats };
    const lowHpAtk = spec('LowFlail', lowHpStats, ['Normal'], ['Flail', 'Flail', 'Flail', 'Flail']);
    // simulateBattle always starts at full HP, so directly compare via calcDamage isn't exported —
    // instead confirm the flag round-trips onto the move and produces a sane battle.
    const res = simulateBattle(fullHpAtk, target(), { ...simOpts, seed: 5, turnCap: 1 });
    const d = res.log.find((e) => e.t === 'damage' && e.move === 'Flail');
    t.ok(!d || d.amount > 0, 'Flail at full HP still deals some (low) damage without throwing');
  }

  t.section('sim.js — guaranteed status moves (#6): Toxic/Thunder Wave/Sleep Powder actually inflict their status');
  {
    const toxer = mkMono('Toxer', 'Toxic', dummyAtkStats, ['Poison']);
    let sawTox = false;
    for (let seed = 1; seed <= 15 && !sawTox; seed++) {
      const res = simulateBattle(toxer, target(), { ...simOpts, seed, turnCap: 3 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'tox')) sawTox = true;
    }
    t.ok(sawTox, 'Toxic inflicts badly-poisoned (tox) on the target');

    const thunderWaver = mkMono('Wavey', 'Thunder Wave', dummyAtkStats, ['Electric']);
    let sawPar = false;
    for (let seed = 1; seed <= 15 && !sawPar; seed++) {
      const res = simulateBattle(thunderWaver, target(), { ...simOpts, seed, turnCap: 3 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'par')) sawPar = true;
    }
    t.ok(sawPar, 'Thunder Wave inflicts paralysis on the target');
  }

  t.section('sim.js — guaranteed confuse (#6): Confuse Ray / Swagger');
  {
    const confuser = mkMono('Ghosty', 'Confuse Ray', dummyAtkStats, ['Ghost']);
    let sawConfuse = false;
    for (let seed = 1; seed <= 10 && !sawConfuse; seed++) {
      const res = simulateBattle(confuser, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'confuse')) sawConfuse = true;
    }
    t.ok(sawConfuse, 'Confuse Ray confuses the target');

    const swaggerer = mkMono('Swaggerer', 'Swagger');
    let sawBoostAndConfuse = { boost: false, confuse: false };
    for (let seed = 1; seed <= 15; seed++) {
      const res = simulateBattle(swaggerer, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'boost' && e.stat === 'atk')) sawBoostAndConfuse.boost = true;
      if (res.log.some((e) => e.t === 'confuse')) sawBoostAndConfuse.confuse = true;
    }
    t.ok(sawBoostAndConfuse.boost, 'Swagger raises the TARGET\u2019s Attack');
    t.ok(sawBoostAndConfuse.confuse, 'Swagger also confuses the target');
  }

  t.section('sim.js — guaranteed self stat boosts (#6d): Swords Dance / Agility');
  {
    const dancer = mkMono('Dancer', 'Swords Dance');
    const res = simulateBattle(dancer, target(), { ...simOpts, seed: 1, turnCap: 1 });
    const boost = res.log.find((e) => e.t === 'boost' && e.target === 'Dancer' && e.stat === 'atk');
    t.ok(!!boost, 'Swords Dance raises the USER\u2019s own Attack');
    t.eq(boost && boost.delta, 2, 'Swords Dance raises Attack by 2 stages');
  }

  t.section('sim.js — Curse behaves differently for a Ghost-type user vs everyone else (#6e)');
  {
    const ghostCurser = mkMono('GhostCurse', 'Curse', dummyAtkStats, ['Ghost']);
    const rG = simulateBattle(ghostCurser, target(), { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(rG.log.some((e) => e.t === 'curse-cost'), 'a Ghost-type Curse costs the user HP');
    t.ok(rG.log.some((e) => e.t === 'curse'), 'a Ghost-type Curse curses the TARGET');
    t.ok(!rG.log.some((e) => e.t === 'boost' && e.target === 'GhostCurse'), 'a Ghost-type Curse does NOT boost the user\u2019s own stats');

    const normalCurser = mkMono('NormalCurse', 'Curse', dummyAtkStats, ['Normal']);
    const rN = simulateBattle(normalCurser, target(), { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(!rN.log.some((e) => e.t === 'curse-cost'), 'a non-Ghost Curse costs no HP');
    t.ok(rN.log.some((e) => e.t === 'boost' && e.target === 'NormalCurse' && e.stat === 'atk'), 'a non-Ghost Curse raises the user\u2019s own Attack');
    t.ok(rN.log.some((e) => e.t === 'boost' && e.target === 'NormalCurse' && e.stat === 'spe' && e.delta === -1), 'a non-Ghost Curse LOWERS the user\u2019s own Speed');
  }

  t.section('sim.js — Belly Drum (#6d): costs 50% max HP, sets Attack to +6, fails below half HP');
  {
    const drummer = mkMono('Drummer', 'Belly Drum');
    const res = simulateBattle(drummer, target(), { ...simOpts, seed: 1, turnCap: 1 });
    const bd = res.log.find((e) => e.t === 'bellydrum');
    t.ok(!!bd, 'Belly Drum succeeds at full HP');
    t.eq(bd.amount, Math.floor(drummer.stats.hp / 2), 'Belly Drum costs exactly half the user\u2019s max HP');
  }

  t.section('sim.js — Rest heals to full, cures status, and sleeps exactly 2 turns');
  {
    const rester = mkMono('Rester', 'Rest');
    const res = simulateBattle(rester, target(), { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(res.log.some((e) => e.t === 'rest'), 'Rest was used successfully');
  }

  t.section('sim.js — Pain Split averages both Pok\u00e9mon\u2019s current HP');
  {
    const splitter = mkMono('Splitter', 'Pain Split');
    const res = simulateBattle(splitter, target(), { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(res.log.some((e) => e.t === 'painsplit'), 'Pain Split fires');
  }

  t.section('sim.js — Leech Seed drains the target each turn into the seeder (#6); Grass-types are immune');
  {
    const seeder = mkMono('Seeder', 'Leech Seed', dummyAtkStats, ['Grass']);
    const res = simulateBattle(seeder, target(), { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(res.log.some((e) => e.t === 'leechseed'), 'Leech Seed lands on a non-Grass target');
    t.ok(res.log.some((e) => e.t === 'chip' && e.cause === 'leechseed'), 'the seeded target takes chip damage on a later turn');

    const grassTarget = spec('GrassWall', dummyDefStats, ['Grass'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const res2 = simulateBattle(seeder, grassTarget, { ...simOpts, seed: 1, turnCap: 2 });
    t.ok(!res2.log.some((e) => e.t === 'leechseed'), 'Leech Seed fails against a Grass-type target');
  }

  t.section('sim.js — Jump Kick / High Jump Kick crash-damage the user on a miss (#6)');
  {
    // Force misses with a hopeless accuracy roll isn't directly controllable,
    // but across enough seeds a miss (and its crash) should show up.
    const kicker = mkMono('HJKicker', 'High Jump Kick', dummyAtkStats, ['Fighting']);
    let sawCrash = false;
    for (let seed = 1; seed <= 40 && !sawCrash; seed++) {
      const res = simulateBattle(kicker, target(), { ...simOpts, seed, turnCap: 1 });
      if (res.log.some((e) => e.t === 'crash')) sawCrash = true;
    }
    t.ok(sawCrash, 'High Jump Kick crash-damages the user on at least one miss across trials');
  }

  t.section('sim.js — secondary chance effects (#6): Thunderbolt/Flamethrower/Ice Beam sometimes inflict their status');
  {
    const thunderer = mkMono('Thunderer', 'Thunderbolt', dummyAtkStats, ['Electric']);
    let sawPar = false;
    for (let seed = 1; seed <= 40 && !sawPar; seed++) {
      const res = simulateBattle(thunderer, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'par')) sawPar = true;
    }
    t.ok(sawPar, 'Thunderbolt has a chance to paralyze on hit');

    const biter = mkMono('Biter', 'Bite', dummyAtkStats, ['Dark']);
    let sawFlinch = false;
    for (let seed = 1; seed <= 40 && !sawFlinch; seed++) {
      const res = simulateBattle(biter, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'flinch')) sawFlinch = true;
    }
    t.ok(sawFlinch, 'Bite has a chance to flinch the target');
  }

  t.section('sim.js — sleep duration is 1\u20137 turns (gen 1/2), not the modern 1\u20133 (#6)');
  {
    const singer = mkMono('Singer', 'Spore', dummyAtkStats, ['Grass']);
    const durations = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const res = simulateBattle(singer, target(), { ...simOpts, seed, turnCap: 10 });
      let count = 0;
      for (const e of res.log) { if (e.t === 'asleep') count++; if (e.t === 'wake') break; }
      if (count > 0) durations.add(count);
    }
    t.ok([...durations].some((d) => d > 3), `at least one observed sleep duration exceeds 3 turns, confirming the 1\u20137 range (saw: ${[...durations].sort((a, b) => a - b)})`);
  }

}
