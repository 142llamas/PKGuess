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

function main() {
  const summary = [];
  for (const gen of [1, 2]) {
    const csvPath = join(OUT, `movestats-gen${gen}.review.csv`);
    if (!existsSync(csvPath)) { console.log(`  (skip gen${gen}: no curated CSV at ${csvPath})`); continue; }
    const rows = parseCsv(readFileSync(csvPath, 'utf8'));

    const movestats = {};
    for (const r of rows) {
      const id = r.moveId && r.moveId.trim();
      if (!id) continue;
      const entry = {
        name: r.name, type: r.type,
        bp: parseBp(r.bp), acc: parseAcc(r.acc),
        prio: parseInt(r.prio, 10) || 0, cat: r.cat,
      };
      if ((r.ohko || '').toLowerCase() === 'yes') entry.ohko = true;
      if ((r.highCrit || '').toLowerCase() === 'yes') entry.highCrit = true;
      movestats[id] = entry;
    }
    writeFileSync(join(OUT, `movestats-gen${gen}.json`), JSON.stringify(movestats));

    // reconcile movelist: drop any move not present in the curated movestats
    const mlPath = join(OUT, `movelist-gen${gen}.json`);
    const removed = [];
    if (existsSync(mlPath)) {
      const ml = JSON.parse(readFileSync(mlPath, 'utf8'));
      for (const [sp, arr] of Object.entries(ml)) {
        const kept = arr.filter((m) => {
          if (movestats[moveId(m.move)]) return true;
          removed.push({ species: sp, move: m.move });
          return false;
        });
        ml[sp] = kept;
      }
      writeFileSync(mlPath, JSON.stringify(ml));
    }

    // gate: confirm every remaining movelist move resolves
    const ml = JSON.parse(readFileSync(mlPath, 'utf8'));
    const unresolved = new Set();
    for (const arr of Object.values(ml)) for (const m of arr) if (!movestats[moveId(m.move)]) unresolved.add(m.move);

    const removedUnique = [...new Set(removed.map((r) => r.move))];
    summary.push({ gen, moves: Object.keys(movestats).length, removedFromMovelist: removed.length, removedUnique, unresolved: [...unresolved] });
    console.log(`GEN${gen}: ${Object.keys(movestats).length} movestats; ` +
      `removed ${removed.length} movelist entries (${removedUnique.length} distinct: ${removedUnique.join(', ') || '—'}); ` +
      `unresolved after reconcile: ${unresolved.size}`);
    if (unresolved.size) console.error('  !! still unresolved:', [...unresolved]);
  }

  // fold into the data report
  const repPath = join(OUT, '_data-report.json');
  const report = existsSync(repPath) ? JSON.parse(readFileSync(repPath, 'utf8')) : {};
  report.curatedMovestats = { appliedAt: new Date().toISOString(), perGen: summary };
  writeFileSync(repPath, JSON.stringify(report, null, 0));
  console.log('\nDONE. movestats JSON written from curated CSVs; movelists reconciled.');
}

main();
