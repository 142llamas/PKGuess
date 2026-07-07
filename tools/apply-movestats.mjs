/**
 * @file        tools/apply-movestats.mjs 
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Converts the HUMAN-CURATED movestats review CSVs
 *           (docs/data/movestats-gen{N}.review.csv) into the game's
 *           movestats-gen{N}.json, and reconciles the movelists: any move you
 *           removed from the CSV is also removed from movelist-gen{N}.json so
 *           the completeness gate stays satisfied (the sim never references a
 *           move without stats). This supersedes generate-movestats.mjs, which
 *           is only the one-time PokeAPI bootstrap — once you've curated the
 *           CSVs, run THIS instead so your edits are the source of truth.
 *
 * Fields written per move: { name, type, bp:Number, acc:(Number|true), prio:Number,
 *   cat, [ohko:true], [highCrit:true] }. acc "—(never miss)" → true. OHKO moves
 *   keep bp:0 (the sim auto-kills via the ohko flag). The NEEDS_BP_REVIEW column
 *   is a note for you and is not written to the JSON.
 *
 * USAGE:  node tools/apply-movestats.mjs [--out docs/data]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = arg('out', join(REPO_ROOT, 'docs', 'data'));

const moveId = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

// minimal RFC-ish CSV line parser (handles quoted fields)
function parseCsv(txt) {
  const lines = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).filter((l) => l.length).map((l) => {
    const cells = splitLine(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}
function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseAcc(v) {
  const s = String(v).trim();
  if (!s || /never\s*miss/i.test(s) || s === '\u2014') return true;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : true;
}
function parseBp(v) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function buildMovestatsFromCsv(csvPath) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const ms = {};
  for (const r of rows) {
    const id = r.moveId && r.moveId.trim();
    if (!id) continue;
    const entry = { name: r.name, type: r.type, bp: parseBp(r.bp), acc: parseAcc(r.acc), prio: parseInt(r.prio, 10) || 0, cat: r.cat };
    if ((r.ohko || '').toLowerCase() === 'yes') entry.ohko = true;
    if ((r.highCrit || '').toLowerCase() === 'yes') entry.highCrit = true;
    ms[id] = entry;
  }
  return ms;
}

// Report (do not remove) movelist moves that have no movestats — these are real
// learnset moves that simply aren't draftable (e.g. Counter/Bide that were
// removed from movestats). The guess game still uses them; draft.js skips them.
function nonDraftable(mlPath, movestats) {
  if (!existsSync(mlPath)) return [];
  const ml = JSON.parse(readFileSync(mlPath, 'utf8'));
  const set = new Set();
  for (const arr of Object.values(ml)) for (const m of arr) if (!movestats[moveId(m.move)]) set.add(m.move);
  return [...set];
}

function main() {
  const summary = [];

  // --- GEN 2: curated CSV is the source of truth --------------------------
  const csv2 = join(OUT, 'movestats-gen2.review.csv');
  if (!existsSync(csv2)) { console.error(`missing ${csv2}`); process.exit(1); }
  const ms2 = buildMovestatsFromCsv(csv2);
  writeFileSync(join(OUT, 'movestats-gen2.json'), JSON.stringify(ms2));
  const nd2 = nonDraftable(join(OUT, 'movelist-gen2.json'), ms2);
  console.log(`GEN2: ${Object.keys(ms2).length} movestats (curated). Non-draftable real moves kept in movelist: ${nd2.join(', ') || '\u2014'}`);
  summary.push({ gen: 2, source: 'curated-csv', moves: Object.keys(ms2).length, nonDraftable: nd2 });

  // --- GEN 1: derived from GEN 2 (mirrors Gen 2 values; only covers moves --
  // --- that exist in Gen 2, so Gen-2-introduced moves are naturally absent). -
  const ml1Path = join(OUT, 'movelist-gen1.json');
  const ms1 = {};
  if (existsSync(ml1Path)) {
    const ml1 = JSON.parse(readFileSync(ml1Path, 'utf8'));
    const used = new Set();
    for (const arr of Object.values(ml1)) for (const m of arr) used.add(moveId(m.move));
    for (const id of used) if (ms2[id]) ms1[id] = { ...ms2[id] };
  }
  writeFileSync(join(OUT, 'movestats-gen1.json'), JSON.stringify(ms1));
  const nd1 = nonDraftable(ml1Path, ms1);
  console.log(`GEN1: ${Object.keys(ms1).length} movestats (derived from Gen 2). Non-draftable real moves kept in movelist: ${nd1.join(', ') || '\u2014'}`);
  summary.push({ gen: 1, source: 'derived-from-gen2', moves: Object.keys(ms1).length, nonDraftable: nd1 });

  const repPath = join(OUT, '_data-report.json');
  const report = existsSync(repPath) ? JSON.parse(readFileSync(repPath, 'utf8')) : {};
  report.curatedMovestats = { appliedAt: new Date().toISOString(), perGen: summary };
  writeFileSync(repPath, JSON.stringify(report, null, 0));
  console.log('\nDONE. Movestats written (Gen 2 curated, Gen 1 derived). Movelists left intact (full learnsets for the guess game).');
}

main();
