/**
 * @file        tools/generate-data.mjs
 * @version     1.0.0
 * @updated     2026-06-23
 * @changelog
 *   1.0.0 — Initial pipeline. Reads the two Excel workbooks (the source of
 *           truth) + the committed per-gen rules JSON, and emits the site's
 *           data/*.json. Reproduces the canonical game's OWN import mapping
 *           (the `fm` header→key dictionary lifted verbatim from the offline
 *           HTML's parseWorkbook) so output matches what the engine expects.
 *           Cleans the move list per SPEC §7 (stat-block bleed, known typos,
 *           junk) and REPORTS anything still suspicious instead of silently
 *           guessing. Emits: gen{1,2}.json (id+pokedex+clues+categories+
 *           difficulties+multiClue), movelist-gen{1,2}.json, config.json,
 *           typechart-gen2.json. movestats-gen*.json + typechart-gen1.json are
 *           produced by a later pass (need a vetted move-data source + a
 *           completeness gate; the guess games don't use them).
 * ---------------------------------------------------------------------------
 * USAGE (run locally; you only need this when the Excel changes):
 *   npm install xlsx
 *   node tools/generate-data.mjs \
 *     --gen1 path/to/PokeGuess_Red_Blue_Yellow_v5.xlsx \
 *     --gen2 path/to/pokeguessworkbook.xlsx \
 *     [--out docs/data] [--rules tools/rules]
 * Defaults assume you run it from the repo root with the workbooks in ./ .
 */

import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ---- CLI args --------------------------------------------------------------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const PATHS = {
  gen1: arg('gen1', join(REPO_ROOT, 'PokeGuess_Red_Blue_Yellow_v3.xlsx')),
  gen2: arg('gen2', join(REPO_ROOT, 'pokeguessworkbook.xlsx')),
  out: arg('out', join(REPO_ROOT, 'docs', 'data')),
  rules: arg('rules', join(__dirname, 'rules')),
};

// ---- authoritative header->key maps (verbatim from the offline HTML) -------
const FM_GEN2 = {
  '#': 'num', 'Pokémon': 'name', 'Pokédex Habitat': 'habitat',
  'Can Be Caught in Wild': 'caughtWild', 'Found by Walking': 'walking',
  'Found by Surfing': 'surfing', 'Found by Fishing': 'fishing',
  'Found by headbutting': 'headbutting',
  'Obtained from NPC / Trade / Gift / Egg / Fossil': 'npcObtain',
  'Evolution Stages': 'familySize', 'Evolution Stage': 'evoStage',
  'Can Evolve': 'canEvolve', 'Evolves from Another Pokémon': 'evolvesFrom',
  'Evolution Method (how to get this Pokemon)': 'evoMethod',
  'All Weaknesses': 'allWeaknesses', 'All Resistances': 'allResistances',
  'Immunities': 'immunities', 'Type 1': 'type1', 'Type 2': 'type2',
  'Base Stat Total Range': 'bstRange', 'Highest Base Stat': 'highestStat',
  'Highest Base Stat (with value)': 'highestStatVal',
  'Lowest Base Stat': 'lowestStat', 'Lowest Base Stat (with value)': 'lowestStatVal',
  'Full Stat Spread (HP/Atk/Def/SpA/SpD/Spe)': 'fullStats',
  'Used by NPC Trainer': 'npcTrainer', 'Used by Gym Leader': 'gymLeader',
  'Used by Elite Four / Red / Rival': 'e4RedCal',
  'Used in Crystal Battle Tower': 'battleTower',
  'Example Moveset (4 random moves)': 'exampleMoveset', 'One TM/HM Move': 'tmHmMove',
  'One Egg Move': 'eggMove', 'Comp Moveset 1': 'compMoveset1',
  'Comp Moveset 2': 'compMoveset2', 'Comp Moveset 3': 'compMoveset3',
  'Comp Moveset 4': 'compMoveset4', 'First Anime Appearance': 'firstAnime',
  'Acquisition / Evolution (Anime)': 'animeAcqEvo',
};
const FM_GEN1 = {
  '#': 'num', 'Pokémon': 'name', 'Pokédex Habitat': 'habitat',
  'Can Be Caught in Wild': 'caughtWild', 'Found by Walking': 'walking',
  'Found by Surfing': 'surfing', 'Found by Fishing': 'fishing',
  'Found in Safari Zone': 'safariZone',
  'Obtained from NPC / Trade / Gift / Fossil': 'npcObtain',
  'Evolution Stages': 'familySize', 'Evolution Stage': 'evoStage',
  'Can Evolve': 'canEvolve', 'Evolves from Another Pokémon': 'evolvesFrom',
  'Evolution Method (how to get this Pokemon)': 'evoMethod',
  'All Weaknesses': 'allWeaknesses', 'All Resistances': 'allResistances',
  'Immunities': 'immunities', 'Type 1': 'type1', 'Type 2': 'type2',
  'Base Stat Total Range': 'bstRange', 'Highest Base Stat': 'highestStat',
  'Highest Base Stat (with value)': 'highestStatVal',
  'Lowest Base Stat': 'lowestStat', 'Lowest Base Stat (with value)': 'lowestStatVal',
  'Full Stat Spread (HP/Atk/Def/Spc/Spe)': 'fullStats',
  'Used by NPC Trainer': 'npcTrainer', 'Used by Gym Leader': 'gymLeader',
  'Used by Elite Four / Rival': 'e4Rival',
  'Example Moveset (4 random moves)': 'exampleMoveset', 'One TM/HM Move': 'tmHmMove',
  'Comp Moveset 1': 'compMoveset1', 'Comp Moveset 2': 'compMoveset2',
  'Comp Moveset 3': 'compMoveset3', 'Comp Moveset 4': 'compMoveset4',
  'First Anime Appearance': 'firstAnime', 'Acquisition / Evolution (Anime)': 'animeAcqEvo',
};

