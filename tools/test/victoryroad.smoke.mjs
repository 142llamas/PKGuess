// Victory Road #6 smoke test: tier thresholds shifted +1, habitat/firstAnime
// extended, "Has an Immunity" added (and correctly ORDERED before the type
// reveals so the engine's own cross-inference doesn't lock it out), combined
// weakness/resistance reveal with a tier-dependent total cap, and the three
// display consolidations (types on one line, egg moves in one chip, weakness/
// resistance in one differentiated chip).
//
// Run: node tools/test/victoryroad.smoke.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const P = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://e.com/' });
const { window } = dom;
global.window = window; global.document = window.document;
for (const k of ['navigator', 'Node', 'HTMLElement', 'MouseEvent']) {
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch {}
}
global.fetch = async (u) => {
  try { return { ok: true, json: async () => JSON.parse(readFileSync(P('../../docs/' + u), 'utf8')) }; }
  catch { return { ok: false, json: async () => ({}) }; }
};
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

const { createVictoryRoad } = await import('../../docs/js/modes/victoryroad.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelectorAll(s);
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const chipText = (label) => [...q('.vr-clue-chip')].find((c) => c.querySelector('.vr-chip-label')?.textContent === label)?.textContent || null;

// Deterministic mystery order: rng:()=>0 makes the Fisher-Yates shuffle in
// victoryroad.js fully predictable, so we can know exactly what to guess at
// every step without ever reading the "hidden" mystery out of internal state.
function shuffleZero(arr) {
  const b = arr.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = 0; [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
const order = shuffleZero(gen2.pokedex);

const mount = document.getElementById('app');
const ctrl = createVictoryRoad({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'victoryroad', rng: () => 0 }, onExit: () => {} });
await wait(50);

console.log('\n— Tier preview (pre-game config screen) reflects the #6 rework, including the weakness/resistance special case —');
{
  const tierRows = [...q('.vr-tier-row')];
  eq(tierRows.length, 8, 'all 8 tiers are listed in the preview');
  const openTier = (label) => {
    const row = tierRows.find((r) => r.querySelector('.vr-tier-label')?.textContent === label);
    click(row);
    return row.nextSibling;
  };
  const tagsOf = (detail) => [...detail.querySelectorAll('.vr-tier-clue-tag')].map((t) => t.textContent);

  const t1 = openTier('Tier 1');
  ok(tagsOf(t1).includes('Has an Immunity'), 'Tier 1 preview includes "Has an Immunity" (#6b addition)');
  ok(!tagsOf(t1).some((t) => t.startsWith('Weakness/Resistance')), 'Tier 1 preview correctly has NO weakness/resistance entry (only Tiers 3\u20138 have it)');

  const t3 = openTier('Tier 3');
  ok(tagsOf(t3).includes('Weakness/Resistance (up to 6)'), '#6b: Tier 3 preview shows the combined weakness/resistance reveal, with the correct cap \u2014 this was previously invisible entirely since weakResistCap isn\u2019t a plain slot');
  const t3Row = tierRows.find((r) => r.querySelector('.vr-tier-label')?.textContent === 'Tier 3');
  eq(t3Row.querySelector('.vr-tier-slots')?.textContent, '11 clues', 'Tier 3\u2019s summary count includes the weakness/resistance entry (10 slots + 1)');

  const t8 = openTier('Tier 8');
  ok(tagsOf(t8).includes('Weakness/Resistance (up to 1)'), 'Tier 8 preview shows the correct (smallest) cap');

  const t7 = openTier('Tier 7');
  ok(tagsOf(t7).includes('Highest Base Stat') && tagsOf(t7).includes('Lowest Base Stat'), 'Tier 7 preview includes the no-value Highest/Lowest Base Stat clues (#6b addition)');
  ok(tagsOf(t7).includes('Weakness/Resistance (up to 2)'), 'Tier 7 preview also shows its weakness/resistance entry');
}

click([...q('button')].find((b) => b.textContent.includes('Enter Victory Road')));
await wait(50);

console.log('\n— #6a: Tier 1 covers streak 0 through 5 (up to 5, was up to 4) —');
{
  eq(document.querySelector('#vr-tier')?.textContent, 'Tier 1', 'starts on Tier 1');
}

console.log('\n— #6b: Tier 1 pre-reveals "Has an Immunity" (new) — correctly ordered before types —');
{
  ok(!!chipText('Has an Immunity'), '#6b: "Has an Immunity" clue is pre-revealed in Tier 1 (was locked out before the slot-order fix)');
}

console.log('\n— #6i: the two types render as ONE chip, on one line —');
{
  const typeChips = [...q('.vr-clue-chip')].filter((c) => c.querySelector('.vr-chip-label')?.textContent === 'Type');
  eq(typeChips.length, 1, '#6i: exactly one "Type" chip (not two separate ones)');
  const txt = typeChips[0]?.textContent || '';
  ok(!!txt, 'the merged Type chip has content');
}

console.log('\n— #6ii: egg moves render as ONE chip listing every value —');
{
  const eggChips = [...q('.vr-clue-chip')].filter((c) => /^Egg Move/.test(c.querySelector('.vr-chip-label')?.textContent || ''));
  ok(eggChips.length <= 1, `#6ii: at most one Egg Move(s) chip, not one per move (found ${eggChips.length})`);
}

console.log('\n— No "No more X to reveal" sentinel text ever leaks into the ribbon —');
{
  ok(!document.querySelector('#vr-ribbon').textContent.includes('No more'), 'sentinel text is filtered out of every merged/consolidated chip');
}

// Advance the streak by guessing correctly through the precomputed order,
// far enough to reach Tier 3 (streak >= 11), where weakness/resistance
// reveals (#6b, weakResistCap:6) and the extended habitat/firstAnime (#6b)
// should still or newly apply.
console.log('\n— #6a: advancing to Tier 3 (streak 11) via correct guesses in the precomputed order —');
async function guessCorrect(name) {
  const input = document.querySelector('#vr-guess');
  input.value = name;
  click([...q('button')].find((b) => b.textContent.trim() === 'Guess'));
  await wait(900); // doGuess() waits 850ms (feedback flash) before nextMon()
}
for (let i = 0; i < 11; i++) {
  await guessCorrect(order[i].name);
}
eq(document.querySelector('#vr-streak')?.textContent, '11', 'streak reached 11 after 11 correct guesses');
eq(document.querySelector('#vr-tier')?.textContent, 'Tier 3', '#6a: streak 11 is Tier 3 (Tier 2 covered up to streak 10; Tier 3 starts at 11)');

console.log('\n— #6b: Tier 3 pre-reveals a combined weakness/resistance chip (up to 6 total) —');
{
  const matchupChip = [...q('.vr-clue-chip')].find((c) => c.querySelector('.vr-chip-label')?.textContent === 'Type Matchups');
  ok(!!matchupChip, '#6b: a "Type Matchups" chip is pre-revealed at Tier 3');
  if (matchupChip) {
    const txt = matchupChip.textContent;
    ok(/Weak:|Resist:/.test(txt), '#6iii: the chip differentiates weaknesses from resistances with a clear prefix');
    ok(!txt.includes('No more'), '#6iii: no sentinel leak in the weakness/resistance chip either');
  }
  ok(!!chipText('First Anime Appearance'), '#6b: First Anime Appearance still shown at Tier 3 (extended from Tiers 1\u20132)');
}

console.log('\n— #6a: Tier 1\u2019s boundary is exactly at streak 5\u20136 (one more Pok\u00e9mon than before the fix) —');
{
  // Re-derive independently: start a FRESH session and check the tier right
  // at the boundary streaks, rather than trusting the same running session.
  ctrl.destroy();
  document.getElementById('app').innerHTML = '';
  const ctrl2 = createVictoryRoad({ mount: document.getElementById('app'), config: {}, data: gen2, params: { gen: 2, modeId: 'victoryroad', rng: () => 0 }, onExit: () => {} });
  await wait(50);
  click([...q('button')].find((b) => b.textContent.includes('Enter Victory Road')));
  await wait(50);
  for (let i = 0; i < 5; i++) await guessCorrect(order[i].name); // streak -> 5
  eq(document.querySelector('#vr-streak')?.textContent, '5', 'streak reached 5');
  eq(document.querySelector('#vr-tier')?.textContent, 'Tier 1', '#6a: streak 5 is STILL Tier 1 (the "+1" tier bump)');
  await guessCorrect(order[5].name); // streak -> 6
  eq(document.querySelector('#vr-streak')?.textContent, '6', 'streak reached 6');
  eq(document.querySelector('#vr-tier')?.textContent, 'Tier 2', '#6a: streak 6 is Tier 2 (the boundary)');
  ctrl2.destroy();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
