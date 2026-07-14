/**
 * @file tools/test/draft.test.mjs
 * @version 1.3.0
 * @changelog
 *   1.3.0 — Hidden Power type selection (draft.js 0.9.4): HP is no longer
 *           stripped from learnsets, and when offered on a card it comes out as
 *           a randomly-typed, Gen-2-legal "Hidden Power (Type)". New section
 *           covers un-stripping, typed/legal format, determinism, per-seed
 *           variety, and that plain "Hidden Power" is never offered.
 *   1.2.0 — Ban-list: removed Mist (now implemented + un-banned); added Heal
 *           Bell and Psych Up.
 *   1.1.0 — Ban-list assertions updated: added Destiny Bond, Sleep Talk, and
 *           Future Sight; removed Snore (now implemented + un-banned).
 * Unit tests for the reworked draft engine (docs/js/draft.js v0.5.0): two picks
 * per card sourced from the CORRECT card, type-drafted-twice → mono, "—" picks,
 * completion with no mis-sourced picks, daily determinism, weighted move reroll,
 * and autoDraft. Run via `node tools/test/run.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DraftSession, autoDraft, autoDraftScaled, resolveThroneCascade, TIER_RANK, isTierUnlocked, nextProgressRank, buildSpeciesList, buildLearnsetMap } from '../../docs/js/draft.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const gen2 = load('../../docs/data/gen2.json');
const movelist = load('../../docs/data/movelist-gen2.json');
const movestats = load('../../docs/data/movestats-gen2.json');
const draftpool = load('../../docs/data/draftpool-gen2.json');

const learnset = buildLearnsetMap({ ...movelist, ...draftpool }, movestats);
const species = buildSpeciesList(gen2, learnset, 2);

const mul = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };

export default function (t) {
  t.section('draft.js — banned moves (#6j) never appear in any learnset');
  {
    const banned = ['Attract', 'Self-Destruct', 'Explosion', 'Baton Pass', 'Mirror Move', 'Skull Bash',
      'Rage', 'Teleport', 'Perish Song', 'Conversion', 'Disable', 'Encore', 'False Swipe', 'Foresight',
      'Mean Look', 'Metronome', 'Mimic', 'Mind Reader', 'Roar', 'Whirlwind', 'Sketch',
      'Sky Attack', 'Spite', 'Spikes', 'Spider Web', 'Sweet Scent', 'Thief', 'Transform',
      'Destiny Bond', 'Sleep Talk', 'Future Sight', 'Heal Bell', 'Psych Up'];
    let leaked = [];
    for (const [sp, moves] of Object.entries(learnset)) {
      for (const b of banned) if (moves.includes(b)) leaked.push(`${b} on ${sp}`);
    }
    t.eq(leaked.length, 0, `no banned move appears in any learnset (found: ${leaked.slice(0, 5).join(', ')})`);
    t.ok((learnset['pikachu'] || []).length > 0, 'Pikachu still has a real movepool (banning didn\u2019t wipe everything)');
    t.ok((learnset['pikachu'] || []).includes('Thunderbolt'), 'an ordinary, non-banned move is still present');
  }

  t.section('draft.js — species list');
  t.ok(species.length > 200, `built ${species.length} draftable species`);

  t.section('draft.js — two picks read the SAME (current) card');
  {
    const s = new DraftSession({ species, gen: 2, seed: 42, rerolls: { pokemon: 0, moves: 0 } });
    const card0 = s.current;
    const hp0 = card0.baseStats.hp, atk0 = card0.baseStats.atk;
    s.pickStat('hp');
    t.ok(s.current === card0, 'card does not advance on first pick');
    s.pickStat('atk');
    t.ok(s.current === card0, 'card does not advance on second pick');
    s.commitCard([]);
    t.eq(s.stats.hp, hp0, 'hp value came from card0');
    t.eq(s.stats.atk, atk0, 'atk value came from card0 (the bug fix)');
    t.eq(s.position, 1, 'deck advanced exactly once after commit');
  }

  t.section('draft.js — commitCard([picks]) path (controller route)');
  {
    const s = new DraftSession({ species, gen: 2, seed: 7, rerolls: { pokemon: 0, moves: 0 } });
    const c = s.current;
    s.commitCard([{ type: 'stat', key: 'hp' }, { type: 'stat', key: 'spe' }]);
    t.eq(s.stats.hp, c.baseStats.hp, 'commitCard hp from same card');
    t.eq(s.stats.spe, c.baseStats.spe, 'commitCard spe from same card');
  }

  t.section('draft.js — a type drafted twice → mono');
  {
    const s = new DraftSession({ species, gen: 2, seed: 123, rerolls: { pokemon: 0, moves: 0 } });
    let firstType = null, drafted = 0, guard = 0;
    while (drafted < 2 && guard++ < 400) {
      const av = s.availablePicks();
      if (s.typeSlotsOpen() > 0 && av.types.length) {
        const want = firstType && av.types.includes(firstType) ? firstType : av.types[0];
        if (!firstType) firstType = want;
        if (want === firstType) { s.commitCard([{ type: 'type', value: want }]); drafted++; continue; }
      }
      s.commitCard([]);
    }
    t.eq(drafted, 2, `drafted ${firstType} twice`);
    t.eq(s.types.length, 1, 'resolves to a single real type');
    t.eq(s.types[0], firstType, `mono ${firstType}`);
    t.eq(s.typeDisplay()[1], '\u2014', 'display shows X / —');
    t.eq(s.typeSlotsOpen(), 0, 'both type slots consumed');
  }

  t.section('draft.js — "—" on a mono card → mono (≥1 real type)');
  {
    const s = new DraftSession({ species, gen: 2, seed: 99, rerolls: { pokemon: 0, moves: 0 } });
    let done = false, guard = 0;
    while (!done && guard++ < 400) {
      if (s.cardIsMono() && s.typeSlotsOpen() >= 2) {
        const realT = s.current.types.filter(Boolean)[0];
        s.pickType(realT); s.pickNoType(); s.commitCard([]);
        t.eq(s.types.length, 1, `mono ${realT} from type + —`);
        t.ok(!s.canPickNoType() || s.typeSlotsOpen() === 0, 'cannot take a second —');
        done = true;
      } else s.commitCard([]);
    }
    t.ok(done, 'found a mono card to exercise the — pick');
  }

  t.section('draft.js — completion, ~6 cards, zero mis-sourced picks');
  {
    let completed = 0, mis = 0, cardsTotal = 0, minC = 99, maxC = 0;
    const RUNS = 300;
    for (let i = 0; i < RUNS; i++) {
      const seed = (Math.random() * 2 ** 31) | 0;
      const s = new DraftSession({ species, gen: 2, seed, rerolls: { pokemon: 0, moves: 0 } });
      const rng = mul(seed ^ 0x55);
      let cards = 0, guard = 0;
      while (!s.isComplete() && guard++ < 100) {
        if (s.skipIfStuck()) { cards++; continue; }
        const av = s.availablePicks();
        const bag = [];
        for (const st of av.stats) bag.push({ type: 'stat', key: st.stat });
        for (const ty of av.types) bag.push({ type: 'type', value: ty });
        for (const m of av.moves) bag.push({ type: 'move', value: m });
        if (av.canPickNoType) bag.push({ type: 'none' });
        const slots = s.openStatSlots().length + s.typeSlotsOpen() + s.moveSlotsOpen();
        const need = Math.min(2, slots, bag.length);
        const cardStats = { ...s.current.baseStats };
        const pool = bag.slice(), chosen = [];
        for (let k = 0; k < need; k++) { const idx = Math.floor(rng() * pool.length); chosen.push(pool[idx]); pool.splice(idx, 1); }
        const expect = {};
        for (const p of chosen) if (p.type === 'stat') expect[p.key] = cardStats[p.key];
        s.commitCard(chosen);
        for (const k in expect) if (s.stats[k] !== expect[k]) mis++;
        cards++;
      }
      if (s.isComplete()) {
        completed++; cardsTotal += cards; minC = Math.min(minC, cards); maxC = Math.max(maxC, cards);
        const r = s.result();
        t.ok(Object.keys(r.baseStats).length === 6, 'result has 6 base stats') && 0;
        if (Object.keys(r.baseStats).length !== 6) break;
        if (r.moves.length !== 4) { t.ok(false, 'result has 4 moves'); break; }
        if (!r.types.filter(Boolean).length) { t.ok(false, 'result has ≥1 real type'); break; }
      }
    }
    t.eq(completed, RUNS, `completed ${completed}/${RUNS}`);
    t.eq(mis, 0, `zero mis-sourced stat picks across all runs`);
    t.note(`cards/draft: min ${minC}, max ${maxC}, avg ${(cardsTotal / completed).toFixed(2)}`);
  }

  t.section('draft.js — daily determinism');
  {
    const seed = 20260625;
    const run = () => {
      const s = new DraftSession({ species, gen: 2, seed, rerolls: { pokemon: 1, moves: 1 } });
      const seq = [];
      while (!s.isComplete()) {
        const av = s.availablePicks();
        const bag = [];
        for (const st of av.stats) bag.push({ type: 'stat', key: st.stat });
        for (const ty of av.types) bag.push({ type: 'type', value: ty });
        for (const m of av.moves) bag.push({ type: 'move', value: m });
        if (av.canPickNoType) bag.push({ type: 'none' });
        const slots = s.openStatSlots().length + s.typeSlotsOpen() + s.moveSlotsOpen();
        const need = Math.min(2, slots, bag.length);
        seq.push(s.current.name);
        s.commitCard(bag.slice(0, need));
      }
      return { seq, res: s.result() };
    };
    const a = run(), b = run();
    t.eq(JSON.stringify(a.seq), JSON.stringify(b.seq), 'same daily seed → same card sequence');
    t.eq(JSON.stringify(a.res), JSON.stringify(b.res), 'same seed + picks → identical result');
  }

  t.section('draft.js — move reroll: distinct, prefers new (with replacement)');
  {
    const s = new DraftSession({ species, gen: 2, seed: 555, rerolls: { pokemon: 5, moves: 10 } });
    let guard = 0;
    while ((s.current.learnset || []).length < 30 && guard++ < 300) s.commitCard([]);
    const pool = s.current.learnset.length;
    const r0 = new Set(s.moveChoices);
    s.rerollMoves();
    const r1 = s.moveChoices;
    t.eq(new Set(r1).size, r1.length, 'reroll shows distinct moves within a draw');
    const overlap = r1.filter((m) => r0.has(m)).length;
    t.ok(overlap < r1.length, `reroll favors new moves (overlap ${overlap}/${r1.length}, pool ${pool})`);
  }

  t.section('draft.js — autoDraft');
  {
    const r = autoDraft({ species, gen: 2, seed: 2024, playerName: 'CPU' });
    t.ok(Object.keys(r.baseStats).length === 6 && r.moves.length === 4 && r.types.filter(Boolean).length >= 1, 'valid mon');
    const r2 = autoDraft({ species, gen: 2, seed: 2024, playerName: 'CPU' });
    t.eq(JSON.stringify(r), JSON.stringify(r2), 'autoDraft deterministic for a seed');
  }

  t.section('draft.js — autoDraftScaled (#7): every Elite-4 tier\u2019s base-stat total lands in its target band');
  {
    const bands = { Will: [425, 450], Koga: [475, 500], Bruno: [525, 550], Lance: [575, 600] };
    for (const [name, [lo, hi]] of Object.entries(bands)) {
      for (const seed of [111, 222, 333]) {
        const r = autoDraftScaled({ species, gen: 2, seed: seed * 7919, playerName: name, minTotal: lo, maxTotal: hi });
        const total = Object.values(r.baseStats).reduce((a, b) => a + b, 0);
        t.ok(total >= lo && total <= hi, `${name} (seed ${seed}): base-stat total ${total} is within [${lo}, ${hi}]`);
      }
    }
  }

  t.section('draft.js — autoDraftScaled is deterministic and still a fully valid mon');
  {
    const r1 = autoDraftScaled({ species, gen: 2, seed: 5555, playerName: 'Lance', minTotal: 575, maxTotal: 600 });
    const r2 = autoDraftScaled({ species, gen: 2, seed: 5555, playerName: 'Lance', minTotal: 575, maxTotal: 600 });
    t.eq(JSON.stringify(r1), JSON.stringify(r2), 'same seed \u2192 identical scaled result');
    t.ok(Object.keys(r1.baseStats).length === 6 && r1.moves.length === 4 && r1.types.filter(Boolean).length >= 1, 'a scaled mon is still fully valid (6 stats, 4 moves, \u22651 type)');
  }

  t.section('draft.js — autoDraftScaled falls back gracefully (closest fit) if a band is unreachable within maxAttempts');
  {
    // An impossible band (above any real stat combination) must not throw or hang.
    const r = autoDraftScaled({ species, gen: 2, seed: 1, playerName: 'Impossible', minTotal: 999999, maxTotal: 999999, maxAttempts: 20 });
    t.ok(!!r && Object.keys(r.baseStats).length === 6, 'returns the closest-fit mon instead of throwing or hanging');
  }

  t.section('draft.js — resolveThroneCascade (#14a): claiming a HIGHER throne while already holding a lower one');
  {
    const fakeMon = { name: 'X', types: ['Water'], baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, stats: {} };
    // Player holds Koga (week); wins Bruno (month, higher) by beating a HUMAN holder.
    const d1 = resolveThroneCascade({ newTierKey: 'month', oldTierKey: 'week', tierRank: TIER_RANK, defeatedUid: 'uidHuman', defeatedMon: fakeMon, champLabel: 'Rival' });
    t.eq(d1.action, 'claimNewVacateOld', 'claiming a higher throne vacates the old (lower) one');
    t.eq(d1.vacatedTier, 'week', 'the VACATED tier is the one they used to hold (lower), not the one they just won');
    t.ok(!!d1.bump, 'defeating a HUMAN holder produces a bump-down record');
    t.eq(d1.bump.holderUid, 'uidHuman', 'the bumped-down record is for the defeated HUMAN, not the winner');
    t.eq(d1.bump.holderName, 'Rival', 'the bumped-down record keeps the defeated player\u2019s name');

    // Same scenario, but the defeated holder was an NPC (no uid/mon-of-note) — no bump, just vacate.
    const d2 = resolveThroneCascade({ newTierKey: 'month', oldTierKey: 'week', tierRank: TIER_RANK, defeatedUid: null, defeatedMon: null, champLabel: 'Bruno' });
    t.eq(d2.action, 'claimNewVacateOld', 'still claims the higher throne and vacates the old one');
    t.eq(d2.bump, null, 'defeating an NPC produces NO bump — the vacated throne just goes back to a fresh NPC');
  }

  t.section('draft.js — resolveThroneCascade (#14a): winning a LOWER throne while already holding a higher one keeps the higher one');
  {
    const d = resolveThroneCascade({ newTierKey: 'day', oldTierKey: 'year', tierRank: TIER_RANK, defeatedUid: 'uidSomeone', defeatedMon: { name: 'Y' }, champLabel: 'Someone' });
    t.eq(d.action, 'keepOld', 'the player keeps their existing HIGHER throne rather than switching to the lower one just won');
    t.eq(d.keptTier, 'year', 'keptTier correctly identifies the throne they keep (the higher, pre-existing one)');
  }

  t.section('draft.js — resolveThroneCascade (#14a): the All-Time Champion spot ranks above every numbered stage');
  {
    const d = resolveThroneCascade({ newTierKey: 'all', oldTierKey: 'year', tierRank: TIER_RANK, defeatedUid: null, defeatedMon: null, champLabel: null });
    t.eq(d.action, 'claimNewVacateOld', 'winning All-Time while holding Lance (year) claims All-Time and vacates Lance \u2014 All-Time outranks every numbered stage');
    t.eq(d.vacatedTier, 'year', 'Lance (year) is correctly identified as the vacated (lower) tier');
  }

  t.section('draft.js — nextProgressRank (#12/#13): monotonic, never decreases');
  {
    t.eq(nextProgressRank(0, 'day', TIER_RANK), 1, 'first-ever claim (Will/day) sets rank to 1');
    t.eq(nextProgressRank(1, 'week', TIER_RANK), 2, 'claiming the next tier up advances rank');
    t.eq(nextProgressRank(3, 'day', TIER_RANK), 3, 're-claiming a LOWER tier than already reached does not lower rank');
    t.eq(nextProgressRank(5, 'day', TIER_RANK), 5, 'already at the max (All-Time) — re-claiming Will keeps rank at 5');
    t.eq(nextProgressRank(undefined, 'day', TIER_RANK), 1, 'undefined/missing current rank treated as 0');
  }

  t.section('draft.js — isTierUnlocked (#12/#13): gated on progress rank, NOT on who currently holds the previous throne');
  {
    const KEYS = ['day', 'week', 'month', 'year', 'all'];
    // Will (index 0) is always unlocked, regardless of progress.
    t.ok(isTierUnlocked(0, 0, KEYS, TIER_RANK), 'Will (index 0) is unlocked even at rank 0');
    // A brand-new player: nothing past Will is unlocked yet.
    t.ok(!isTierUnlocked(1, 0, KEYS, TIER_RANK), 'Koga locked at rank 0');
    t.ok(!isTierUnlocked(4, 0, KEYS, TIER_RANK), 'All-Time locked at rank 0');
    // Exactly reached Will (rank 1) → Koga (needs rank>=1) unlocks, Bruno doesn't yet.
    t.ok(isTierUnlocked(1, 1, KEYS, TIER_RANK), 'Koga unlocked once Will (rank 1) is reached');
    t.ok(!isTierUnlocked(2, 1, KEYS, TIER_RANK), 'Bruno still locked at rank 1');
    // THE actual bug being fixed: a player who has reached All-Time (rank 5)
    // must see every tier as unlocked even though the #14a cascade (or a
    // cadence reset) has vacated every lower throne they no longer physically
    // hold — this is exactly the scenario the OLD "conquered(previous throne's
    // CURRENT holder)" check got wrong.
    for (let i = 0; i <= 4; i++) t.ok(isTierUnlocked(i, 5, KEYS, TIER_RANK), `tier index ${i} stays unlocked at max progress (rank 5), independent of who currently holds any throne`);
    // A mid-ladder player (reached Bruno, rank 3) sees exactly the right frontier.
    t.ok(isTierUnlocked(3, 3, KEYS, TIER_RANK), 'Lance unlocked at rank 3 (just beat Bruno)');
    t.ok(!isTierUnlocked(4, 3, KEYS, TIER_RANK), 'All-Time still locked at rank 3');
  }

  t.section('draft.js — #2 (requested): no Pokemon can appear more than once in a single draft');
  {
    // Drive a full draft programmatically (not through the UI), recording
    // every card's species name as it's shown, and confirm none repeat.
    // "Shown" includes cards seen via a Pokemon-reroll too, not just cards a
    // pick was actually taken from.
    function draftAndCollectSeenSpecies(seed, useRerolls) {
      const s = new DraftSession({ species, gen: 2, seed });
      const seen = [s.current.name];
      let guard = 0;
      while (!s.isComplete() && guard++ < 200) {
        if (useRerolls && guard % 3 === 0 && s.rerolls.pokemon > 0) {
          s.rerollPokemon();
          seen.push(s.current.name);
          continue;
        }
        const p = s.availablePicks();
        const picks = [];
        if (p.stats.length) picks.push({ type: 'stat', key: p.stats[0].stat });
        if (picks.length < 2 && p.types.length) picks.push({ type: 'type', value: p.types[0] });
        else if (picks.length < 2 && p.canPickNoType) picks.push({ type: 'none' });
        if (picks.length < 2 && p.moves.length) picks.push({ type: 'move', value: p.moves[0] });
        if (!picks.length) { if (!s.hasLegalPick()) { s.advance(); seen.push(s.current.name); continue; } break; }
        s.commitCard(picks);
        seen.push(s.current.name);
      }
      return seen;
    }

    for (let seed = 1; seed <= 150; seed++) {
      const seen = draftAndCollectSeenSpecies(seed, false);
      const unique = new Set(seen);
      t.eq(unique.size, seen.length, `seed ${seed}: no species repeats across ${seen.length} cards shown (saw: ${seen.join(', ')})`);
    }

    // Also with Pokemon-rerolls actually used mid-draft — a rerolled-PAST
    // card must never be allowed to reappear later either.
    for (let seed = 500; seed <= 560; seed++) {
      const seen = draftAndCollectSeenSpecies(seed, true);
      const unique = new Set(seen);
      t.eq(unique.size, seen.length, `seed ${seed} (with rerolls exercised): no species repeats across ${seen.length} cards shown`);
    }

    // A direct check on _speciesAt / _refresh's bookkeeping: force the SAME
    // (position, pokeReroll) to have picked the same species twice would be
    // impossible to observe this way, so instead confirm the exclusion set
    // actually grows and is genuinely consulted — construct a session and
    // walk it forward a fixed number of steps, checking the seen-species
    // count matches the number of distinct cards shown exactly (a Set, not
    // an array that could quietly contain duplicates some other way).
    const probe = new DraftSession({ species, gen: 2, seed: 999 });
    const seenNames = [probe.current.name];
    for (let i = 0; i < 8 && !probe.isComplete(); i++) {
      probe.commitCard([{ type: 'stat', key: probe.openStatSlots()[0] }]);
      seenNames.push(probe.current.name);
    }
    t.eq(new Set(seenNames).size, seenNames.length, 'a manually-stepped session (stat-only picks, one per card) also shows no repeats');
  }

  t.section('draft.js — Hidden Power comes up randomly typed (0.9.4)');
  {
    const HP_LEGAL = new Set(['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
      'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark']);

    // (1) buildLearnsetMap no longer strips Hidden Power — it's kept as the
    // plain name in the pool (it used to be filtered out entirely).
    const keptPlainHP = Object.values(learnset).filter((mv) => mv.some((m) => /^hidden power$/i.test(m))).length;
    t.ok(keptPlainHP > 100, `Hidden Power is kept in learnsets, not stripped (${keptPlainHP} species retain the plain name)`);

    // (2) When actually offered on a draft card it is transformed into a
    // randomly-typed, Gen-2-legal "Hidden Power (Type)". A synthetic single-
    // species pool with a tiny learnset guarantees HP is always in the view.
    const hpMon = {
      name: 'HPTestMon', num: 9999, spriteId: 0, types: ['Normal'],
      baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
      learnset: ['Hidden Power', 'Tackle', 'Growl'],
    };
    const offeredHP = (seed) => new DraftSession({ species: [hpMon], gen: 2, seed })
      .availablePicks().moves.find((m) => /hidden power/i.test(m));

    const sample = offeredHP(1);
    const m = /^Hidden Power \((\w+)\)$/.exec(sample || '');
    t.ok(!!m, `offered HP is typed, format "Hidden Power (Type)" (got: ${sample})`);
    t.ok(m && HP_LEGAL.has(m[1]), `assigned type is Gen-2-legal / never Normal (got: ${m && m[1]})`);

    // Plain, untyped "Hidden Power" must never be what's offered.
    let sawPlain = false, types = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const off = offeredHP(seed);
      if (/^hidden power$/i.test(off || '')) sawPlain = true;
      const mm = /^Hidden Power \((\w+)\)$/.exec(off || '');
      if (mm) types.add(mm[1]);
    }
    t.ok(!sawPlain, 'plain untyped "Hidden Power" is never the offered move — it is always typed');
    t.ok(types.size >= 3, `the type genuinely varies per occurrence (saw ${types.size} distinct types across 40 seeds)`);
    t.ok([...types].every((ty) => HP_LEGAL.has(ty)), 'every assigned type across seeds is Gen-2-legal');

    // (3) Deterministic: the same seed reproduces the same typed HP (so a
    // replayed draft is identical).
    t.eq(offeredHP(42), offeredHP(42), 'same seed → identical typed Hidden Power (draft stays replayable)');
  }
}