// ---- move-list cleaning (mirrors draft.js canonicalizeMove + extra report) -
const MOVE_ALIASES = {
  'faint attack': 'Feint Attack', 'hi jump kick': 'High Jump Kick',
  'foresoght': 'Foresight', 'ponud': 'Pound', 'safegurard': 'Safeguard',
  'whirwind': 'Whirlwind', 'vicegrip': 'Vise Grip',
};
const DASH_RE = /^[\s\-\u2012\u2013\u2014\u2015\u2212]*$/;
// A real Gen 1/2 move name is 1–4 Title-Case words (letters, spaces, hyphen,
// apostrophe, periods). No move name contains a digit.
const MOVE_NAME_RE = /^[A-Z][A-Za-z'’.\-]*(?: [A-Z][A-Za-z'’.\-]*){0,3}$/;
const NOTE_WORD_RE = /\s+\b(?:Breeding|Other|Maximum|Stats|Crystal|Can|Imported|Psyduck|not|a|TM|only|via|in)\b.*$/i;

const PLACEHOLDER_RE = /^(none|all of them|n\/a|na)$/i;

/**
 * Classify and clean a raw Move cell.
 * @returns {{move:string|null, status:'ok'|'rescued'|'dropped-stat'|'unresolved', from?:string}}
 */
function cleanMoveCell(raw) {
  let s = String(raw).trim().replace(/\s+/g, ' '); // collapse double-spaces ("Steel  Wing")
  if (!s || DASH_RE.test(s) || PLACEHOLDER_RE.test(s)) return { move: null, status: 'dropped-stat' };

  // Stat-block bleed: any digit means a stat dump leaked into the Move column
  // (e.g. "100 Attack", "278 Special Defense : L50: 150 HP", "Ice Beam Maximum
  // Stats : L50: 165 HP"). Rescue a leading real move if one is glued on;
  // otherwise it's a pure stat fragment -> drop.
  if (/\d/.test(s)) {
    const lead = s.split(/\s+Maximum Stats|\s+L\d|\s*\d/i)[0].trim();
    const fixed = applyAlias(lead);
    if (fixed && !PLACEHOLDER_RE.test(fixed) && MOVE_NAME_RE.test(fixed)) {
      return { move: fixed, status: lead === s ? 'ok' : 'rescued', from: raw };
    }
    return { move: null, status: 'dropped-stat' };
  }

  // Clean already? (also tolerate a trailing stray punctuation like "Stomp .")
  const direct = applyAlias(s.replace(/\s*[.,;]+\s*$/, '').trim());
  if (MOVE_NAME_RE.test(direct)) return { move: direct, status: s === direct ? 'ok' : 'rescued', from: raw };

  // "None Other: <move>" / "None: <move>" — the placeholder is the bleed; the
  // real move follows the colon.
  const colon = s.split(':');
  if (colon.length > 1 && /^none\b/i.test(colon[0].trim())) {
    const after = applyAlias(colon.slice(1).join(':').replace(/^\s*other\s*/i, '').trim());
    if (after && !PLACEHOLDER_RE.test(after) && MOVE_NAME_RE.test(after)) {
      return { move: after, status: 'rescued', from: raw };
    }
  }

  // Annotation bleed: a real move glued to a note. Cut at the first bracket or
  // colon, then chop a trailing note clause, then validate.
  let base = s.split(/[(:)\[\]]/)[0].trim();
  base = base.replace(NOTE_WORD_RE, '').trim();
  const cand = applyAlias(base);
  if (cand && !PLACEHOLDER_RE.test(cand) && MOVE_NAME_RE.test(cand)) {
    return { move: cand, status: 'rescued', from: raw };
  }
  return { move: null, status: 'unresolved', from: raw };
}

