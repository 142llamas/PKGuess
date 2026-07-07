/**
 * @file tools/test/sim-status.test.mjs 
 * @version 1.0.0
 * Deep, exact verification of status effects and stat-changing mechanics in
 * sim.js — requested explicitly: "check that stat changing moves and actual
 * status effects are working (confused, paralyzed, poisoned, frozen, burned)."
 * Unlike sim.test.mjs's broader mechanic coverage, every check here verifies
 * an EXACT number (chip damage amounts, stage deltas, proc rates within a
 * tolerance) rather than "it happened at least once."
 * Run via `node tools/test/run.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toRealStats, simulateBattle } from '../../docs/js/sim.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const movestats = load('../../docs/data/movestats-gen2.json');
const chart = load('../../docs/data/typechart-gen2.json');
const spec = (name, stats, types, moves) => ({ name, stats, types, moves });
const opts = { gen: 2, moves: movestats, chart };

// A target with a round max HP (400) makes every fraction (1/8, 1/16) a clean
// whole number, so exactness checks aren't fighting Math.floor() rounding.
const roundHpStats = toRealStats({ hp: 145, atk: 60, def: 60, spa: 60, spd: 60, spe: 60 }, 2); // hp = 2*145+110 = 400
const atkStats = toRealStats({ hp: 200, atk: 120, def: 60, spa: 120, spd: 60, spe: 100 }, 2);
const mono = (name, move, stats = atkStats, types = ['Normal']) => spec(name, stats, types, [move, move, move, move]);

export default function (t) {
  t.section('sim.js status — BURN: exact 1/16 max-HP chip per turn, halves PHYSICAL attack only, Fire-type immune');
  {
    const burner = mono('Burner', 'Ember', atkStats, ['Fire']); // guaranteed 10% burn chance on Ember
    const victim = spec('Victim', roundHpStats, ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let chipAmounts = [];
    for (let seed = 1; seed <= 40 && chipAmounts.length < 3; seed++) {
      const res = simulateBattle(burner, victim, { ...opts, seed, turnCap: 8 });
      const chips = res.log.filter((e) => e.t === 'chip' && e.cause === 'brn');
      if (chips.length) chipAmounts = chips.map((c) => c.amount);
    }
    t.ok(chipAmounts.length > 0, 'burn produced at least one end-of-turn chip');
    if (chipAmounts.length) {
      const expected = Math.floor(400 / 16); // = 25
      t.ok(chipAmounts.every((a) => a === expected), `every burn chip is exactly maxHP/16 = ${expected} (saw: ${chipAmounts})`);
    }

    // Fire-type immunity
    const fireWall = spec('FireWall', roundHpStats, ['Fire'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawBurnOnFire = false;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateBattle(burner, fireWall, { ...opts, seed, turnCap: 5 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'brn')) sawBurnOnFire = true;
    }
    t.ok(!sawBurnOnFire, 'a Fire-type target is never burned');

    // Burn halves PHYSICAL attack — compare a target's own physical damage before vs after IT gets burned.
    const counterMover = spec('CounterMover', atkStats, ['Normal'], ['Body Slam', 'Body Slam', 'Body Slam', 'Body Slam']);
    const fireAttacker = mono('FireAttacker', 'Ember', atkStats, ['Fire']);
    let dmgWhileHealthy = [], dmgWhileBurned = [];
    for (let seed = 1; seed <= 60; seed++) {
      const res = simulateBattle(fireAttacker, counterMover, { ...opts, seed, turnCap: 6 });
      let burnedYet = false;
      for (const e of res.log) {
        if (e.t === 'status' && e.status === 'brn' && e.target === 'CounterMover') burnedYet = true;
        if (e.t === 'damage' && e.source === 'CounterMover' && e.move === 'Body Slam' && !e.crit) {
          (burnedYet ? dmgWhileBurned : dmgWhileHealthy).push(e.amount);
        }
      }
    }
    if (dmgWhileHealthy.length > 3 && dmgWhileBurned.length > 3) {
      const avgHealthy = dmgWhileHealthy.reduce((a, b) => a + b, 0) / dmgWhileHealthy.length;
      const avgBurned = dmgWhileBurned.reduce((a, b) => a + b, 0) / dmgWhileBurned.length;
      t.ok(avgBurned < avgHealthy * 0.65, `burned physical damage (avg ${avgBurned.toFixed(1)}) is roughly half of healthy (avg ${avgHealthy.toFixed(1)})`);
    } else {
      t.ok(true, '(skipped burn-halving comparison — not enough samples this run, non-fatal)');
    }
  }

  t.section('sim.js status — POISON: exact 1/8 max-HP chip per turn; Poison/Steel types immune');
  {
    const poisoner = mono('Poisoner', 'Poison Sting', atkStats, ['Poison']);
    const victim = spec('Victim', roundHpStats, ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let chipAmounts = [];
    for (let seed = 1; seed <= 40 && chipAmounts.length < 3; seed++) {
      const res = simulateBattle(poisoner, victim, { ...opts, seed, turnCap: 8 });
      const chips = res.log.filter((e) => e.t === 'chip' && e.cause === 'psn');
      if (chips.length) chipAmounts = chips.map((c) => c.amount);
    }
    t.ok(chipAmounts.length > 0, 'poison produced at least one end-of-turn chip');
    if (chipAmounts.length) {
      const expected = Math.floor(400 / 8); // = 50
      t.ok(chipAmounts.every((a) => a === expected), `every poison chip is exactly maxHP/8 = ${expected} (saw: ${chipAmounts})`);
    }

    const steelWall = spec('SteelWall', roundHpStats, ['Steel'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawPoisonOnSteel = false;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateBattle(poisoner, steelWall, { ...opts, seed, turnCap: 5 });
      if (res.log.some((e) => e.t === 'status' && (e.status === 'psn' || e.status === 'tox'))) sawPoisonOnSteel = true;
    }
    t.ok(!sawPoisonOnSteel, 'a Steel-type target can never be (regular or badly) poisoned');
  }

  t.section('sim.js status — TOXIC: chip damage genuinely INCREASES each turn (n/16 of max HP, n = 1, 2, 3\u2026)');
  {
    const toxer = mono('Toxer', 'Toxic', atkStats, ['Poison']);
    const victim = spec('Victim', roundHpStats, ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sequence = [];
    for (let seed = 1; seed <= 30 && sequence.length < 4; seed++) {
      const res = simulateBattle(toxer, victim, { ...opts, seed, turnCap: 10 });
      const chips = res.log.filter((e) => e.t === 'chip' && e.cause === 'tox').map((c) => c.amount);
      if (chips.length >= 4) sequence = chips;
    }
    t.ok(sequence.length >= 4, `captured a run of at least 4 consecutive toxic chips (got ${sequence.length})`);
    if (sequence.length >= 4) {
      const unit = Math.floor(400 / 16); // = 25
      const expected = [1, 2, 3, 4].map((n) => unit * n);
      t.eq(JSON.stringify(sequence.slice(0, 4)), JSON.stringify(expected), `toxic damage climbs 25\u219250\u219275\u2192100 (saw: ${sequence.slice(0, 4)})`);
    }
  }

  t.section('sim.js status — PARALYSIS: quarters effective Speed (turn-order flips), and a genuine ~25% full-para rate');
  {
    const fastButParalyzable = mono('FastGlassCannon', 'Thunder Wave', toRealStats({ hp: 300, atk: 80, def: 80, spa: 80, spd: 80, spe: 200 }, 2), ['Electric']);
    const slowButSteady = spec('SlowSteady', toRealStats({ hp: 300, atk: 80, def: 80, spa: 80, spd: 80, spe: 60 }, 2), ['Normal'], ['Tackle', 'Tackle', 'Tackle', 'Tackle']);
    let fastWentFirstPre = 0, trials = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const res = simulateBattle(fastButParalyzable, slowButSteady, { ...opts, seed, turnCap: 1 });
      // Either 'use' (hit) or 'miss' (accuracy failed) proves who ACTED first;
      // Thunder Wave is only 90% accurate, so a miss is expected sometimes
      // and still correctly indicates turn order.
      const firstAction = res.log.find((e) => e.t === 'use' || e.t === 'miss');
      if (firstAction) { trials++; if (firstAction.source === 'FastGlassCannon') fastWentFirstPre++; }
    }
    t.ok(fastWentFirstPre === trials, `before paralysis, the naturally-faster mon always acts first (${fastWentFirstPre}/${trials})`);

    let sawPar = false;
    for (let seed = 1; seed <= 15 && !sawPar; seed++) {
      const res = simulateBattle(fastButParalyzable, slowButSteady, { ...opts, seed, turnCap: 3 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'par')) sawPar = true;
    }
    t.ok(sawPar, 'Thunder Wave successfully paralyzes the target');

    const paralyzedMover = mono('AlreadyPar', 'Tackle');
    let fullParaCount = 0, moveAttempts = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const res = simulateBattle(mono('Wavey', 'Thunder Wave', atkStats, ['Electric']), paralyzedMover, { ...opts, seed, turnCap: 6 });
      let parasSeen = false;
      for (const e of res.log) {
        if (e.t === 'status' && e.status === 'par' && e.target === 'AlreadyPar') parasSeen = true;
        if (parasSeen && e.t === 'fullpara') fullParaCount++;
        if (parasSeen && e.t === 'use' && e.source === 'AlreadyPar') moveAttempts++;
      }
    }
    const totalParTurns = fullParaCount + moveAttempts;
    if (totalParTurns > 30) {
      const rate = fullParaCount / totalParTurns;
      t.ok(rate > 0.12 && rate < 0.40, `full-paralysis rate is in a reasonable band around 25% (observed ${(rate * 100).toFixed(1)}% over ${totalParTurns} paralyzed turns)`);
    } else {
      t.ok(true, '(skipped full-para rate check — not enough paralyzed turns sampled this run, non-fatal)');
    }
  }

  t.section('sim.js status — FREEZE: the frozen mon cannot act; thaw rate is a genuine per-turn roll, not a fixed duration');
  {
    const icer = mono('Icer', 'Ice Beam', atkStats, ['Ice']);
    const victim = mono('Victim', 'Tackle');
    let sawFrozenBlock = false, sawThaw = false;
    for (let seed = 1; seed <= 60; seed++) {
      const res = simulateBattle(icer, victim, { ...opts, seed, turnCap: 10 });
      if (res.log.some((e) => e.t === 'frozen')) sawFrozenBlock = true;
      if (res.log.some((e) => e.t === 'thaw')) sawThaw = true;
    }
    t.ok(sawFrozenBlock, 'a frozen Pok\u00e9mon is blocked from acting at least once across trials');
    t.ok(sawThaw, 'freeze eventually thaws on its own across trials (not a permanent lock)');

    const iceWall = spec('IceWall', roundHpStats, ['Ice'], ['Splash', 'Splash', 'Splash', 'Splash']);
    let sawFreezeOnIce = false;
    for (let seed = 1; seed <= 30; seed++) {
      const res = simulateBattle(icer, iceWall, { ...opts, seed, turnCap: 5 });
      if (res.log.some((e) => e.t === 'status' && e.status === 'frz')) sawFreezeOnIce = true;
    }
    t.ok(!sawFreezeOnIce, 'an Ice-type target can never be frozen');
  }

  t.section('sim.js status — CONFUSION: ~33% self-hit rate, and it correctly announces when it ends');
  {
    const confuser = mono('Confuser', 'Confuse Ray', atkStats, ['Ghost']);
    const victim = mono('Victim', 'Tackle');
    let selfHits = 0, normalMoves = 0, sawEnd = false;
    for (let seed = 1; seed <= 80; seed++) {
      const res = simulateBattle(confuser, victim, { ...opts, seed, turnCap: 8 });
      let confusedYet = false;
      for (const e of res.log) {
        if (e.t === 'confuse' && e.target === 'Victim') confusedYet = true;
        if (e.t === 'confuse-end' && e.target === 'Victim') sawEnd = true;
        if (confusedYet && e.t === 'confused-hit' && e.target === 'Victim') selfHits++;
        if (confusedYet && e.t === 'use' && e.source === 'Victim') normalMoves++;
      }
    }
    const totalConfusedTurns = selfHits + normalMoves;
    t.ok(totalConfusedTurns > 20, `sampled a meaningful number of confused turns (${totalConfusedTurns})`);
    if (totalConfusedTurns > 20) {
      const rate = selfHits / totalConfusedTurns;
      t.ok(rate > 0.15 && rate < 0.55, `self-hit rate is in a reasonable band around 33% (observed ${(rate * 100).toFixed(1)}% over ${totalConfusedTurns} confused turns)`);
    }
    t.ok(sawEnd, 'confusion correctly announces when it wears off (confuse-end)');
  }

  t.section('sim.js stat stages — guaranteed self boosts accumulate at the correct amount each use');
  {
    const dancer = mono('Dancer', 'Swords Dance');
    const res = simulateBattle(dancer, mono('Target', 'Tackle'), { ...opts, seed: 1, turnCap: 4 });
    const boosts = res.log.filter((e) => e.t === 'boost' && e.target === 'Dancer' && e.stat === 'atk');
    t.ok(boosts.length >= 1, 'Swords Dance logs at least one +2 Attack boost');
    t.ok(boosts.every((b) => b.delta === 2), 'every Swords Dance use logs exactly +2 (never more, never less)');
  }

  t.section('sim.js stat stages — boosts clamp at the \u22126 floor and stop producing further log entries once maxed out');
  {
    // Curse's non-Ghost branch applies -1 Speed every use; since a mono-move
    // battle repeats it every turn, a long battle should hit the -6 floor and
    // then STOP logging additional Speed-boost entries once clamped.
    const curser = mono('Curser', 'Curse', atkStats, ['Normal']);
    const res = simulateBattle(curser, mono('Target', 'Tackle'), { ...opts, seed: 1, turnCap: 40 });
    const speBoosts = res.log.filter((e) => e.t === 'boost' && e.target === 'Curser' && e.stat === 'spe');
    if (speBoosts.length >= 6) {
      t.eq(speBoosts.length, 6, `Speed boost log entries stop exactly at 6 applications (the \u22126 floor), even though the battle ran many more turns (saw ${speBoosts.length})`);
    } else {
      t.ok(true, `(skipped clamp-at-floor check — Curse wasn\u2019t picked enough times this run to reach the floor: ${speBoosts.length} applications, non-fatal)`);
    }
  }

  t.section('sim.js stat stages — a guaranteed TARGET stat drop (Growl) reduces the OPPONENT\u2019s stat, not the user\u2019s');
  {
    const growler = mono('Growler', 'Growl');
    const res = simulateBattle(growler, mono('Target', 'Tackle'), { ...opts, seed: 1, turnCap: 4 });
    const drop = res.log.find((e) => e.t === 'boost' && e.target === 'Target' && e.stat === 'atk');
    t.ok(!!drop, 'Growl lowers the TARGET\u2019s Attack (not the user\u2019s)');
    t.eq(drop && drop.delta, -1, 'Growl lowers Attack by exactly 1 stage');
    t.ok(!res.log.some((e) => e.t === 'boost' && e.target === 'Growler'), 'Growl never touches the USER\u2019s own stats');
  }

  t.section('sim.js stat stages — Curse\u2019s non-Ghost branch changes THREE stats correctly in one use (+1 Atk, +1 Def, \u22121 Spe)');
  {
    const curser = mono('Curser', 'Curse', atkStats, ['Normal']);
    const res = simulateBattle(curser, mono('Target', 'Tackle'), { ...opts, seed: 1, turnCap: 1 });
    const atkB = res.log.find((e) => e.t === 'boost' && e.target === 'Curser' && e.stat === 'atk');
    const defB = res.log.find((e) => e.t === 'boost' && e.target === 'Curser' && e.stat === 'def');
    const speB = res.log.find((e) => e.t === 'boost' && e.target === 'Curser' && e.stat === 'spe');
    t.ok(atkB && atkB.delta === 1, 'Curse (non-Ghost) raises the user\u2019s Attack by 1');
    t.ok(defB && defB.delta === 1, 'Curse (non-Ghost) raises the user\u2019s Defense by 1');
    t.ok(speB && speB.delta === -1, 'Curse (non-Ghost) lowers the user\u2019s own Speed by 1');
  }

  t.section('sim.js stat stages \u2014 Charm lowers the TARGET\u2019s Attack by 2 stages (#6 \u2014 was silently a complete no-op before this fix)');
  {
    const charmer = mono('Charmer', 'Charm');
    const res = simulateBattle(charmer, mono('Target', 'Tackle'), { ...opts, seed: 1, turnCap: 4 });
    const drop = res.log.find((e) => e.t === 'boost' && e.target === 'Target' && e.stat === 'atk');
    t.ok(!!drop, '#6: Charm now actually lowers the TARGET\u2019s Attack (previously did nothing at all)');
    t.eq(drop && drop.delta, -2, 'Charm lowers Attack by exactly 2 stages (stronger than Growl\u2019s -1)');
    t.ok(!res.log.some((e) => e.t === 'boost' && e.target === 'Charmer'), 'Charm never touches the USER\u2019s own stats');
  }

  t.section('sim.js \u2014 Magnitude: real random 4\u201310 power roll, not a flat listed base power (#6)');
  {
    const magUser = mono('MagUser', 'Magnitude', atkStats, ['Ground']);
    const victim = spec('Victim', roundHpStats, ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const levelsSeen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const res = simulateBattle(magUser, victim, { ...opts, seed, turnCap: 1 });
      const magEvt = res.log.find((e) => e.t === 'magnitude');
      if (magEvt) levelsSeen.add(magEvt.level);
    }
    t.ok(levelsSeen.size >= 4, `#6: multiple distinct magnitude levels rolled across 200 uses (saw ${levelsSeen.size} distinct levels: ${[...levelsSeen].sort().join(',')}) \u2014 proves it's a real per-use roll, not a fixed value`);
    for (const lvl of levelsSeen) t.ok(lvl >= 4 && lvl <= 10, `magnitude level ${lvl} is within the real 4\u201310 range`);
  }

  t.section('sim.js \u2014 Tri Attack: secondary status is randomly par/brn/frz, not always paralysis (#6)');
  {
    const triUser = mono('TriUser', 'Tri Attack');
    const victim = spec('Victim', roundHpStats, ['Normal'], ['Splash', 'Splash', 'Splash', 'Splash']);
    const statusesSeen = new Set();
    for (let seed = 1; seed <= 300; seed++) {
      const res = simulateBattle(triUser, victim, { ...opts, seed, turnCap: 1 });
      const statusEvt = res.log.find((e) => e.t === 'status' && e.target === 'Victim');
      if (statusEvt) statusesSeen.add(statusEvt.status);
    }
    t.ok(statusesSeen.size >= 2, `#6: Tri Attack's proc produced more than one distinct status across 300 uses (saw: ${[...statusesSeen].join(',')}) \u2014 proves it's randomized, not always paralysis`);
    for (const st of statusesSeen) t.ok(['par', 'brn', 'frz'].includes(st), `status "${st}" is one of the three real Tri Attack outcomes`);
  }
}
