// Clue-selection-mode smoke for multiplayer.js hotseat (#10/#11/#15b/#15c).
// Run: node tools/test/mp-cluemode.smoke.mjs
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

const { createMultiplayer } = await import('../../docs/js/modes/multiplayer.js');

async function startGame({ clueMode, catDiversity = 'free' }) {
  const mount = window.document.createElement('div'); window.document.body.appendChild(mount);
  const ctrl = createMultiplayer({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'multiplayer' }, onExit: () => {} });
  await tick();
  const pickToggle = (label, valueLabel) => {
    const rows = [...mount.querySelectorAll('.mp-form-section')];
    const row = rows.find((r) => r.textContent.includes(label));
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes(valueLabel));
    if (btn) { click(btn); return true; }
    return false;
  };
  const modeLabel = clueMode === 'choose' ? 'Choose Clues' : clueMode === 'random' ? 'Random Clues' : 'By Category';
  ok(pickToggle('Clue Selection', modeLabel), `picked clue mode ${clueMode}`);
  const divLabel = catDiversity === 'free' ? 'Free Choice' : catDiversity === 'diff' ? 'Force Different' : 'Cycle All';
  ok(pickToggle('Category Diversity', divLabel), `picked diversity ${catDiversity}`);
  await tick();
  const startBtn = [...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Start Multiplayer'));
  ok(!!startBtn, 'Start Multiplayer button found');
  click(startBtn);
  await tick();
  return { mount, ctrl };
}

console.log('— Choose mode: clicking a card still reveals it (regression) —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'choose' });
  ok(mount.querySelector('#mp-clue-panel'), 'clue panel rendered');
  const card = [...mount.querySelectorAll('#mp-clue-panel .clue-btn')].find((c) => !c.className.includes('unavailable') && !c.className.includes('cant-afford'));
  ok(!!card, 'a clickable card exists in Choose mode');
  const before = mount.querySelector('#mp-revealed')?.textContent ?? '';
  click(card);
  await tick();
  const panelText = mount.querySelector('#mp-clue-panel').textContent;
  ok(panelText.includes('revealed') || [...mount.querySelectorAll('.clue-btn.revealed')].length > 0, 'a card shows as revealed after clicking (Choose mode still works)');
  ctrl.destroy();
}

