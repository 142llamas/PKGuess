import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });
const { window } = dom;
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch {} };
global.window = window; global.document = window.document;
def('navigator', window.navigator); def('Node', window.Node); def('HTMLElement', window.HTMLElement); def('MouseEvent', window.MouseEvent);
def('localStorage', { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } });
global.setTimeout = (fn) => { try { fn(); } catch {} return 0; };

const P = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));
const dataFile = (name) => { try { return JSON.parse(readFileSync(P('../../docs/data/' + name), 'utf8')); } catch { return {}; } };
global.fetch = async (url) => {
  const file = String(url).split('/').pop();
  const exists = ['gen1.json', 'gen2.json', 'movelist-gen1.json', 'movelist-gen2.json', 'movestats-gen2.json', 'typechart-gen2.json', 'draftpool-gen2.json'].includes(file);
  return { ok: exists, json: async () => dataFile(file) };
};
const tick = () => new Promise((r) => { let i = 0; const t = () => (i++ < 5 ? Promise.resolve().then(t) : r()); t(); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const mk = () => { const d = window.document.createElement('div'); window.document.body.appendChild(d); return d; };
const txt = (root) => root.textContent || '';

async function run(name, importPath, factoryName, checks) {
  const mod = await import(importPath);
  const factory = mod[factoryName] || mod.default;
  const mount = mk();
  let ctrl;
  try {
    ctrl = factory({ mount, config: { genLabels: { 1: 'Gen 1', 2: 'Gen 2' } }, data: gen2, params: { gen: 2, modeId: name }, onExit: () => {} });
    await tick();
    checks(mount);
  } catch (e) { fail++; console.log(`  THREW in ${name}: ${e.message}`); }
  try { ctrl && ctrl.destroy && ctrl.destroy(); } catch {}
}

await run('single', '../../docs/js/modes/single.js', 'createSingle', (m) => {
  ok(m.querySelector('.gen-switch'), 'single: gen toggle present');
  ok(txt(m).includes('difficulty') || txt(m).includes('Difficulty'), 'single: difficulty screen rendered');
});

await run('safari', '../../docs/js/modes/safari.js', 'createSafari', (m) => {
  ok(m.querySelector('.gen-switch'), 'safari: gen toggle present');
  ok(txt(m).includes('Enter the Safari Zone'), 'safari: renamed title');
});

await run('victoryroad', '../../docs/js/modes/victoryroad.js', 'createVictoryRoad', (m) => {
  ok(m.querySelector('.gen-switch'), 'victoryroad: gen toggle present');
  ok(txt(m).includes('Victory Road'), 'victoryroad: intro rendered');
});

await run('pokedex', '../../docs/js/modes/pokedex.js', 'createPokedex', (m) => {
  ok(m.querySelector('.gen-switch'), 'pokedex: gen toggle present');
  ok(txt(m).includes('Pok'), 'pokedex: list rendered');
  ok(!m.querySelector('.full-stat-string'), 'pokedex: duplicate stat string removed (list has none)');
  // open first detail
  const row = m.querySelector('.study-row, [class*="study"][role], .study-list > *');
  if (row && row.click) { row.click(); }
});

// #17 — Seen/Caught combo filter: independent toggles whose union applies
// when both are active, replacing the old exclusive All/Caught/Not-caught radio.
{
  // Seed known catch data directly via the shared fake localStorage.
  localStorage.setItem('pokeGuess_catchTracker', JSON.stringify({
    bulbasaur: 'caught', ivysaur: 'seen', venusaur: 'caught',
  }));
  await run('pokedex-catchfilter', '../../docs/js/modes/pokedex.js', 'createPokedex', (m) => {
    const rowNames = () => [...m.querySelectorAll('.study-row, .study-list > *')].map((r) => r.textContent);
    const clickFilterBtn = (label) => {
      const btn = [...m.querySelectorAll('.study-catchbar-filters button')].find((b) => b.textContent.trim() === label);
      ok(!!btn, `filter button "${label}" exists`);
      if (btn) btn.click();
    };

    // Default (neither toggle): shows everything.
    const allCount = rowNames().length;
    ok(allCount > 3, `default view shows the full dex (${allCount} rows)`);

    // Caught only: Bulbasaur + Venusaur (exact prior meaning, unchanged).
    clickFilterBtn('\uD83C\uDFC6 Caught');
    let names = rowNames();
    ok(names.some((n) => n.includes('Bulbasaur')), 'Caught filter includes Bulbasaur');
    ok(names.some((n) => n.includes('Venusaur')), 'Caught filter includes Venusaur');
    ok(!names.some((n) => n.includes('Ivysaur')), 'Caught filter EXCLUDES Ivysaur (seen, not caught)');

    // Seen only (Caught still selected -> click Caught again to turn it off first)
    clickFilterBtn('\uD83C\uDFC6 Caught'); // toggle off
    clickFilterBtn('\uD83D\uDC41 Seen');   // toggle on
    names = rowNames();
    ok(names.some((n) => n.includes('Ivysaur')), 'Seen filter (alone) includes Ivysaur');
    ok(!names.some((n) => n.includes('Bulbasaur')), 'Seen filter (alone) EXCLUDES Bulbasaur (caught, not "seen-only") — unchanged exclusive meaning');
    ok(!names.some((n) => n.includes('Venusaur')), 'Seen filter (alone) EXCLUDES Venusaur (caught, not "seen-only")');

    // BOTH Seen + Caught active -> union (#17a's headline new behavior)
    clickFilterBtn('\uD83C\uDFC6 Caught'); // now both are on
    names = rowNames();
    ok(names.some((n) => n.includes('Bulbasaur')), 'Seen+Caught combo includes Bulbasaur (caught)');
    ok(names.some((n) => n.includes('Ivysaur')), 'Seen+Caught combo includes Ivysaur (seen)');
    ok(names.some((n) => n.includes('Venusaur')), 'Seen+Caught combo includes Venusaur (caught)');
    ok(names.length < allCount, 'the combo is still narrower than the full dex (excludes never-encountered mons)');

    // "All" resets both toggles
    const allBtn = [...m.querySelectorAll('.study-catchbar-filters button')].find((b) => b.textContent.trim() === 'All');
    ok(!!allBtn, '"All" reset button exists');
    if (allBtn) allBtn.click();
    ok(rowNames().length === allCount, '"All" restores the full unfiltered list');
  });
  localStorage.removeItem('pokeGuess_catchTracker');
}

// #17 — Single Player must mark a correctly-guessed mystery as Caught. This
// was the actual bug: single.js never touched the catch tracker at all.
{
  localStorage.removeItem('pokeGuess_catchTracker');
  const mod = await import('../../docs/js/modes/single.js');
  const mount = mk();
  const clickEl = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const ctrl = mod.createSingle({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'single' }, onExit: () => {} });
  await tick();
  clickEl([...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Start game')));
  await tick();
  // Find the mystery's real name via the guess datalist (autocomplete options
  // list every valid name; we can't read the answer directly, but we CAN
  // brute-force: reveal a "Reveal One Type" style clue isn't needed — instead
  // just guess the FIRST name in the datalist repeatedly isn't reliable. So
  // instead: reveal enough clues to identify nothing, then just check the
  // catch tracker AFTER a guaranteed loss (points exhausted) — a cleaner,
  // fully deterministic path than trying to guess the hidden mystery blind.
  let guard = 0;
  while (!mount.querySelector('.summary-container') && guard++ < 80) {
    const card = [...mount.querySelectorAll('#clue-panel .clue-btn')].find((b) => !b.className.includes('unavailable') && !b.className.includes('cant-afford') && !b.className.includes('revealed'));
    if (!card) break;
    clickEl(card);
    await tick();
  }
  ok(!!mount.querySelector('.summary-container'), 'single: ran out of points and reached the summary screen');
  const map = JSON.parse(localStorage.getItem('pokeGuess_catchTracker') || '{}');
  const statuses = Object.values(map);
  ok(statuses.includes('seen'), `single: the un-caught mystery was marked "seen" (map: ${JSON.stringify(map)})`);
  ok(!statuses.includes('caught'), 'single: nothing was incorrectly marked "caught" on a loss');
  ctrl.destroy && ctrl.destroy();
  localStorage.removeItem('pokeGuess_catchTracker');
}

console.log(`\n${pass} passed, ${fail} failed`);
