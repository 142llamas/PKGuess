/**
 * @file        tools/generate-movestats.mjs
 * @version     1.0.0
 * @updated     2026-06-23 
 * @changelog
 *   1.0.0 — Stage-2 data pass (run AFTER generate-data.mjs). [BOOTSTRAP ONLY —
 *           once the review CSVs have been hand-curated, the curated values are
 *           the source of truth: run tools/apply-movestats.mjs instead. Do NOT
 *           re-run this or it will overwrite curated movestats from PokeAPI.]
 *           Reads the cleaned movelist-gen{N}.json, resolves every move against
 *           move table (PokeAPI CSVs), and emits:
 *             • docs/data/movestats-gen{1,2}.json  (game data: {moveId:{name,
 *               type,bp,acc,prio,cat,...}})
 *             • docs/data/movestats-gen{N}.review.csv  (sorted, for eyeballing)
 *           It also runs the COMPLETENESS GATE: every move in a movelist must
 *           resolve to a real move. Anything that doesn't (e.g. the bled
 *           "Gyarados", stray junk) is REMOVED from movelist-gen{N}.json and
 *           recorded in _data-report.json under `removedNonMoves`. Moves whose
 *           power is variable/fixed in-game (Seismic Toss, Counter, …) are
 *           emitted with bp:0 and FLAGGED in the CSV (`needsBp`) for you to set.
 *           cat is type-based (the Gen 1/2 rule the sim uses), not PokeAPI's
 *           modern per-move split; Status moves get cat:'Status'.
 * ---------------------------------------------------------------------------
 * USAGE (needs network the first time; values are then yours to verify/edit):
 *   node tools/generate-movestats.mjs [--out docs/data] [--cache tools/.cache]
 * Run generate-data.mjs first so the movelists exist.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; }
const OUT = arg('out', join(REPO_ROOT, 'docs', 'data'));
const CACHE = arg('cache', join(__dirname, '.cache'));

// match sim.js moveId() exactly
const moveId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
// match sim.js gen12Category()
const PHYSICAL_TYPES = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const titleName = (id) => id.split('-').map(cap).join(' ');

// Gen-1 had a few moves with different types (and no Dark/Steel at all).
const GEN1_TYPE_OVERRIDE = { bite: 'Normal', gust: 'Normal', 'karate-chop': 'Normal', 'sand-attack': 'Normal' };
const OHKO = new Set(['fissure', 'horndrill', 'guillotine']);
const HIGH_CRIT = new Set(['karatechop', 'razorleaf', 'crabhammer', 'slash', 'aeroblast', 'crosschop']);
// Our move names vs PokeAPI's identifier spellings (normalized, id-side).
const ID_ALIAS = { visegrip: 'vicegrip' };

const PokeAPI = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';

async function getCsv(file) {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, file);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const res = await fetch(`${PokeAPI}/${file}`);
  if (!res.ok) throw new Error(`fetch ${file} failed: ${res.status}`);
  const txt = await res.text();
  writeFileSync(cached, txt);
  return txt;
}
function parseCsv(txt) {
  const [head, ...lines] = txt.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((ln) => {
    const v = ln.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
}

async function buildBaseTable() {
  const types = parseCsv(await getCsv('types.csv'));
  const typeName = Object.fromEntries(types.map((t) => [t.id, cap(t.identifier)]));
  const moves = parseCsv(await getCsv('moves.csv'));
  const table = {}; // identifier -> record
  for (const m of moves) {
    const gen = parseInt(m.generation_id, 10);
    const isStatus = m.damage_class_id === '1';
    const baseType = typeName[m.type_id] || 'Normal';
    const power = m.power === '' ? null : parseInt(m.power, 10);
    const acc = m.accuracy === '' ? true : parseInt(m.accuracy, 10); // blank = never-miss
    const prio = m.priority === '' ? 0 : parseInt(m.priority, 10);
    table[m.identifier] = { identifier: m.identifier, gen, isStatus, baseType, power, acc, prio };
  }
  return table;
}

function makeEntry(rec, gen) {
  const type = (gen === 1 && GEN1_TYPE_OVERRIDE[rec.identifier]) || rec.baseType;
  const id = moveId(rec.identifier);
  const cat = rec.isStatus ? 'Status' : (PHYSICAL_TYPES.has(type) ? 'Physical' : 'Special');
  const bp = rec.isStatus ? 0 : (rec.power ?? 0);
  const entry = { name: titleName(rec.identifier), type, bp, acc: rec.acc, prio: rec.prio, cat };
  if (OHKO.has(id)) { entry.ohko = true; entry.acc = rec.acc; }
  if (HIGH_CRIT.has(id)) entry.highCrit = true;
  const needsBp = !rec.isStatus && (rec.power == null); // variable/fixed-damage move
  return { id, entry, needsBp };
}

function loadJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function writeJson(name, obj) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name), JSON.stringify(obj)); }

async function main() {
  console.log('PokeGuess movestats pipeline');
  const base = await buildBaseTable();
  const byId = {}; for (const r of Object.values(base)) byId[moveId(r.identifier)] = r;

  const report = loadReport();
  report.removedNonMoves = [];
  report.movestats = {};

  for (const gen of [1, 2]) {
    const mlPath = join(OUT, `movelist-gen${gen}.json`);
    if (!existsSync(mlPath)) { console.log(`  (skip gen${gen}: no movelist — run generate-data.mjs first)`); continue; }
    const movelist = loadJson(mlPath);

    const movestats = {};
    const csvRows = [];
    const removed = []; // {species, move}
    const flagged = []; // needsBp

    for (const [species, arr] of Object.entries(movelist)) {
      const kept = [];
      for (const m of arr) {
        const rawId = moveId(m.move);
        const id = ID_ALIAS[rawId] || rawId;
        const rec = byId[id];
        const validForGen = rec && rec.gen <= gen;
        if (!validForGen) { removed.push({ species, move: m.move }); continue; } // GATE: drop non-moves
        kept.push(m);
        // key by the id the sim will compute from THIS name (rawId), and use
        // the movelist's own display name — so runtime lookup always resolves.
        if (!movestats[rawId]) {
          const { entry, needsBp } = makeEntry(rec, gen);
          entry.name = m.move;
          movestats[rawId] = entry;
          if (needsBp) flagged.push(entry.name);
        }
      }
      movelist[species] = kept;
    }

    // re-write the gated movelist + the movestats
    writeJson(`movelist-gen${gen}.json`, movelist);
    writeJson(`movestats-gen${gen}.json`, movestats);

    // review CSV (sorted by name)
    const ids = Object.keys(movestats).sort((a, b) => movestats[a].name.localeCompare(movestats[b].name));
    csvRows.push('moveId,name,type,bp,acc,prio,cat,ohko,highCrit,NEEDS_BP_REVIEW');
    for (const id of ids) {
      const e = movestats[id];
      const needsBp = !e.bp && e.cat !== 'Status';
      csvRows.push([id, e.name, e.type, e.bp, e.acc === true ? '—(never miss)' : e.acc, e.prio, e.cat,
        e.ohko ? 'yes' : '', e.highCrit ? 'yes' : '', needsBp ? 'CHECK' : ''].join(','));
    }
    writeFileSync(join(OUT, `movestats-gen${gen}.review.csv`), csvRows.join('\n'));

    report.removedNonMoves.push(...removed.map((r) => ({ gen, ...r })));
    report.movestats[`gen${gen}`] = { moves: ids.length, removedNonMoves: removed.length, needsBpReview: flagged.sort() };
    console.log(`\nGEN${gen}: ${ids.length} distinct moves, ` +
      `${removed.length} non-moves removed from movelist, ` +
      `${flagged.length} need a manual bp (variable/fixed power).`);
    if (removed.length) console.log('  removed:', [...new Set(removed.map((r) => r.move))].join(', '));
  }

  writeJson('_data-report.json', report);
  console.log('\nReview CSVs: docs/data/movestats-gen{1,2}.review.csv');
  console.log('DONE.');
}

function loadReport() {
  const p = join(OUT, '_data-report.json');
  return existsSync(p) ? loadJson(p) : { generatedAt: new Date().toISOString() };
}

main().catch((e) => { console.error(e); process.exit(1); });
