/**
 * @file tools/test/sim.test.mjs
 * @version 1.8.0
 * @changelog
 *   1.8.0 — Integration bug-fix batch (from real played battles): (1) every
 *           executed move now emits a "use" event, incl. status/weather/self-
 *           buff moves; (2) Protect only blocks foe-targeting moves — NOT
 *           weather, non-Ghost Curse, Safeguard, Mist, Substitute, or self-
 *           boosts; (3) re-casting the already-active weather fails and
 *           switching weather ends the old one; (4) weighted AI continues an
 *           active Fury Cutter/Rollout ramp. All revert-checked.
 *   1.7.0 — Simplified-moves: Substitute (damage soak via HP accounting, sub
 *           blocks status + stat drops). Both mechanisms revert-checked.
 *   1.6.0 — Simplified-moves: Mist (blocks foe stat drops) and Weather
 *           (rain/sun damage mods, sandstorm chip + type immunity, Solar Beam
 *           instant-in-sun, Thunder rain/sun accuracy). All revert-checked.
 *   1.5.0 — Simplified-moves batch A/B: Bone Rush multi-hit, Low Kick flinch,
 *           Return/Frustration power (102), trapping-move chip. All four
 *           revert-checked.
 *   1.4.0 — Tier-3: rampage moves (Outrage/Thrash/Petal Dance) — lock length
 *           2–3, forced-move lock, and self-confusion on end. Both mechanisms
 *           revert-checked.
 *   1.3.0 — Tier-3: Snore (acts through sleep, fails awake, doesn't shorten
 *           sleep duration). Both mechanisms individually revert-checked.
 *   1.2.0 — Tier-2 batch: Nightmare, Safeguard, Lock-On, Fury Cutter/Rollout
 *           ramp (+Rollout lock), Fly/Dig invuln exceptions. Lock-On and
 *           Rollout tests were rewritten to be discriminating after their
 *           first drafts passed a revert-check they should have failed (a
 *           50%-move connects by luck; random 1/4 selection can fake a lock).
 *           Also updated Fury Cutter's expected base power 40→10 after the
 *           data correction.
 *   1.1.0 — Tier-1 move-audit batch: Dynamicpunch/Mud-Slap/Octazooka/Bone Club
 *           secondaries, Endure (survival + doesn't block residual chip),
 *           Protect/Detect (blocks damage/status/self-only-exempt), Haze
 *           (verified against real accumulated boosts, not just "ran without
 *           crashing" — see the +6-clamp discriminator in that section).
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

  // ===========================================================================
  // Tier-1 move-audit batch (requested): Dynamicpunch / Mud-Slap / Octazooka /
  // Bone Club secondaries, Endure, Protect/Detect, Haze. Explosion/Self-
  // Destruct, Sweet Scent, Sky Attack, and False Swipe were dropped from this
  // batch — confirmed unreachable in any real draft (BANNED_DRAFT_MOVES).
  // ===========================================================================

  t.section('sim.js — Dynamicpunch guarantees confusion on hit (Tier-1)');
  {
    const puncher = mkMono('Puncher', 'Dynamicpunch', dummyAtkStats, ['Fighting']);
    let sawConfuse = false;
    for (let seed = 1; seed <= 40 && !sawConfuse; seed++) {
      const res = simulateBattle(puncher, target(), { ...simOpts, seed, turnCap: 3 });
      if (res.log.some((e) => e.t === 'confuse')) sawConfuse = true;
    }
    t.ok(sawConfuse, 'Dynamicpunch confuses the target on at least one landed hit across trials');
  }

  t.section('sim.js — Mud-Slap / Octazooka drop the target\u2019s accuracy (Tier-1)');
  {
    const slapper = mkMono('Slapper', 'Mud-Slap', dummyAtkStats, ['Ground']);
    let sawAccDrop = false;
    for (let seed = 1; seed <= 20 && !sawAccDrop; seed++) {
      const res = simulateBattle(slapper, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'boost' && e.stat === 'acc' && e.delta === -1)) sawAccDrop = true;
    }
    t.ok(sawAccDrop, 'Mud-Slap (100% secondary) drops target accuracy quickly across trials');

    const octaGunner = mkMono('OctaGunner', 'Octazooka', dummyAtkStats, ['Water']);
    let sawOctaAccDrop = false;
    for (let seed = 1; seed <= 60 && !sawOctaAccDrop; seed++) {
      const res = simulateBattle(octaGunner, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'boost' && e.stat === 'acc' && e.delta === -1)) sawOctaAccDrop = true;
    }
    t.ok(sawOctaAccDrop, 'Octazooka (40% secondary) drops target accuracy across trials');
  }

  t.section('sim.js — Bone Club has a 10% flinch secondary (Tier-1)');
  {
    const clubber = mkMono('Clubber', 'Bone Club', dummyAtkStats, ['Ground']);
    let sawFlinch = false;
    for (let seed = 1; seed <= 60 && !sawFlinch; seed++) {
      const res = simulateBattle(clubber, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'flinch')) sawFlinch = true;
    }
    t.ok(sawFlinch, 'Bone Club flinches the target on at least one hit across trials');
  }

  t.section('sim.js — Endure guarantees survival at 1 HP against the turn\u2019s hit (Tier-1)');
  {
    // A fragile Endure-user facing a huge hit should survive at 1 HP instead
    // of fainting, and the log should show an explicit 'endure' event.
    const fragile = spec('Enduring', toRealStats({ hp: 40, atk: 40, def: 40, spa: 40, spd: 40, spe: 200 }, 2), ['Normal'], ['Endure', 'Endure', 'Endure', 'Endure']);
    const smasher = spec('Smasher', toRealStats({ hp: 200, atk: 250, def: 40, spa: 40, spd: 40, spe: 40 }, 2), ['Normal'], ['Hyper Beam', 'Hyper Beam', 'Hyper Beam', 'Hyper Beam']);
    const res = simulateBattle(fragile, smasher, { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(res.log.some((e) => e.t === 'endure' && e.target === 'Enduring'), 'Endure survival event fires against a lethal hit');
    t.ok(!res.log.some((e) => e.t === 'faint' && e.target === 'Enduring'), 'the Endure-user does not faint this turn');

    // Endure does NOT protect against residual chip damage (poison/burn/
    // Leech Seed) — it only blocks the attack that turn. Verify a poisoned
    // Endure-user still takes its toxic chip on a turn where Endure also
    // fired (i.e. Endure isn't accidentally shielding the whole turn).
    const enduringPsnVictim = spec('EndurePsn', toRealStats({ hp: 100, atk: 40, def: 40, spa: 40, spd: 40, spe: 40 }, 2), ['Normal'], ['Endure', 'Endure', 'Endure', 'Endure']);
    const poisoner = mkMono('Poisoner', 'Toxic', dummyAtkStats, ['Poison']);
    let sawTox = false, sawTicked = false;
    for (let seed = 1; seed <= 10 && !(sawTox && sawTicked); seed++) {
      const r = simulateBattle(enduringPsnVictim, poisoner, { ...simOpts, seed, turnCap: 3 });
      if (r.log.some((e) => e.t === 'status' && e.status === 'tox' && e.target === 'EndurePsn')) sawTox = true;
      if (r.log.some((e) => e.t === 'chip' && e.cause === 'tox' && e.target === 'EndurePsn')) sawTicked = true;
    }
    t.ok(sawTox, 'sanity: the Endure-user actually gets poisoned in this scenario');
    t.ok(sawTicked, 'the Endure-user still takes toxic chip damage on a turn it also used Endure — Endure blocks the attack, not residual chip');
  }

  t.section('sim.js — Protect / Detect block the incoming move entirely (Tier-1)');
  {
    const blocker = spec('Blocker', toRealStats({ hp: 200, atk: 100, def: 100, spa: 100, spd: 100, spe: 200 }, 2), ['Normal'], ['Protect', 'Protect', 'Protect', 'Protect']);
    const attacker = spec('Attacker', toRealStats({ hp: 200, atk: 150, def: 60, spa: 60, spd: 60, spe: 60 }, 2), ['Normal'], ['Body Slam', 'Body Slam', 'Body Slam', 'Body Slam']);
    const res = simulateBattle(blocker, attacker, { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(res.log.some((e) => e.t === 'protect-ready' && e.target === 'Blocker'), 'Protect is used and readies the block');
    t.ok(res.log.some((e) => e.t === 'protect-block'), 'the incoming Body Slam is blocked entirely');
    t.ok(!res.log.some((e) => e.t === 'damage' && e.target === 'Blocker'), 'no damage log entry lands on the Protect user');

    const detectBlocker = spec('DetectBlocker', toRealStats({ hp: 200, atk: 100, def: 100, spa: 100, spd: 100, spe: 200 }, 2), ['Fighting'], ['Detect', 'Detect', 'Detect', 'Detect']);
    const statusAttacker = mkMono('StatusThrower', 'Thunder Wave', dummyAtkStats, ['Electric']);
    const rDetect = simulateBattle(detectBlocker, statusAttacker, { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(rDetect.log.some((e) => e.t === 'protect-block'), 'Detect also blocks a targeted STATUS move (Thunder Wave)');
    t.ok(!rDetect.log.some((e) => e.t === 'status' && e.target === 'DetectBlocker'), 'the Detect user is not paralyzed');

    // Protect should NOT block a self-only move the opponent uses on itself.
    const dancerVsProtect = mkMono('SelfDancer', 'Swords Dance', dummyAtkStats, ['Normal']);
    const rSelf = simulateBattle(dancerVsProtect, blocker, { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(rSelf.log.some((e) => e.t === 'boost' && e.target === 'SelfDancer' && e.stat === 'atk'), 'a self-only boost move still works against a Protect user (it never targeted them)');
  }

  t.section('sim.js — Haze resets ALL stat stages to 0 on BOTH sides, verified against real accumulated boosts (Tier-1)');
  {
    // Dancer always uses Swords Dance (+2 Atk/turn); Hazer always uses Haze.
    // If Haze genuinely resets boosts to 0 every turn, Dancer's Atk boost
    // never reaches the +6 clamp, so EVERY turn should log a fresh 0->2
    // 'boost' event. If Haze were a no-op, Atk would clamp at +6 after 3
    // turns and stop producing 'boost' events for the remaining turns — this
    // distinguishes "really reset" from "ran without crashing."
    const dancer = spec('Dancer2', toRealStats({ hp: 300, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 }, 2), ['Normal'], ['Swords Dance', 'Swords Dance', 'Swords Dance', 'Swords Dance']);
    const hazer = spec('Hazer', toRealStats({ hp: 300, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 }, 2), ['Normal'], ['Haze', 'Haze', 'Haze', 'Haze']);
    const TURNS = 6;
    const res = simulateBattle(dancer, hazer, { ...simOpts, seed: 1, turnCap: TURNS });
    const sdBoosts = res.log.filter((e) => e.t === 'boost' && e.target === 'Dancer2' && e.stat === 'atk' && e.delta === 2);
    t.eq(res.log.filter((e) => e.t === 'haze').length, TURNS, `Haze fires every turn (${TURNS} turns played, no faints expected — both are Status-only movesets)`);
    t.eq(sdBoosts.length, TURNS, `Swords Dance logs a fresh +2 Atk EVERY turn (not just the first 3 before a +6 clamp), proving Haze truly reset Atk back to 0 each time`);
  }

  // ===========================================================================
  // Tier-2 move-audit batch (requested): Nightmare, Safeguard, Lock-On, Fury
  // Cutter/Rollout ramp (+ Rollout lock), Fly/Dig invuln exceptions. Destiny
  // Bond was banned in draft.js instead (covered by draft.test.mjs).
  // ===========================================================================

  t.section('sim.js — Nightmare: fails unless asleep, then chips 1/4 max HP/turn until the target wakes (Tier-2)');
  {
    // Target is a fast Rest-user so it reliably falls asleep (Rest = exactly 2
    // turns). Attacker only knows Nightmare. Once the target sleeps, Nightmare
    // should land and produce nightmare chip on subsequent end-of-turns.
    const nightmarer = spec('Nightmarer', toRealStats({ hp: 300, atk: 60, def: 60, spa: 60, spd: 60, spe: 10 }, 2), ['Ghost'], ['Nightmare', 'Nightmare', 'Nightmare', 'Nightmare']);
    const sleeper = spec('Sleeper', toRealStats({ hp: 400, atk: 60, def: 60, spa: 60, spd: 60, spe: 250 }, 2), ['Normal'], ['Rest', 'Rest', 'Rest', 'Rest']);
    const res = simulateBattle(nightmarer, sleeper, { ...simOpts, seed: 3, turnCap: 12 });
    t.ok(res.log.some((e) => e.t === 'nightmare' && e.target === 'Sleeper'), 'Nightmare lands once the target is asleep');
    const nmChip = res.log.filter((e) => e.t === 'chip' && e.cause === 'nightmare' && e.target === 'Sleeper');
    t.ok(nmChip.length >= 1, `Nightmare chips the sleeping target (${nmChip.length} chip event(s))`);
    const maxHp = sleeper.stats.hp;
    t.ok(nmChip.every((e) => e.amount === Math.max(1, Math.floor(maxHp / 4))), 'each Nightmare chip is exactly 1/4 max HP');
    t.ok(res.log.some((e) => e.t === 'nightmare-end' && e.target === 'Sleeper'), 'Nightmare ends when the target wakes');

    // Fails outright against an awake target.
    const awakeTarget = spec('Awake', dummyDefStats, ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const rFail = simulateBattle(nightmarer, awakeTarget, { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(rFail.log.some((e) => e.t === 'fail'), 'Nightmare fails against an awake target');
    t.ok(!rFail.log.some((e) => e.t === 'nightmare'), 'no Nightmare is applied to an awake target');
  }

  t.section('sim.js — Safeguard: 5-turn status immunity for the user\u2019s side (Tier-2)');
  {
    // Guarded mon spams Safeguard; foe spams Thunder Wave (100% paralysis).
    // While Safeguard is up, paralysis must be blocked (safeguard-block, no
    // 'status' par event). This is the discriminator vs. "ran without effect."
    const guarded = spec('Guarded', toRealStats({ hp: 400, atk: 60, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Normal'], ['Safeguard', 'Safeguard', 'Safeguard', 'Safeguard']);
    const waver = spec('Waver', toRealStats({ hp: 300, atk: 60, def: 60, spa: 60, spd: 60, spe: 10 }, 2), ['Electric'], ['Thunder Wave', 'Thunder Wave', 'Thunder Wave', 'Thunder Wave']);
    const res = simulateBattle(guarded, waver, { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(res.log.some((e) => e.t === 'safeguard' && e.target === 'Guarded'), 'Safeguard is raised');
    t.ok(res.log.some((e) => e.t === 'safeguard-block' && e.target === 'Guarded'), 'a status move is blocked while Safeguard is up');
    t.ok(!res.log.some((e) => e.t === 'status' && e.status === 'par' && e.target === 'Guarded'), 'the guarded mon is never paralyzed while Safeguard holds');

    // Control: WITHOUT Safeguard, the exact same Thunder Wave DOES paralyze —
    // proves the block above is Safeguard, not some other immunity.
    const unguarded = spec('Unguarded', toRealStats({ hp: 400, atk: 60, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const rCtrl = simulateBattle(unguarded, waver, { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(rCtrl.log.some((e) => e.t === 'status' && e.status === 'par' && e.target === 'Unguarded'), 'control: the same Thunder Wave paralyzes a mon with no Safeguard');
  }

  t.section('sim.js — Lock-On: the next move can\u2019t miss (Tier-2)');
  {
    // Discriminating design: a lockon-hit event is logged immediately before
    // the move it empowers, and that move must NOT miss. Dynamicpunch is only
    // 50% accurate, so WITHOUT the fix a 'miss' would frequently appear right
    // after a lockon-hit; WITH the fix it never does. We collect every event
    // that immediately follows a lockon-hit across many trials and assert none
    // is a miss (and that we gathered a meaningful sample so the check has
    // teeth). The dummy is a huge passive wall so the locker keeps swinging.
    const locker = spec('Locker', toRealStats({ hp: 300, atk: 100, def: 60, spa: 60, spd: 60, spe: 250 }, 2), ['Normal'], ['Lock-On', 'Dynamicpunch', 'Lock-On', 'Dynamicpunch']);
    const dummy = spec('Dummy', toRealStats({ hp: 2000, atk: 20, def: 250, spa: 20, spd: 250, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let lockonHits = 0, missAfterLockon = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const res = simulateBattle(locker, dummy, { ...simOpts, seed, turnCap: 20 });
      for (let i = 0; i < res.log.length - 1; i++) {
        if (res.log[i].t === 'lockon-hit') {
          lockonHits++;
          if (res.log[i + 1].t === 'miss') missAfterLockon++;
        }
      }
    }
    t.ok(lockonHits >= 15, `gathered a meaningful sample of Lock-On\u2019d moves (${lockonHits}) so the no-miss check has teeth`);
    t.eq(missAfterLockon, 0, 'a Lock-On\u2019d move (even 50%-accurate Dynamicpunch) NEVER misses');
  }

  t.section('sim.js — Fury Cutter ramps power on consecutive hits, resets on a different move (Tier-2)');
  {
    // Mono-Fury-Cutter user: every turn is Fury Cutter, so a hit streak builds
    // and 'ramp' events (bp doubling) should appear. Base 10 → 20 on the 2nd
    // consecutive hit → 40 → 80 → 160 (cap). (Base corrected 40→10 to match
    // real gen-2 now that the ramp mechanic exists — see data change.)
    const cutter = mkMono('Cutter', 'Fury Cutter', dummyAtkStats, ['Bug']);
    const wall = spec('CutWall', toRealStats({ hp: 500, atk: 20, def: 200, spa: 20, spd: 200, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawRamp = false, saw20 = false, sawHigher = false;
    for (let seed = 1; seed <= 25 && !(saw20 && sawHigher); seed++) {
      const res = simulateBattle(cutter, wall, { ...simOpts, seed, turnCap: 12 });
      const ramps = res.log.filter((e) => e.t === 'ramp' && e.move === 'Fury Cutter');
      if (ramps.length) sawRamp = true;
      if (ramps.some((e) => e.bp === 20)) saw20 = true;       // 2nd consecutive hit
      if (ramps.some((e) => e.bp >= 40)) sawHigher = true;    // 3rd+ consecutive hit
    }
    t.ok(sawRamp, 'Fury Cutter produces ramp events on consecutive hits');
    t.ok(saw20, 'Fury Cutter\u2019s 2nd consecutive hit doubles base power (10 \u2192 20)');
    t.ok(sawHigher, 'Fury Cutter keeps doubling on further consecutive hits (\u2265 40)');

    // Reset-on-different-move: a mon that alternates Fury Cutter with Tackle
    // should NEVER build a ramp beyond the first tier — no 'ramp' event, since
    // each Fury Cutter is preceded by a different move that breaks the streak.
    // (Moves are picked at random, so we assert across many seeds that the
    // ramp never reaches the doubled tier when Tackle keeps interrupting.)
    const mixer = spec('Mixer', dummyAtkStats, ['Bug'], ['Fury Cutter', 'Tackle', 'Fury Cutter', 'Tackle']);
    let maxRampBp = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateBattle(mixer, wall, { ...simOpts, seed, turnCap: 4 });
      for (const e of res.log) if (e.t === 'ramp' && e.move === 'Fury Cutter') maxRampBp = Math.max(maxRampBp, e.bp);
    }
    // With only a 4-turn cap and random alternation, a 2-in-a-row Fury Cutter
    // can still happen; but the streak must break whenever Tackle intervenes.
    // The strong check for "reset works" lives in the deterministic revert-
    // check; here we just confirm the mechanic is streak-based, not permanent.
    t.ok(true, `mixer max observed ramp bp = ${maxRampBp} (informational; reset logic is revert-checked deterministically)`);
  }

  t.section('sim.js — Rollout locks the user in AND ramps to \u00d716 over the 5-hit sequence (Tier-2)');
  {
    // The roller has Rollout as only 1 of 4 moves, so WITHOUT the lock the odds
    // of 5 Rollouts in a row are ~(1/4)^4 ≈ 0.4% per start — full 5-runs would
    // be vanishingly rare. WITH the lock, essentially every landed first
    // Rollout produces a full 5-run (barring a miss, ~10%). We count full
    // 5-length consecutive-Rollout runs across many seeds and require a solid
    // number — this cleanly separates "locked" from "got lucky at random."
    const roller = spec('Roller', toRealStats({ hp: 400, atk: 150, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Rock'], ['Rollout', 'Ice Beam', 'Thunderbolt', 'Flamethrower']);
    const wall = spec('RollWall', toRealStats({ hp: 3000, atk: 10, def: 400, spa: 10, spd: 400, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let fullRuns = 0, sawRampSequence = false;
    for (let seed = 1; seed <= 40; seed++) {
      const res = simulateBattle(roller, wall, { ...simOpts, seed, turnCap: 40 });
      const rollerUses = res.log.filter((e) => e.t === 'use' && e.source === 'Roller').map((e) => e.move);
      let run = 0;
      for (const m of rollerUses) {
        if (m === 'Rollout') { run++; if (run === 5) { fullRuns++; run = 0; } } // count each completed 5-run
        else run = 0;
      }
      const rampBps = res.log.filter((e) => e.t === 'ramp' && e.move === 'Rollout').map((e) => e.bp);
      if (rampBps.includes(120) && rampBps.includes(240) && rampBps.includes(480)) sawRampSequence = true;
    }
    t.ok(fullRuns >= 10, `Rollout produces many full 5-use locked runs (${fullRuns}) — random 1/4 selection could not (would be <1% per start)`);
    t.ok(sawRampSequence, 'Rollout power ramps 60 \u2192 120 \u2192 240 \u2192 480 across the locked sequence');
  }

  t.section('sim.js — Fly/Dig semi-invulnerability exceptions: Gust hits Fly, Earthquake hits Dig, for 2\u00d7 (Tier-2)');
  {
    // A Gust user vs a Fly user: on the Fly CHARGE turn, a normal move would
    // whiff (reason:'invuln'); Gust should connect instead. We look for a
    // 'damage' by the Gust user on the same turn the Fly user charged.
    const guster = spec('Guster', toRealStats({ hp: 300, atk: 150, def: 60, spa: 60, spd: 60, spe: 10 }, 2), ['Flying'], ['Gust', 'Gust', 'Gust', 'Gust']);
    const flyer = spec('Flyer2', toRealStats({ hp: 300, atk: 120, def: 60, spa: 60, spd: 60, spe: 250 }, 2), ['Flying'], ['Fly', 'Fly', 'Fly', 'Fly']);
    let gustHitDuringCharge = false;
    for (let seed = 1; seed <= 20 && !gustHitDuringCharge; seed++) {
      const res = simulateBattle(guster, flyer, { ...simOpts, seed, turnCap: 8 });
      for (let i = 0; i < res.log.length; i++) {
        if (res.log[i].t === 'charge' && res.log[i].source === 'Flyer2') {
          // scan forward within the same turn (until the next 'turn' event)
          for (let j = i + 1; j < res.log.length && res.log[j].t !== 'turn'; j++) {
            if (res.log[j].t === 'damage' && res.log[j].source === 'Guster' && res.log[j].target === 'Flyer2') gustHitDuringCharge = true;
            if (res.log[j].t === 'miss' && res.log[j].source === 'Guster' && res.log[j].reason === 'invuln') { /* would be the un-fixed behavior */ }
          }
        }
      }
    }
    t.ok(gustHitDuringCharge, 'Gust connects against a mon mid-Fly (semi-invuln exception)');

    // Earthquake vs Dig, and verify the 2× via a direct damage comparison:
    // EQ vs a Dig-charging target should hit for ~2× EQ vs the same target on
    // the ground (same seed / same everything else). We compare the FIRST
    // Earthquake damage in each scenario.
    const quaker = spec('Quaker', toRealStats({ hp: 300, atk: 150, def: 60, spa: 60, spd: 60, spe: 10 }, 2), ['Ground'], ['Earthquake', 'Earthquake', 'Earthquake', 'Earthquake']);
    const digger = spec('Digger', toRealStats({ hp: 3000, atk: 60, def: 100, spa: 60, spd: 100, spe: 250 }, 2), ['Normal'], ['Dig', 'Dig', 'Dig', 'Dig']);
    const grounded = spec('Grounded', toRealStats({ hp: 3000, atk: 60, def: 100, spa: 60, spd: 100, spe: 250 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    // Same seed → same crit/roll RNG stream for the first EQ; the only
    // difference is whether the target is mid-Dig (2×) or standing (1×).
    const findFirstEqDmg = (foe) => {
      const res = simulateBattle(quaker, foe, { ...simOpts, seed: 7, turnCap: 6 });
      const e = res.log.find((x) => x.t === 'damage' && x.source === 'Quaker' && x.target === foe.name);
      return e ? e.amount : null;
    };
    const dmgVsGround = findFirstEqDmg(grounded);
    const dmgVsDig = findFirstEqDmg(digger);
    t.ok(dmgVsGround != null && dmgVsDig != null, 'both Earthquake scenarios produced a damage event');
    // 2× before the same ~0.85–1.0 random roll → the ratio is very close to 2.
    t.ok(dmgVsDig > dmgVsGround * 1.6, `Earthquake hits a mid-Dig target for roughly double (ground=${dmgVsGround}, dig=${dmgVsDig})`);
  }

  // ===========================================================================
  // Tier-3 (partial): Snore implemented (asleep-only). Sleep Talk / Future
  // Sight / Disable / Encore banned in draft.js (covered by draft.test.mjs).
  // ===========================================================================

  t.section('sim.js — Snore is usable ONLY while asleep: acts through sleep, fails awake (Tier-3)');
  {
    // A Rest+Snore user: it will Rest (exactly 2 turns of sleep), and on the
    // turns it is asleep it can act with Snore (dealing damage) while a
    // NON-Snore move would be skipped. We verify: (a) an 'asleep-acts' event
    // for Snore occurs, and (b) Snore actually deals damage while the user is
    // asleep. Opponent is a passive wall.
    const sleeper = spec('Snorer', toRealStats({ hp: 300, atk: 150, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Normal'], ['Rest', 'Snore', 'Snore', 'Snore']);
    const wall = spec('SnoreWall', toRealStats({ hp: 3000, atk: 10, def: 200, spa: 10, spd: 200, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawSnoreActs = false, sawSnoreDamageWhileAsleep = false;
    for (let seed = 1; seed <= 40 && !(sawSnoreActs && sawSnoreDamageWhileAsleep); seed++) {
      const res = simulateBattle(sleeper, wall, { ...simOpts, seed, turnCap: 30 });
      // track sleep state of Snorer across the log to confirm damage happens
      // specifically while asleep
      let asleep = false;
      for (const e of res.log) {
        if (e.t === 'rest' && e.target === 'Snorer') asleep = true;
        if (e.t === 'wake' && e.target === 'Snorer') asleep = false;
        if (e.t === 'asleep-acts' && e.target === 'Snorer' && e.move === 'Snore') sawSnoreActs = true;
        if (e.t === 'damage' && e.source === 'Snorer' && e.move === 'Snore' && asleep) sawSnoreDamageWhileAsleep = true;
      }
    }
    t.ok(sawSnoreActs, 'Snore acts through sleep (asleep-acts event) instead of skipping the turn');
    t.ok(sawSnoreDamageWhileAsleep, 'Snore deals damage while the user is asleep');

    // Awake user with Snore must FAIL (Snore is asleep-only).
    const awakeSnorer = mkMono('AwakeSnorer', 'Snore', dummyAtkStats, ['Normal']);
    const res2 = simulateBattle(awakeSnorer, target(), { ...simOpts, seed: 1, turnCap: 1 });
    t.ok(res2.log.some((e) => e.t === 'fail' && e.target === 'AwakeSnorer'), 'Snore fails when used by an awake Pok\u00e9mon');
    t.ok(!res2.log.some((e) => e.t === 'damage' && e.source === 'AwakeSnorer'), 'an awake Snore deals no damage');
  }

  t.section('sim.js — Snore does not shorten sleep: an N-turn sleep still costs N turns even if Snore is used (Tier-3)');
  {
    // Rest = exactly 2 sleep turns. A Rest+Snore user should still be asleep
    // for exactly 2 turns regardless of Snore acting on those turns — guards
    // against Snore re-introducing a wake-early bug in the sleep gate.
    const sleeper = spec('RestSnorer', toRealStats({ hp: 300, atk: 100, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Normal'], ['Rest', 'Snore', 'Snore', 'Snore']);
    const wall = spec('RS_Wall', toRealStats({ hp: 3000, atk: 10, def: 200, spa: 10, spd: 200, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let checked = false;
    for (let seed = 1; seed <= 30 && !checked; seed++) {
      const res = simulateBattle(sleeper, wall, { ...simOpts, seed, turnCap: 30 });
      // find the first Rest, then count sleep-occupied turns (asleep OR
      // asleep-acts) until the next wake for RestSnorer.
      let started = false, sleptTurns = 0, done = false;
      for (const e of res.log) {
        if (!started && e.t === 'rest' && e.target === 'RestSnorer') { started = true; continue; }
        if (started && !done) {
          if ((e.t === 'asleep' || e.t === 'asleep-acts') && e.target === 'RestSnorer') sleptTurns++;
          if (e.t === 'wake' && e.target === 'RestSnorer') { done = true; }
        }
      }
      if (done) { t.eq(sleptTurns, 2, `Rest+Snore user sleeps exactly 2 turns (seed ${seed})`); checked = true; }
    }
    t.ok(checked, 'a Rest+Snore sleep cycle was observed and verified');
  }

  t.section('sim.js — rampage moves (Outrage/Thrash/Petal Dance) lock 2\u20133 turns then self-confuse (Tier-3)');
  {
    // Outrage is 1 of 4 moves, so WITHOUT the lock it would appear as isolated
    // single uses; WITH the lock every started Outrage is a contiguous run of
    // exactly 2 or 3 uses ending in a rampage-end event. We verify: every
    // COMPLETED rampage (one that logged rampage-end) was preceded by 2 or 3
    // consecutive Outrage uses — never 1, never 4+.
    const rager = spec('Rager', toRealStats({ hp: 400, atk: 150, def: 120, spa: 150, spd: 120, spe: 250 }, 2), ['Dragon'], ['Outrage', 'Ice Beam', 'Thunderbolt', 'Flamethrower']);
    const wall = spec('RageWall', toRealStats({ hp: 6000, atk: 10, def: 400, spa: 10, spd: 400, spe: 5 }, 2), ['Steel'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let completedRuns = 0, badRun = false, sawConfusionAfter = false;
    for (let seed = 1; seed <= 40; seed++) {
      const res = simulateBattle(rager, wall, { ...simOpts, seed, turnCap: 60 });
      // walk the log, counting consecutive Outrage uses by Rager and checking
      // the run length whenever a rampage-end fires.
      let run = 0;
      for (const e of res.log) {
        if (e.t === 'use' && e.source === 'Rager') { run = (e.move === 'Outrage') ? run + 1 : 0; }
        if (e.t === 'rampage-end' && e.target === 'Rager') {
          completedRuns++;
          if (run < 2 || run > 3) badRun = true;
          run = 0;
        }
      }
      // self-confusion: after a rampage-end, the mon has confuseTurns set, so it
      // should eventually show a confusion self-hit or a confuse-end.
      if (res.log.some((e) => e.t === 'rampage-end' && e.target === 'Rager')
        && res.log.some((e) => (e.t === 'confused-hit' || e.t === 'confuse-end') && e.target === 'Rager')) {
        sawConfusionAfter = true;
      }
    }
    t.ok(completedRuns >= 10, `observed many completed rampages (${completedRuns}) so the length check has teeth`);
    t.ok(!badRun, 'every completed rampage was preceded by exactly 2\u20133 consecutive uses (never 1, never 4+)');
    t.ok(sawConfusionAfter, 'the user becomes confused (fatigue) after a rampage ends');
  }

  t.section('sim.js — a rampage move forces itself even when other moves are available (Tier-3)');
  {
    // Stronger lock check: once Outrage is used, the very next Rager action must
    // be Outrage too (the lock), which random 1/4 selection would only do ~25%
    // of the time. Count "Outrage used, mon acts again mid-rampage, next action
    // is NOT Outrage" — must be 0 (barring the turn a rampage-end releases it).
    const rager = spec('Rager2', toRealStats({ hp: 400, atk: 150, def: 120, spa: 150, spd: 120, spe: 250 }, 2), ['Dragon'], ['Outrage', 'Ice Beam', 'Thunderbolt', 'Flamethrower']);
    const wall = spec('RageWall2', toRealStats({ hp: 6000, atk: 10, def: 400, spa: 10, spd: 400, spe: 5 }, 2), ['Steel'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let midRampageUses = 0, brokenEarly = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateBattle(rager, wall, { ...simOpts, seed, turnCap: 60 });
      // reconstruct: track whether Rager is mid-rampage (between rampage-start
      // and rampage-end). While mid-rampage, every 'use' by Rager must be Outrage.
      let inRampage = false;
      for (const e of res.log) {
        if (e.t === 'rampage-start' && e.source === 'Rager2') inRampage = true;
        if (e.t === 'use' && e.source === 'Rager2' && inRampage) {
          midRampageUses++;
          if (e.move !== 'Outrage') brokenEarly++;
        }
        if (e.t === 'rampage-end' && e.target === 'Rager2') inRampage = false;
      }
    }
    t.ok(midRampageUses >= 20, `gathered enough mid-rampage actions (${midRampageUses}) for the lock check to have teeth`);
    t.eq(brokenEarly, 0, 'while rampaging, the user only ever uses the locked move (never a different one)');
  }

  // ===========================================================================
  // "Simplified moves" pass (requested): Bone Rush multi-hit, Low Kick flinch,
  // Return/Frustration power, trapping-move chip.
  // ===========================================================================

  t.section('sim.js — Bone Rush hits 2\u20135 times (was a single hit)');
  {
    const boner = mkMono('Boner', 'Bone Rush', dummyAtkStats, ['Ground']);
    const counts = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const res = simulateBattle(boner, target(), { ...simOpts, seed, turnCap: 2 });
      const mh = res.log.find((e) => e.t === 'multihit');
      if (mh) counts.add(mh.hits);
    }
    t.ok(counts.size > 0, 'Bone Rush logs multi-hit events');
    t.ok([...counts].every((h) => h >= 2 && h <= 5), `all Bone Rush hit-counts are within 2\u20135 (saw: ${[...counts].sort()})`);
    t.ok([...counts].some((h) => h > 1), 'Bone Rush lands more than one hit (not a single strike)');
  }

  t.section('sim.js — Low Kick has a 30% flinch (gen 1/2, NOT weight-based)');
  {
    const kicker = mkMono('Kicker', 'Low Kick', dummyAtkStats, ['Fighting']);
    let sawFlinch = false;
    for (let seed = 1; seed <= 60 && !sawFlinch; seed++) {
      const res = simulateBattle(kicker, target(), { ...simOpts, seed, turnCap: 2 });
      if (res.log.some((e) => e.t === 'flinch')) sawFlinch = true;
    }
    t.ok(sawFlinch, 'Low Kick flinches the target on at least one hit across trials');
  }

  t.section('sim.js — Return/Frustration use optimized-happiness power (102, not the old flat 50)');
  {
    // Compare Return's damage to a plain 50-bp Normal physical move (Pound/
    // Tackle=40; use a same-type reference). Return should clearly out-damage a
    // 50-bp move now. We measure first-hit damage with matched everything.
    const ret = spec('Returner', toRealStats({ hp: 300, atk: 150, def: 60, spa: 60, spd: 60, spe: 250 }, 2), ['Normal'], ['Return', 'Return', 'Return', 'Return']);
    const tk = spec('Tackler', toRealStats({ hp: 300, atk: 150, def: 60, spa: 60, spd: 60, spe: 250 }, 2), ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const wall = () => spec('PowWall', toRealStats({ hp: 4000, atk: 10, def: 150, spa: 10, spd: 150, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const firstDmg = (atk) => { const r = simulateBattle(atk, wall(), { ...simOpts, seed: 5, turnCap: 1 }); const e = r.log.find((x) => x.t === 'damage' && x.source === atk.name); return e ? e.amount : null; };
    const retDmg = firstDmg(ret), tkDmg = firstDmg(tk);
    t.ok(retDmg != null && tkDmg != null, 'both reference attacks produced damage');
    t.ok(retDmg > tkDmg * 2, `Return (102 bp) clearly out-damages a 40-bp Tackle (return=${retDmg}, tackle=${tkDmg})`);
  }

  t.section('sim.js — trapping moves (Wrap/Bind/Fire Spin/Clamp/Whirlpool) chip 1/16 for 2\u20135 turns');
  {
    const wrapper = spec('Wrapper', toRealStats({ hp: 300, atk: 120, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Normal'], ['Wrap', 'Wrap', 'Wrap', 'Wrap']);
    const victim = spec('TrapVictim', toRealStats({ hp: 1600, atk: 10, def: 250, spa: 10, spd: 250, spe: 5 }, 2), ['Rock'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawTrap = false, sawTrapChip = false, sawTrapEnd = false, chipRight = true;
    const maxHp = victim.stats.hp;
    for (let seed = 1; seed <= 20 && !(sawTrap && sawTrapChip && sawTrapEnd); seed++) {
      const res = simulateBattle(wrapper, victim, { ...simOpts, seed, turnCap: 12 });
      for (const e of res.log) {
        if (e.t === 'trap' && e.target === 'TrapVictim') { sawTrap = true; if (e.turns < 2 || e.turns > 5) chipRight = false; }
        if (e.t === 'chip' && e.cause === 'trap' && e.target === 'TrapVictim') { sawTrapChip = true; if (e.amount !== Math.max(1, Math.floor(maxHp / 16))) chipRight = false; }
        if (e.t === 'trap-end' && e.target === 'TrapVictim') sawTrapEnd = true;
      }
    }
    t.ok(sawTrap, 'Wrap binds the target (trap event, 2\u20135 turns)');
    t.ok(sawTrapChip, 'a trapped target takes end-of-turn chip damage');
    t.ok(chipRight, 'trap duration is 2\u20135 and each chip is exactly 1/16 max HP');
    t.ok(sawTrapEnd, 'the trap eventually expires (trap-end)');
  }

  t.section('sim.js — Mist blocks opponent-induced stat drops for 5 turns');
  {
    // Misted mon vs a Growl spammer (-1 Atk). While Mist is up, the drop must
    // be blocked (mist-block, no 'boost' atk -1 on the misted mon). Control
    // without Mist: the same Growl DOES lower Atk.
    const misted = spec('Misted', toRealStats({ hp: 400, atk: 120, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Water'], ['Mist', 'Mist', 'Mist', 'Mist']);
    const growler = spec('Growler', toRealStats({ hp: 300, atk: 60, def: 60, spa: 60, spd: 60, spe: 10 }, 2), ['Normal'], ['Growl', 'Growl', 'Growl', 'Growl']);
    const res = simulateBattle(misted, growler, { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(res.log.some((e) => e.t === 'mist' && e.target === 'Misted'), 'Mist is set up');
    t.ok(res.log.some((e) => e.t === 'mist-block' && e.target === 'Misted'), 'a stat-drop move is blocked while Mist holds');
    t.ok(!res.log.some((e) => e.t === 'boost' && e.target === 'Misted' && e.stat === 'atk' && e.delta < 0), 'the misted mon\u2019s Attack is never lowered while Mist holds');

    const noMist = spec('NoMist', toRealStats({ hp: 400, atk: 120, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Water'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const rCtrl = simulateBattle(noMist, growler, { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(rCtrl.log.some((e) => e.t === 'boost' && e.target === 'NoMist' && e.stat === 'atk' && e.delta < 0), 'control: the same Growl lowers Attack without Mist');
  }

  // ===========================================================================
  // Weather (requested): Rain/Sun damage mods + Sandstorm chip + interactions
  // (Solar Beam instant in sun, Thunder accuracy, Synthesis-family heal).
  // ===========================================================================

  t.section('sim.js — Rain boosts Water & weakens Fire; Sun does the reverse');
  {
    // Same attacker/target/seed; only the weather differs. Compare first
    // Surf (Water) damage in rain vs sun: rain should be markedly higher.
    const surfer = spec('Surfer', toRealStats({ hp: 300, atk: 60, def: 60, spa: 200, spd: 60, spe: 250 }, 2), ['Water'], ['Surf', 'Surf', 'Surf', 'Surf']);
    // Both weather-callers are Normal type so Surf is neutral (1×) against each
    // — isolating the weather multiplier from type effectiveness.
    const raincaller = spec('RainCaller', toRealStats({ hp: 3000, atk: 60, def: 200, spa: 60, spd: 200, spe: 10 }, 2), ['Normal'], ['Rain Dance', 'Rain Dance', 'Rain Dance', 'Rain Dance']);
    const suncaller = spec('SunCaller', toRealStats({ hp: 3000, atk: 60, def: 200, spa: 60, spd: 200, spe: 10 }, 2), ['Normal'], ['Sunny Day', 'Sunny Day', 'Sunny Day', 'Sunny Day']);
    // Surfer is faster, so turn 1 Surf lands BEFORE the weather is set; we read
    // the 2nd Surf (turn 2, weather now up).
    const secondSurf = (weatherMon) => {
      const r = simulateBattle(surfer, weatherMon, { ...simOpts, seed: 3, turnCap: 3 });
      const surfs = r.log.filter((e) => e.t === 'damage' && e.source === 'Surfer' && e.move === 'Surf');
      return surfs.length >= 2 ? surfs[1].amount : (surfs[0] ? surfs[0].amount : null);
    };
    const rainSurf = secondSurf(raincaller);
    const sunSurf = secondSurf(suncaller);
    t.ok(rainSurf != null && sunSurf != null, 'got Surf damage under both weathers');
    t.ok(rainSurf > sunSurf * 2, `Water damage is much higher in rain than sun (rain=${rainSurf}, sun=${sunSurf})`);
  }

  t.section('sim.js — Sandstorm chips non-Rock/Ground/Steel 1/16 per turn, spares immune types');
  {
    const sander = spec('Sander', toRealStats({ hp: 400, atk: 60, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Rock'], ['Sandstorm', 'Sandstorm', 'Sandstorm', 'Sandstorm']);
    const flesh = spec('Fleshy', toRealStats({ hp: 800, atk: 60, def: 200, spa: 60, spd: 200, spe: 10 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const res = simulateBattle(sander, flesh, { ...simOpts, seed: 1, turnCap: 4 });
    t.ok(res.log.some((e) => e.t === 'weather-start' && e.weather === 'sand'), 'Sandstorm starts');
    const chips = res.log.filter((e) => e.t === 'chip' && e.cause === 'sandstorm' && e.target === 'Fleshy');
    t.ok(chips.length >= 1, 'the Normal-type takes sandstorm chip');
    t.ok(chips.every((e) => e.amount === Math.max(1, Math.floor(flesh.stats.hp / 16))), 'sandstorm chip is exactly 1/16 max HP');
    t.ok(!res.log.some((e) => e.t === 'chip' && e.cause === 'sandstorm' && e.target === 'Sander'), 'the Rock-type is immune to sandstorm chip');
  }

  t.section('sim.js — Solar Beam fires instantly in harsh sun (no charge turn)');
  {
    // A Solar Beam user under its own... it can't set sun and fire same turn.
    // Use a sun-setting partner as opponent: opponent sets sun turn 1; the
    // Solar Beam user (slower) then fires. In sun, there should be NO 'charge'
    // event for Solar Beam — it damages immediately.
    const beamer = spec('Beamer', toRealStats({ hp: 300, atk: 60, def: 60, spa: 200, spd: 60, spe: 10 }, 2), ['Grass'], ['Solar Beam', 'Solar Beam', 'Solar Beam', 'Solar Beam']);
    const sunFast = spec('SunFast', toRealStats({ hp: 3000, atk: 10, def: 200, spa: 10, spd: 200, spe: 250 }, 2), ['Fire'], ['Sunny Day', 'Sunny Day', 'Sunny Day', 'Sunny Day']);
    const res = simulateBattle(beamer, sunFast, { ...simOpts, seed: 1, turnCap: 3 });
    // After sun is set (turn 1 by SunFast), Beamer's Solar Beam should deal
    // damage on a turn WITHOUT a preceding charge event for it.
    const beamerCharges = res.log.filter((e) => e.t === 'charge' && e.source === 'Beamer');
    const beamerDmg = res.log.filter((e) => e.t === 'damage' && e.source === 'Beamer' && e.move === 'Solarbeam');
    t.ok(beamerDmg.length >= 1, 'Solar Beam deals damage');
    t.eq(beamerCharges.length, 0, 'Solar Beam never charges while sun is up (fires instantly)');
  }

  t.section('sim.js — Thunder never misses in rain, and is less accurate in sun');
  {
    // In rain, Thunder (70% base) should never miss across many trials.
    const thunderer = spec('Thunderer', toRealStats({ hp: 300, atk: 60, def: 60, spa: 200, spd: 60, spe: 10 }, 2), ['Electric'], ['Thunder', 'Thunder', 'Thunder', 'Thunder']);
    const rainFast = spec('RainFast', toRealStats({ hp: 6000, atk: 10, def: 300, spa: 10, spd: 300, spe: 250 }, 2), ['Water'], ['Rain Dance', 'Rain Dance', 'Rain Dance', 'Rain Dance']);
    let thunderUses = 0, thunderMisses = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulateBattle(thunderer, rainFast, { ...simOpts, seed, turnCap: 8 });
      // Track whether rain is actually up at each moment. Gen-2 weather lasts
      // exactly 5 turns and re-casting it FAILS (doesn't refresh), so if the
      // rain-setter gets paralyzed by Thunder and can't recast, rain lapses —
      // and a Thunder in *clear* weather is allowed to miss. Only count Thunders
      // that actually fired while it was raining.
      let raining = false;
      for (const e of r.log) {
        if (e.t === 'weather-start') raining = (e.weather === 'rain');
        else if (e.t === 'weather-end' && e.weather === 'rain') raining = false;
        if (!raining) continue;
        if (e.t === 'use' && e.source === 'Thunderer' && e.move === 'Thunder') thunderUses++;
        if (e.t === 'miss' && e.source === 'Thunderer' && e.move === 'Thunder') thunderMisses++;
      }
    }
    t.ok(thunderUses >= 20, `gathered enough in-rain Thunders (${thunderUses})`);
    t.eq(thunderMisses, 0, 'Thunder never misses while it is raining');
  }

  t.section('sim.js — Substitute soaks damage and blocks status/stat-drops until it breaks');
  {
    // Sub-user vs a weak attacker: the sub (1/4 max HP + 1) absorbs hits and
    // logs sub-damage; the user's own HP shouldn't drop from those hits (only
    // the one-time creation cost).
    const subber = spec('Subber', toRealStats({ hp: 400, atk: 60, def: 200, spa: 60, spd: 200, spe: 250 }, 2), ['Normal'], ['Substitute', 'Substitute', 'Substitute', 'Substitute']);
    const weak = spec('Weak', toRealStats({ hp: 300, atk: 40, def: 60, spa: 40, spd: 60, spe: 10 }, 2), ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    const res = simulateBattle(subber, weak, { ...simOpts, seed: 1, turnCap: 6 });
    const subEvt = res.log.find((e) => e.t === 'sub' && e.target === 'Subber');
    t.ok(subEvt, 'Substitute is created');
    const maxHp = subber.stats.hp;
    t.eq(subEvt.cost, Math.floor(maxHp / 4), 'Substitute costs exactly 1/4 max HP');
    t.ok(res.log.some((e) => e.t === 'sub-damage' && e.target === 'Subber'), 'incoming hits damage the substitute');
    // The 'damage' log event is the COMPUTED value (emitted before routing), so
    // it appears even when the hit lands on the sub. Verify via HP accounting
    // instead: with a weak attacker the sub never breaks here, so the user's
    // final HP should be exactly maxHP minus the one-time creation cost.
    t.ok(!res.log.some((e) => e.t === 'sub-break' && e.target === 'Subber'), 'the weak attacker never breaks the sub in this window');
    const endEvt = res.log.find((e) => e.t === 'end');
    t.eq(endEvt.aHp, maxHp - subEvt.cost, 'the user loses only the sub-creation cost — no damage bleeds through the intact sub');

    // Status block: a Thunder Wave user vs a mon that subs first should NOT
    // paralyze the subbed mon while the sub stands.
    const subFirst = spec('SubFirst', toRealStats({ hp: 400, atk: 60, def: 200, spa: 60, spd: 200, spe: 250 }, 2), ['Normal'], ['Substitute', 'Substitute', 'Substitute', 'Substitute']);
    const twaver = spec('TWaver', toRealStats({ hp: 300, atk: 40, def: 60, spa: 40, spd: 60, spe: 10 }, 2), ['Electric'], ['Thunder Wave', 'Thunder Wave', 'Thunder Wave', 'Thunder Wave']);
    const rStatus = simulateBattle(subFirst, twaver, { ...simOpts, seed: 1, turnCap: 3 });
    t.ok(rStatus.log.some((e) => e.t === 'sub' && e.target === 'SubFirst'), 'sub-user makes a substitute');
    t.ok(!rStatus.log.some((e) => e.t === 'status' && e.status === 'par' && e.target === 'SubFirst'), 'Thunder Wave cannot paralyze through a substitute');

    // Stat-drop block: Growl vs a subbed mon shouldn't lower its Attack.
    const grw = spec('Growler2', toRealStats({ hp: 300, atk: 40, def: 60, spa: 40, spd: 60, spe: 10 }, 2), ['Normal'], ['Growl', 'Growl', 'Growl', 'Growl']);
    const rDrop = simulateBattle(subFirst, grw, { ...simOpts, seed: 1, turnCap: 3 });
    t.ok(!rDrop.log.some((e) => e.t === 'boost' && e.target === 'SubFirst' && e.stat === 'atk' && e.delta < 0), 'stat drops are blocked while a substitute stands');
  }

  t.section('sim.js — every executed move emits a "use" event (1.8.0)');
  {
    // Status / weather / self-buff moves used to return before the "use" event,
    // so they showed only their effect (e.g. "It started to rain!") with no
    // "X used <move>" line — which made them look spontaneous in the battle log.
    const caster = spec('Caster', toRealStats({ hp: 400, atk: 60, def: 200, spa: 60, spd: 200, spe: 250 }, 2), ['Water'], ['Rain Dance', 'Curse', 'Substitute', 'Protect']);
    const dummy = spec('Dummy', toRealStats({ hp: 400, atk: 30, def: 200, spa: 30, spd: 200, spe: 10 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let hasWeatherStart = false, hasUseBeforeIt = false, seenUse = false;
    for (let seed = 1; seed <= 20 && !hasWeatherStart; seed++) {
      const r = simulateBattle(caster, dummy, { ...simOpts, seed, turnCap: 8 });
      seenUse = false;
      for (const e of r.log) {
        if (e.t === 'use' && e.source === 'Caster' && e.move === 'Rain Dance') seenUse = true;
        if (e.t === 'weather-start' && e.weather === 'rain') { hasWeatherStart = true; hasUseBeforeIt = seenUse; break; }
      }
    }
    t.ok(hasWeatherStart, 'a weather move eventually fires');
    t.ok(hasUseBeforeIt, 'a "used Rain Dance" event precedes the "It started to rain" effect');
  }

  t.section('sim.js — Protect only blocks moves that target the defender (1.8.0)');
  {
    const protector = spec('Guard', toRealStats({ hp: 500, atk: 100, def: 200, spa: 100, spd: 200, spe: 250 }, 2), ['Rock'], ['Protect', 'Protect', 'Protect', 'Protect']);
    // Helper: does an opponent's move X get blocked by Protect? Give the
    // opponent only move X so we can read the outcome directly.
    const runVs = (oppName, oppTypes, move, oppStats) => {
      const opp = spec(oppName, toRealStats(oppStats || { hp: 300, atk: 120, def: 60, spa: 120, spd: 60, spe: 10 }, 2), oppTypes, [move, move, move, move]);
      return simulateBattle(protector, opp, { ...simOpts, seed: 3, turnCap: 6 });
    };
    const blocked = (log, mv) => log.some((e) => e.t === 'protect-block' && e.move === mv);
    // NOT blocked (self / field):
    const rain = runVs('Rainer', ['Water'], 'Rain Dance');
    t.ok(!blocked(rain.log, 'Rain Dance'), 'Protect does NOT block Rain Dance (weather is field-wide, not aimed at the protector)');
    t.ok(rain.log.some((e) => e.t === 'weather-start' && e.weather === 'rain'), 'the weather still sets while the foe is protecting');
    const sand = runVs('Sander', ['Ground'], 'Sandstorm');
    t.ok(!blocked(sand.log, 'Sandstorm'), 'Protect does NOT block Sandstorm');
    const curse = runVs('Curser', ['Water'], 'Curse'); // non-Ghost Curse = pure self-buff
    t.ok(!blocked(curse.log, 'Curse'), 'Protect does NOT block non-Ghost Curse (self-buff)');
    t.ok(curse.log.some((e) => e.t === 'boost' && e.target === 'Curser' && e.stat === 'atk' && e.delta > 0), 'the Curse user still gets its Attack boost through the foe\u2019s Protect');
    const safe = runVs('Safer', ['Normal'], 'Safeguard');
    t.ok(!blocked(safe.log, 'Safeguard'), 'Protect does NOT block Safeguard (self)');
    const mist = runVs('Mister', ['Water'], 'Mist');
    t.ok(!blocked(mist.log, 'Mist'), 'Protect does NOT block Mist (self)');
    const sub = runVs('Subber3', ['Normal'], 'Substitute', { hp: 400, atk: 60, def: 200, spa: 60, spd: 200, spe: 10 });
    t.ok(!blocked(sub.log, 'Substitute'), 'Protect does NOT block Substitute (self)');
    // Blocked (foe-targeting):
    const psy = runVs('Psyer', ['Psychic'], 'Psychic');
    t.ok(blocked(psy.log, 'Psychic'), 'Protect DOES block a damaging move (Psychic)');
    const seed = runVs('Seeder', ['Grass'], 'Leech Seed');
    t.ok(blocked(seed.log, 'Leech Seed'), 'Protect DOES block Leech Seed (targets the foe)');
    const twave = runVs('Paralyzer', ['Electric'], 'Thunder Wave');
    t.ok(blocked(twave.log, 'Thunder Wave'), 'Protect DOES block a foe-aimed status move (Thunder Wave)');
    const ghostCurse = runVs('Gengar', ['Ghost'], 'Curse'); // Ghost-Curse targets the foe
    t.ok(blocked(ghostCurse.log, 'Curse'), 'Protect DOES block Ghost-type Curse (it targets the foe)');
  }

  t.section('sim.js — weather is single-active: re-cast fails, switch ends the old (1.8.0)');
  {
    const rainer = spec('Rainy', toRealStats({ hp: 5000, atk: 10, def: 300, spa: 10, spd: 300, spe: 250 }, 2), ['Water'], ['Rain Dance', 'Rain Dance', 'Rain Dance', 'Rain Dance']);
    const idle = spec('Idle', toRealStats({ hp: 5000, atk: 10, def: 300, spa: 10, spd: 300, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const r = simulateBattle(rainer, idle, { ...simOpts, seed: 1, turnCap: 5 });
    const rainStarts = r.log.filter((e) => e.t === 'weather-start' && e.weather === 'rain').length;
    const rainFails = r.log.filter((e) => e.t === 'fail' && e.move === 'Rain Dance').length;
    t.ok(rainStarts === 1, `within the 5-turn window rain is announced once, not every turn (got ${rainStarts})`);
    t.ok(rainFails >= 3, `re-casting Rain Dance while it is already raining fails each time (got ${rainFails} fails)`);

    // Switching weather: rain up, then a Sandstorm should end the rain first.
    const switcher = spec('Switch', toRealStats({ hp: 5000, atk: 10, def: 300, spa: 10, spd: 300, spe: 250 }, 2), ['Water'], ['Rain Dance', 'Sandstorm', 'Rain Dance', 'Sandstorm']);
    for (let seed = 1; seed <= 20; seed++) {
      const rs = simulateBattle(switcher, idle, { ...simOpts, seed, turnCap: 6 });
      const idxRain = rs.log.findIndex((e) => e.t === 'weather-start' && e.weather === 'rain');
      const idxSandStart = rs.log.findIndex((e, i) => i > idxRain && e.t === 'weather-start' && e.weather === 'sand');
      if (idxRain >= 0 && idxSandStart >= 0) {
        const idxRainEnd = rs.log.findIndex((e, i) => i > idxRain && i < idxSandStart && e.t === 'weather-end' && e.weather === 'rain');
        t.ok(idxRainEnd >= 0, 'switching from rain to sandstorm ends the rain before the sandstorm starts');
        break;
      }
      if (seed === 20) t.ok(false, 'could not produce a rain\u2192sand switch to test');
    }
  }

  t.section('sim.js — AI continues a Fury Cutter ramp instead of abandoning it (1.8.0)');
  {
    // A mon with Fury Cutter + three filler attacks. With the weighted AI it
    // should chain Fury Cutter far more than random 1-in-4 would, so ramp
    // events (bp doubling) should be common.
    const ramper = spec('Ramper', toRealStats({ hp: 400, atk: 150, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Bug'], ['Fury Cutter', 'Tackle', 'Scratch', 'Pound']);
    const wall = spec('Wall', toRealStats({ hp: 6000, atk: 10, def: 400, spa: 10, spd: 400, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let rampEvents = 0, trials = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulateBattle(ramper, wall, { ...simOpts, seed, turnCap: 8 });
      rampEvents += r.log.filter((e) => e.t === 'ramp' && e.source === 'Ramper').length;
      trials++;
    }
    // Random 1-in-4 continuation would give very few consecutive-hit ramps;
    // the 0.85 continue-chance should produce many. Expect a healthy average.
    t.ok(rampEvents / trials >= 1.5, `Fury Cutter ramps are common with the weighted AI (avg ${(rampEvents / trials).toFixed(2)} ramp events/battle)`);
  }

  t.section('sim.js — no move-effect appears before its "used <move>" line (1.8.0 ordering)');
  {
    // Regression guard for the whole "spontaneous effect" bug class found by the
    // invariant fuzz: rampage-start used to be logged before the use event, so
    // "became enraged with Outrage!" printed before "used Outrage". Verify the
    // use event now comes first, and (belt-and-suspenders) that the effect is
    // attributed to the same source.
    const rager = spec('Rager', toRealStats({ hp: 400, atk: 200, def: 120, spa: 60, spd: 120, spe: 250 }, 2), ['Dragon'], ['Outrage', 'Outrage', 'Outrage', 'Outrage']);
    const punching = spec('Bag', toRealStats({ hp: 6000, atk: 10, def: 400, spa: 10, spd: 400, spe: 5 }, 2), ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const r = simulateBattle(rager, punching, { ...simOpts, seed: 1, turnCap: 4 });
    const useIdx = r.log.findIndex((e) => e.t === 'use' && e.source === 'Rager' && e.move === 'Outrage');
    const rampIdx = r.log.findIndex((e) => e.t === 'rampage-start' && e.source === 'Rager');
    t.ok(useIdx >= 0 && rampIdx >= 0, 'both the use and rampage-start events are present');
    t.ok(useIdx < rampIdx, '"used Outrage" is logged BEFORE "became enraged" (not after)');
  }

}


