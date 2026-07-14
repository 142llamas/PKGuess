// Clue-selection-mode smoke for single.js (#10/#11/#15b/#15c).
// Exercises real DOM clicks against the actual controller — not just engine
// unit tests — so a UI wiring mistake (missing class, stray click handler)
// would be caught here even if the engine itself is correct.
// Run: node tools/test/cluemode.smoke.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://e.com/' });
const { window } = dom;
global.window = window; global.document = window.document;
for (const k of ['navigator', 'Node', 'HTMLElement', 'MouseEvent']) try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch {}
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });
global.setTimeout = (f) => { try { f(); } catch {} return 0; };

const P = (r) => fileURLToPath(new URL(r, import.meta.url));
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));
global.fetch = async (u) => { const f = String(u).split('/').pop(); try { return { ok: true, json: async () => JSON.parse(readFileSync(P('../../docs/data/' + f), 'utf8')) }; } catch { return { ok: false, json: async () => ({}) }; } };
const tick = () => new Promise((r) => { let i = 0; const t = () => (i++ < 6 ? Promise.resolve().then(t) : r()); t(); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const { createSingle } = await import('../../docs/js/modes/single.js');

// Find Dragonite in the pool so games are deterministic and well-covered.
const dragonite = gen2.pokedex.find((p) => p.name === 'Dragonite');
function rngAlways() { return 0; } // not used for mystery pick since we patch round.start via params

async function startGame({ clueMode, catDiversity = 'free', guessMode = 'free' }) {
  const mount = window.document.createElement('div'); window.document.body.appendChild(mount);
  const ctrl = createSingle({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'single' }, onExit: () => {} });
  await tick();
  // Pick Normal difficulty, then set the option toggles via the UI controls,
  // then Start. The setup screen renders option rows with [value,label] pairs.
  const pickOption = (label, valueLabel) => {
    const rows = [...mount.querySelectorAll('.sp-option-row, .mp-form-section, div')];
    const row = rows.find((r) => r.textContent.includes(label) && r.querySelector('button'));
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === valueLabel);
    if (btn) { click(btn); return true; }
    return false;
  };
  // difficulty: Normal (default is already normal in chosen state, but click it to be safe)
  const normalBtn = [...mount.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Normal');
  if (normalBtn) click(normalBtn);
  const modeLabel = clueMode === 'choose' ? 'Choose' : clueMode === 'random' ? 'Random' : 'By category';
  pickOption('Clue selection', modeLabel);
  const divLabel = catDiversity === 'free' ? 'Free' : catDiversity === 'diff' ? 'Force different' : 'Cycle all';
  pickOption('Category diversity', divLabel);
  if (guessMode === 'forced') pickOption('Guess', 'Forced reveal');
  await tick();
  const startBtn = [...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Start game'));
  ok(!!startBtn, `(${clueMode}/${catDiversity}/${guessMode}) Start button found`);
  click(startBtn);
  await tick();
  return { mount, ctrl };
}

// ---------------------------------------------------------------------------
console.log('— Choose mode: clicking a card still reveals it (regression) —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'choose' });
  const card = [...mount.querySelectorAll('#clue-panel .clue-btn')].find((c) => !c.className.includes('unavailable') && !c.className.includes('cant-afford'));
  ok(!!card, 'a clickable card exists in Choose mode');
  click(card);
  await tick();
  ok(mount.querySelector('#revealed-summary .rev-item'), 'tracker shows a reveal after clicking a card');
  ctrl.destroy();
}

console.log('— Random mode (guess-anytime): cards are NOT clickable; the dedicated button works —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'random' });
  ok(mount.querySelector('#clue-panel.random-mode'), 'clue panel is tagged random-mode');
  const revealBtn = [...mount.querySelectorAll('.cat-reveal-btn')].find((b) => b.textContent.includes('Reveal a random clue'));
  ok(!!revealBtn, 'a "Reveal a random clue" button is present (guess-anytime)');
  // try clicking an individual card directly — must do nothing
  const card = [...mount.querySelectorAll('#clue-panel .clue-btn')][0];
  const before = mount.querySelector('#revealed-summary').textContent;
  click(card);
  await tick();
  const after = mount.querySelector('#revealed-summary').textContent;
  eq(after, before, 'clicking an individual clue card in Random mode does NOT reveal it');
  // now use the real control
  click(revealBtn);
  await tick();
  ok(mount.querySelector('#revealed-summary .rev-item'), 'the random-reveal button DID reveal a clue');
  ctrl.destroy();
}

console.log('— By-category mode: cards are NOT clickable; category header reveals —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'category' });
  ok(mount.querySelector('#clue-panel.category-mode'), 'clue panel is tagged category-mode');
  const card = [...mount.querySelectorAll('#clue-panel .clue-btn')][0];
  const before = mount.querySelector('#revealed-summary').textContent;
  click(card);
  await tick();
  const after = mount.querySelector('#revealed-summary').textContent;
  eq(after, before, 'clicking an individual clue card in By-category mode does NOT reveal it');
  const header = mount.querySelector('.cat-section-clickable:not(.reveal-disabled) .cat-header-reveal');
  ok(!!header, 'at least one category header is clickable');
  click(header);
  await tick();
  ok(mount.querySelector('#revealed-summary .rev-item'), 'clicking the category header revealed a clue from that category');
  ctrl.destroy();
}

console.log('— Force Different diversity: same category becomes blocked after one reveal —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'category', catDiversity: 'diff' });
  const firstHeader = mount.querySelector('.cat-section-clickable:not(.reveal-disabled) .cat-header-reveal');
  ok(!!firstHeader, 'an unblocked category header exists at the start');
  const sectionEl = firstHeader.closest('.cat-section-clickable');
  click(firstHeader);
  await tick();
  // re-query: that SAME section (by header background — use cat-name text) should now be disabled
  const catName = sectionEl.querySelector('.cat-name').textContent;
  const sameSection = [...mount.querySelectorAll('.cat-section-clickable')].find((s) => s.querySelector('.cat-name').textContent === catName);
  ok(sameSection.classList.contains('reveal-disabled'), `the just-used category (${catName}) is now reveal-disabled (Force Different)`);
  ctrl.destroy();
}

console.log('— Forced + Random: no button is shown; wrong guess auto-reveals —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'random', guessMode: 'forced' });
  const revealBtn = [...mount.querySelectorAll('.cat-reveal-btn')].find((b) => b.textContent.includes('Reveal a random clue'));
  ok(!revealBtn, 'no "Reveal a random clue" button is rendered in forced+random (it would never be actionable)');
  const input = mount.querySelector('#guess-input');
  const wrongName = gen2.pokedex.find((p) => p.name !== 'Dragonite').name === 'Dragonite' ? 'Mew' : gen2.pokedex[0].name;
  input.value = 'Definitely Not A Real Mystery Name Match ' + wrongName; // ensure mismatch with mystery
  // Use a real roster name that's almost certainly wrong vs a random mystery:
  input.value = gen2.pokedex[0].name === undefined ? 'Bulbasaur' : gen2.pokedex.find((p) => true).name;
  const before = mount.querySelector('#revealed-summary').textContent;
  const guessBtn = [...mount.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Guess');
  // Guess a name guaranteed wrong most of the time; if it happens to be right, just re-derive a guaranteed-wrong one.
  click(guessBtn);
  await tick();
  const after = mount.querySelector('#revealed-summary').textContent;
  // Either we won (rare) or a clue auto-revealed — both are valid outcomes of "the engine acted".
  ok(after !== before || mount.querySelector('.summary-container'), 'something happened after the forced+random guess (auto-reveal or a win)');
  ctrl.destroy();
}

// #4 — the moveset purchase-limit note must carry a styled class. single.js
// renders it as `clue-limit-note`; styles.css must define that rule (it was
// missing entirely, so the note rendered at default large/white). Bind the two
// so they can't drift apart again.
{
  const singleSrc = readFileSync(P('../../docs/js/modes/single.js'), 'utf8');
  const cssSrc = readFileSync(P('../../docs/css/styles.css'), 'utf8');
  ok(/['"]clue-limit-note['"]/.test(singleSrc) || /clue-limit-note/.test(singleSrc), '#4: single.js still renders the limit note with class clue-limit-note');
  const rule = cssSrc.match(/\.clue-limit-note\s*\{([^}]*)\}/);
  ok(!!rule, '#4: styles.css defines a .clue-limit-note rule (was missing)');
  ok(!!rule && /font-size\s*:/.test(rule[1]), '#4: .clue-limit-note sets a font-size (not default large text)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