console.log('— Random mode: cards are NOT clickable; the dedicated button works —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'random' });
  ok(mount.querySelector('#mp-clue-panel.random-mode'), 'clue panel is tagged random-mode');
  const revealBtn = [...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Reveal a random clue'));
  ok(!!revealBtn, 'a "Reveal a random clue" button is present');
  const revealedBefore = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  const card = [...mount.querySelectorAll('#mp-clue-panel .clue-btn')].find((c) => !c.className.includes('revealed'));
  click(card);
  await tick();
  const revealedAfterCardClick = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  eq(revealedAfterCardClick, revealedBefore, 'clicking an individual clue card in Random mode does NOT reveal it');
  click(revealBtn);
  await tick();
  const revealedAfterButton = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  ok(revealedAfterButton > revealedBefore, 'the random-reveal button DID reveal a clue');
  ctrl.destroy();
}

console.log('— By-category mode: cards are NOT clickable; category header reveals —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'category' });
  ok(mount.querySelector('#mp-clue-panel.category-mode'), 'clue panel is tagged category-mode');
  const revealedBefore = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  const card = [...mount.querySelectorAll('#mp-clue-panel .clue-btn')].find((c) => !c.className.includes('revealed'));
  click(card);
  await tick();
  const revealedAfterCardClick = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  eq(revealedAfterCardClick, revealedBefore, 'clicking an individual clue card in By-category mode does NOT reveal it');
  const header = mount.querySelector('.cat-section-clickable:not(.reveal-disabled) .cat-header-reveal');
  ok(!!header, 'at least one category header is clickable');
  click(header);
  await tick();
  const revealedAfterHeader = [...mount.querySelectorAll('.clue-btn.revealed')].length;
  ok(revealedAfterHeader > revealedBefore, 'clicking the category header revealed a clue');
  ctrl.destroy();
}

console.log('— Force Different diversity: same category becomes blocked after one reveal —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'category', catDiversity: 'diff' });
  const firstHeader = mount.querySelector('.cat-section-clickable:not(.reveal-disabled) .cat-header-reveal');
  ok(!!firstHeader, 'an unblocked category header exists at the start');
  const catName = firstHeader.closest('.cat-section-clickable').querySelector('.cat-name').textContent;
  click(firstHeader);
  await tick();
  const sameSection = [...mount.querySelectorAll('.cat-section-clickable')].find((s) => s.querySelector('.cat-name').textContent === catName);
  ok(sameSection.classList.contains('reveal-disabled'), `the just-used category (${catName}) is now reveal-disabled (Force Different)`);
  ctrl.destroy();
}

console.log('— Choose mode + Cycle All: a 2nd clue from an already-visited category is blocked —');
{
  const { mount, ctrl } = await startGame({ clueMode: 'choose', catDiversity: 'cycle' });
  const cards = [...mount.querySelectorAll('#mp-clue-panel .clue-btn')].filter((c) => !c.className.includes('unavailable') && !c.className.includes('cant-afford'));
  ok(cards.length > 0, 'at least one clue is revealable at the start');
  const first = cards[0];
  const catSection = first.closest('.cat-section');
  click(first);
  await tick();
  // find another clue in the SAME category section that is still selectable
  const sameSection = [...mount.querySelectorAll('.cat-section')].find((s) => s.querySelector('.cat-name')?.textContent === catSection.querySelector('.cat-name')?.textContent);
  const secondInSameCat = sameSection ? [...sameSection.querySelectorAll('.clue-btn')].find((c) => !c.className.includes('revealed') && !c.className.includes('unavailable') && !c.className.includes('cant-afford')) : null;
  ok(!secondInSameCat, 'no other clue in the SAME category is clickable right after the first reveal (Cycle All enforced on manual clicks)');
  ctrl.destroy();
}

console.log('— Multi-use clue re-offer: a multi-use clue survives its first reveal and shows history (flagged finding) —');
{
  // Deterministic rng()=>0 always picks the LOWEST-id currently-eligible
  // candidate, so single-use clues get exhausted in id order and the walk
  // eventually parks on a multi-use clue (id 13, "Reveal One Weakness",
  // maxUses 6) for several consecutive picks before moving on — proving it's
  // genuinely re-offered rather than vanishing after its first use.
  const mount = window.document.createElement('div'); window.document.body.appendChild(mount);
  const ctrl = createMultiplayer({ mount, config: {}, data: gen2, params: { gen: 2, modeId: 'multiplayer', rng: () => 0 }, onExit: () => {} });
  await tick();
  const rows = [...mount.querySelectorAll('.mp-form-section')];
  const clueRow = rows.find((r) => r.textContent.includes('Clue Selection'));
  click([...clueRow.querySelectorAll('button')].find((b) => b.textContent.includes('Random Clues')));
  const modeRow = rows.find((r) => r.textContent.includes('Guess') && r.querySelector('button'));
  const gtrBtn = modeRow ? [...modeRow.querySelectorAll('button')].find((b) => b.textContent.includes('Guess, then Reveal')) : null;
  ok(!!gtrBtn, 'GTR (Guess, then Reveal) option found');
  click(gtrBtn);
  await tick();
  click([...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Start Multiplayer')));
  await tick();
  // GTR starts in the guess phase; one wrong guess flips into the reveal
  // phase, where it stays for repeated reveals without forcing another guess.
  const gi = mount.querySelector('#mp-guess');
  if (gi) gi.value = 'Definitely-Not-The-Mystery-Xyzzy';
  click([...mount.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Guess'));
  await tick();
  let sawMultiUseHistory = false, sawUseBadge = false;
  for (let i = 0; i < 20; i++) {
    const btn = [...mount.querySelectorAll('button')].find((b) => b.textContent.includes('Reveal a random clue'));
    if (!btn) break;
    click(btn);
    await tick();
    if ([...mount.querySelectorAll('.clue-btn')].some((c) => c.querySelectorAll('.clue-revealed-value').length >= 2)) sawMultiUseHistory = true;
    if (mount.querySelector('.clue-use-badge')) sawUseBadge = true;
  }
  // Checked DURING the sequence, not just at the end — once a multi-use clue
  // is fully exhausted its card collapses to showing only the last value
  // (matching single.js's own established convention for exhausted clues),
  // so the multi-reveal moment must be caught while it's still happening.
  ok(sawMultiUseHistory, 'at some point during repeated random picks, a card showed 2+ reveal values (re-offered, not vanished after 1 use)');
  ok(sawUseBadge, 'a re-offered multi-use card showed a "use N" badge at some point');
  ctrl.destroy();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