function applyAlias(s) {
  if (!s) return s;
  const lc = s.toLowerCase();
  return MOVE_ALIASES[lc] || s;
}

// ---- helpers ---------------------------------------------------------------
function readWorkbook(path) {
  if (!existsSync(path)) throw new Error(`workbook not found: ${path}`);
  return XLSX.read(readFileSync(path), { type: 'buffer' });
}
function findSheet(wb, re) {
  const name = wb.SheetNames.find((n) => re.test(n));
  return name ? wb.Sheets[name] : null;
}
function loadRules(gen) {
  const p = join(PATHS.rules, `gen${gen}.rules.json`);
  if (!existsSync(p)) throw new Error(`rules file missing: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function buildGen(gen, path, fm) {
  const report = { gen, pokedexRows: 0, missingHeaders: [], rescued: [], unresolved: [], droppedStat: 0, renamedSpecies: [], unmatchedMoveSpecies: [], dexWithoutMoves: [] };
  const wb = readWorkbook(path);

  // --- pokedex ---
  const dexSheet = findSheet(wb, /pok[eé]dex/i);
  if (!dexSheet) throw new Error(`gen${gen}: no Pokédex sheet`);
  const rows = XLSX.utils.sheet_to_json(dexSheet, { defval: '' });
  const haveHeaders = new Set(Object.keys(rows[0] || {}));
  for (const h of Object.keys(fm)) if (!haveHeaders.has(h)) report.missingHeaders.push(h);

  const pokedex = rows
    .filter((r) => String(r['Pokémon'] || '').trim())
    .map((r) => {
      const o = {};
      for (const [col, key] of Object.entries(fm)) o[key] = String(r[col] ?? '').trim();
      return o;
    });
  report.pokedexRows = pokedex.length;

  // Reconcile move-sheet names to dex names. engine.js and draft.js both join by
  // dexName.toLowerCase(), so the movelist MUST be keyed by the dex spelling.
  // Some sheets spell a few names differently (Nidoran(f) vs Nidoran-F,
  // Farfetch'd vs Farfetchd, ♀/♂ vs -F/-M). Normalise to bridge the two sides.
  const normKey = (s) => String(s || '').toLowerCase()
    .replace(/\u2640/g, 'f').replace(/\u2642/g, 'm')   // ♀ ♂
    .replace(/[^a-z0-9]/g, '');
  const dexByNorm = new Map();
  for (const p of pokedex) dexByNorm.set(normKey(p.name), p.name);

  // --- move list (cleaned + name-reconciled) ---
  const mlSheet = findSheet(wb, /move/i);
  const movelist = {};
  const seenUnmatched = new Set();
  if (mlSheet) {
    const rows2 = XLSX.utils.sheet_to_json(mlSheet, { defval: '' });
    for (const r of rows2) {
      const rawSpecies = String(r['Pokémon'] || '').trim();
      const rawMove = String(r['Move'] || '').trim();
      if (!rawSpecies || !rawMove) continue;
      const dexName = dexByNorm.get(normKey(rawSpecies));
      if (!dexName) {
        if (!seenUnmatched.has(rawSpecies)) { seenUnmatched.add(rawSpecies); report.unmatchedMoveSpecies.push(rawSpecies); }
        continue;
      }
      if (dexName.toLowerCase() !== rawSpecies.toLowerCase()
          && !report.renamedSpecies.some((x) => x.from === rawSpecies)) {
        report.renamedSpecies.push({ from: rawSpecies, to: dexName });
      }
      const key = dexName.toLowerCase();
      const { move, status, from } = cleanMoveCell(rawMove);
      if (status === 'dropped-stat') { report.droppedStat++; continue; }
      if (status === 'unresolved') { report.unresolved.push({ species: key, raw: from }); continue; }
      // A "move" whose name is actually a Pokémon species (e.g. the bled
      // "Gyarados") is junk — no Gen 1/2 move shares a species name. Drop it.
      // (Real moves like Counter/Bide stay: the guess game needs the full
      // learnset; draft excludes non-battle moves at draft time via movestats.)
      if (dexByNorm.has(normKey(move))) { (report.removedNonMoves ||= []).push({ species: key, move }); continue; }
      if (status === 'rescued') report.rescued.push({ species: key, from, to: move });
      (movelist[key] ||= []).push({ move, source: String(r['Source'] || '').trim() });
    }
  }
  // --- supplemental moves (gaps not present in the Excel move sheet) ---------
  // Merged de-duplicated by move+source, so it self-deactivates once the same
  // rows are added to the Excel. Keys are dexName.toLowerCase().
  const suppPath = join(__dirname, 'supplemental', `gen${gen}-moves.json`);
  if (existsSync(suppPath)) {
    const supp = JSON.parse(readFileSync(suppPath, 'utf8'));
    for (const [key, list] of Object.entries(supp)) {
      if (key.startsWith('_') || !Array.isArray(list)) continue;
      const dexName = dexByNorm.get(normKey(key));
      if (!dexName) { report.unmatchedMoveSpecies.push(`(supplemental) ${key}`); continue; }
      const realKey = dexName.toLowerCase();
      const existing = (movelist[realKey] ||= []);
      const have = new Set(existing.map((m) => `${m.move}\u0000${m.source}`));
      let added = 0;
      for (const m of list) {
        const { move, status } = cleanMoveCell(String(m.move || ''));
        if (status === 'dropped-stat' || status === 'unresolved' || !move) continue;
        const sig = `${move}\u0000${m.source || ''}`;
        if (have.has(sig)) continue;
        existing.push({ move, source: String(m.source || '').trim() });
        have.add(sig); added++;
      }
      if (added) report.supplemented = (report.supplemented || []).concat([{ species: realKey, added }]);
    }
  }

  // --- special-case expansions ---------------------------------------------
  // Smeargle: the MOVELIST (used by the guess game) keeps only Sketch, as it
  // appears in the Excel. The draft game gets access to all moves via a separate
  // draftpool-genN.json file built below. This preserves correct guess-game
  // behavior (Smeargle's example moveset clue reveals only Sketch).
  //
  // Mew: "All of them" TM/HM sentinel — expand to all TM/HMs. Correct for BOTH
  // the guess game (TM/HM clue reveals any TM) and the draft (full TM/HM pool).
  const mewKey = dexByNorm.get(normKey('Mew'))?.toLowerCase();
  if (mewKey) {
    const tmhmMoves = new Set();
    for (const arr of Object.values(movelist)) {
      for (const m of arr) {
        if (/TM\s*\/\s*HM|TM|HM/i.test(m.source)) tmhmMoves.add(m.move);
      }
    }
    const existing = movelist[mewKey] || [];
    const existingNames = new Set(existing.map((m) => m.move));
    const toAdd = [...tmhmMoves].filter((m) => !existingNames.has(m)).map((m) => ({ move: m, source: 'TM / HM' }));
    movelist[mewKey] = [...existing, ...toAdd];
    if (toAdd.length) report.supplemented = (report.supplemented || []).concat([{ species: mewKey, added: toAdd.length, note: 'Expanded: all TM/HMs via "All of them" sentinel' }]);
  }

  // --- draft pool (separate from movelist) ----------------------------------
  // Build draftpool-genN.json: like the movelist but Smeargle gets ALL moves
  // (everything with movestats, minus Sketch). Keyed dexNameLower → [moveName].
  // The draft controller uses this file; the guess game uses movelist only.
  const draftpoolExtra = {};
  const smeargleKey = dexByNorm.get(normKey('Smeargle'))?.toLowerCase();
  if (smeargleKey) {
    // Collect all move names present in movelist (any source, any species)
    const allMoveNames = new Set();
    for (const arr of Object.values(movelist)) for (const m of arr) allMoveNames.add(m.move);
    // Smeargle draft pool = all moves except Sketch
    draftpoolExtra[smeargleKey] = [...allMoveNames]
      .filter((m) => String(m).toLowerCase().replace(/[^a-z0-9]/g, '') !== 'sketch')
      .map((m) => ({ move: m, source: 'Sketch' }));
  }
  // For all other species, draftpool is identical to movelist.
  // We only need to store overrides — the draft controller merges at load time.

  // dex species that ended up with no moves at all (genuine data gaps)
  for (const p of pokedex) if (!movelist[p.name.toLowerCase()] || !movelist[p.name.toLowerCase()].length) report.dexWithoutMoves.push(`${p.num} ${p.name}`);

  // --- fold in the engine rules (clues/categories/difficulties/multiClue) ---
  const rules = loadRules(gen);
  const genData = {
    id: `gen${gen}`,
    pokedex,
    clues: rules.clues,
    categories: rules.categories,
    difficulties: rules.difficulties,
    multiClue: rules.multiClue,
  };

  return { genData, movelist, draftpoolExtra, report };
}

// ---- Gen 2 (GSC-era) type chart: attacker -> { defender: multiplier } ------
// Only non-1.0 entries are listed; the sim defaults missing matchups to 1x.
const TYPECHART_GEN2 = {
  Normal:   { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire:     { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water:    { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass:    { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice:      { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2 },
  Poison:   { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
  Ground:   { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying:   { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic:  { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug:      { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5 },
  Rock:     { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost:    { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5, Steel: 0.5 },
  Dragon:   { Dragon: 2, Steel: 0.5 },
  Dark:     { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Steel: 0.5 },
  Steel:    { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5 },
};
const GEN2_TYPES = Object.keys(TYPECHART_GEN2);

// Gen 1 (RBY) chart, DERIVED from the Gen 2 chart to minimise transcription
// error: drop Dark & Steel (they don't exist in Gen 1), then apply the
// well-known Gen-1-specific differences. PLEASE VERIFY a few edge matchups
// (e.g. Ice↔Fire) — the famous Gen-1 quirks below are intentional.
function deriveGen1Chart(gen2) {
  const chart = JSON.parse(JSON.stringify(gen2));
  delete chart.Dark; delete chart.Steel;                 // no such attacker types
  for (const row of Object.values(chart)) { delete row.Dark; delete row.Steel; } // nor defenders
  chart.Bug.Poison = 2;          // Gen 1: Bug is super-effective on Poison
  delete chart.Bug.Ghost;        // Gen 1: Bug→Ghost was neutral
  chart.Poison.Bug = 2;          // Gen 1: Poison is super-effective on Bug
  chart.Ghost.Psychic = 0;       // Gen 1 bug: Ghost→Psychic had "no effect"
  return chart;
}
const TYPECHART_GEN1 = deriveGen1Chart(TYPECHART_GEN2);
const GEN1_TYPES = Object.keys(TYPECHART_GEN1);

function validateTypechart(chart, types) {
  const problems = [];
  for (const t of types) if (!chart[t]) problems.push(`no attacker row for ${t}`);
  for (const [atk, row] of Object.entries(chart)) {
    for (const [def, mult] of Object.entries(row)) {
      if (!types.includes(def)) problems.push(`${atk}->${def}: unknown defender type`);
      if (![0, 0.5, 2].includes(mult)) problems.push(`${atk}->${def}: odd multiplier ${mult}`);
    }
  }
  return problems;
}

// ---- config.json (app-shell + mp defaults + menu) --------------------------
function buildConfig() {
  return {
    title: 'PokéGuess',
    gens: [1, 2],
    genLabels: { 1: 'Gen 1', 2: 'Gen 2' },
    mpDefaults: { winTarget: 150, poolPerRound: 75, guessCost: 0 },
    modes: [
      { id: 'single', label: 'Single Player', group: 'Guess', gens: [1, 2] },
      { id: 'pokedex', label: 'Pokédex', group: 'Guess', gens: [1, 2] },
      { id: 'safari', label: 'Safari Zone', group: 'Guess', gens: [1, 2] },
      { id: 'victoryroad', label: 'Victory Road', group: 'Guess', gens: [1, 2] },
      { id: 'multiplayer', label: 'Multiplayer', group: 'Guess', gens: [1, 2] },
      { id: 'leaderboard', label: 'Leaderboard', group: 'Guess', gens: [1, 2] },
      { id: 'draftbattle', label: 'Draft Battle', group: 'Draft', gens: [2] },
      { id: 'dailychallenge', label: 'Daily Challenge', group: 'Draft', gens: [2] },
    ],
  };
}

// ---- main ------------------------------------------------------------------
function writeJson(name, obj) {
  mkdirSync(PATHS.out, { recursive: true });
  writeFileSync(join(PATHS.out, name), JSON.stringify(obj));
  return obj;
}

function main() {
  console.log('PokeGuess data pipeline');
  console.log('  gen1 :', PATHS.gen1);
  console.log('  gen2 :', PATHS.gen2);
  console.log('  out  :', PATHS.out);

  const reports = [];
  for (const [gen, path, fm] of [[1, PATHS.gen1, FM_GEN1], [2, PATHS.gen2, FM_GEN2]]) {
    const { genData, movelist, draftpoolExtra, report } = buildGen(gen, path, fm);
    writeJson(`gen${gen}.json`, genData);
    writeJson(`movelist-gen${gen}.json`, movelist);
    if (Object.keys(draftpoolExtra).length) {
      writeJson(`draftpool-gen${gen}.json`, draftpoolExtra);
      console.log(`  draftpool-gen${gen}.json: ${Object.keys(draftpoolExtra).length} override(s).`);
    }
    reports.push(report);
    console.log(`\nGEN${gen}: ${report.pokedexRows} Pokémon, ` +
      `${Object.keys(movelist).length} species with moves, ` +
      `${report.droppedStat} stat-fragments dropped, ` +
      `${report.rescued.length} moves rescued from bleed, ` +
      `${report.unresolved.length} unresolved (need Excel fix).`);
    if (report.renamedSpecies.length) {
      console.log(`  name-reconciled ${report.renamedSpecies.length}: ` +
        report.renamedSpecies.map((x) => `${x.from}→${x.to}`).join(', '));
    }
    if (report.unmatchedMoveSpecies.length) {
      console.error(`  !! move rows with no matching dex name: ${report.unmatchedMoveSpecies.join(', ')}`);
    }
    if (report.supplemented && report.supplemented.length) {
      console.log(`  supplemented: ${report.supplemented.map((x) => `${x.species} (+${x.added})`).join(', ')}`);
    }
    if (report.dexWithoutMoves.length) {
      console.error(`  !! dex species with NO moves: ${report.dexWithoutMoves.join(', ')}`);
    }
    if (report.missingHeaders.length) {
      console.error(`  !! MISSING HEADERS: ${report.missingHeaders.join(' | ')}`);
    }
  }

  // Gen 2 type chart (the one Draft needs now) + Gen 1 (derived; verify)
  for (const [g, chart, types] of [[2, TYPECHART_GEN2, GEN2_TYPES], [1, TYPECHART_GEN1, GEN1_TYPES]]) {
    const problems = validateTypechart(chart, types);
    if (problems.length) {
      console.error(`  !! TYPECHART gen${g} PROBLEMS:\n   ` + problems.join('\n   '));
      throw new Error(`typechart-gen${g} failed validation`);
    }
    writeJson(`typechart-gen${g}.json`, chart);
    console.log(`typechart-gen${g}.json: ${types.length} types, validated.`);
  }

  writeJson('config.json', buildConfig());
  console.log('config.json written.');

  // data report -> file the human can act on (fix the Excel at source)
  const rescued = reports.flatMap((r) => r.rescued.map((a) => ({ gen: r.gen, ...a })));
  const unresolved = reports.flatMap((r) => r.unresolved.map((a) => ({ gen: r.gen, ...a })));
  const renamed = reports.flatMap((r) => r.renamedSpecies.map((a) => ({ gen: r.gen, ...a })));
  const dexWithoutMoves = reports.flatMap((r) => r.dexWithoutMoves.map((s) => ({ gen: r.gen, species: s })));
  const unmatchedMoveSpecies = reports.flatMap((r) => r.unmatchedMoveSpecies.map((s) => ({ gen: r.gen, species: s })));
  writeJson('_data-report.json', {
    generatedAt: new Date().toISOString(),
    note: 'Move-list cleaning + name reconciliation. `rescued` = move recovered from ' +
          'a bled cell. `unresolved` = couldn\'t recover (fix at Excel source). ' +
          '`renamedSpecies` = move-sheet name mapped to the dex spelling. ' +
          '`dexWithoutMoves` = dex Pokémon with zero moves found (genuine data gap). ' +
          '`removedNonMoves` (from generate-movestats) = movelist entries that aren\'t ' +
          'real moves. typechart-gen1.json is DERIVED — verify edge matchups.',
    rescued, unresolved, renamed, dexWithoutMoves, unmatchedMoveSpecies,
  });
  console.log(`\n_data-report.json: ${rescued.length} rescued, ${unresolved.length} unresolved, ${renamed.length} renamed, ${dexWithoutMoves.length} dex w/o moves.`);
  console.log('\nDONE.');
}

main();
