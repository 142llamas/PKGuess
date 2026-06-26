/**
 * @file tools/test/draft.test.mjs
 * @version 1.0.0
 * Unit tests for the reworked draft engine (docs/js/draft.js v0.5.0): two picks
 * per card sourced from the CORRECT card, type-drafted-twice → mono, "—" picks,
 * completion with no mis-sourced picks, daily determinism, weighted move reroll,
 * and autoDraft. Run via `node tools/test/run.mjs`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DraftSession, autoDraft, buildSpeciesList, buildLearnsetMap } from '../../docs/js/draft.js';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const gen2 = load('../../docs/data/gen2.json');
const movelist = load('../../docs/data/movelist-gen2.json');
const movestats = load('../../docs/data/movestats-gen2.json');
const draftpool = load('../../docs/data/draftpool-gen2.json');

const learnset = buildLearnsetMap({ ...movelist, ...draftpool }, movestats);
const species = buildSpeciesList(gen2, learnset, 2);

const mul = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };

export default function (t) {
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
}
