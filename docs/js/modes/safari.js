/**
 * @file        js/modes/safari.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Safari Zone, ported from the canonical screen. A SHARED point budget
 *           carries across a shuffled pool of every Pokémon (no replacement).
 *           Each Pokémon: two free starting clues (Generation + BST Range), buy
 *           more clues from the shared budget, then guess. Catch it → score++ and
 *           move on with the remaining budget; wrong guess costs 1; "bait" reveals
 *           a random clue (at its cost); "run" skips to the next. Ends when the
 *           budget hits 0 or the pool is exhausted. Score = Pokémon caught. All
 *           clue rules come from engine.js; this file only drives the screen.
 *
 * Contract: createSafari({ mount, config, data, params, onExit }) → { destroy }
 */

import { el, clear } from '../lib/dom.js';
import { PokeGuessRound, normalizeName } from '../lib/engine.js';
import { submitScore } from '../lib/leaderboard-data.js';

const CATCH_KEY = 'pokeGuess_catchTracker';

export function createSafari({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'sp-content' });
  clear(mount).appendChild(root);

  if (!Array.isArray(data.clues) || !data.clues.length || !Array.isArray(data.categories) || !data.categories.length) {
    root.append(
      el('h2', { class: 'sp-section-title' }, 'Data needs updating'),
      el('p', { class: 'placeholder-text' }, `This generation's data file is missing its clue configuration. Re-run the pipeline and re-upload docs/data/${data.id || 'genN'}.json.`),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
    return { destroy() { clear(mount); } };
  }

  const cats = data.categories;
  const clues = data.clues;
  const rng = params.rng || Math.random;
  const round = new PokeGuessRound({ genData: data, movelist: {}, rng });
  const genClueId = (clues.find((c) => c.special === 'generation') || {}).id;
  const bstClueId = (clues.find((c) => c.field === 'bstRange') || {}).id;
  const poolFilter = data.id === 'gen1' ? 'gen1' : data.id === 'gen2' ? 'gen2' : 'both';

  let movelist = {};
  let sf = null; // { startPts, budget, pool, idx, caught }
  let acIndex = -1;

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; round.movelist = movelist; })
    .catch(() => { movelist = {}; })
    .finally(showConfig);

  // ---- catch tracker (shared with Pokédex) --------------------------------
  function markCatch(name, status) {
    try { const d = JSON.parse(localStorage.getItem(CATCH_KEY) || '{}'); d[name.toLowerCase()] = status; localStorage.setItem(CATCH_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  }

  // ---- config -------------------------------------------------------------
  function showConfig() {
    clear(root).append(
      el('div', { class: 'sp-section-title' }, '\uD83C\uDF3F Safari Zone'),
      el('p', { class: 'sf-intro' }, 'One shared point budget across many Pok\u00e9mon. Spend wisely \u2014 your score is how many you catch before the points run out.'),
      el('div', { class: 'sp-custom-panel' },
        el('label', { class: 'sp-custom-field' }, 'Starting budget',
          el('input', { type: 'number', id: 'sf-start-pts', value: '200', min: '50', max: '999' }))),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-primary', onClick: begin }, 'Enter the Safari \u25b6')),
    );
  }

  function begin() {
    const startPts = clampInt(root.querySelector('#sf-start-pts')?.value, 50, 999, 200);
    const pool = shuffle(data.pokedex.filter((p) => {
      const n = parseInt(p.num, 10);
      return poolFilter === 'gen1' ? n <= 151 : poolFilter === 'gen2' ? (n >= 152 && n <= 251) : true;
    }));
    sf = { startPts, budget: startPts, pool, idx: 0, caught: 0 };
    nextMon();
  }

  // ---- per-Pokémon round --------------------------------------------------
  function nextMon() {
    if (!sf) return;
    if (sf.idx >= sf.pool.length || sf.budget <= 0) { endGame(); return; }
    const poke = sf.pool[sf.idx++];
    round.start({
      difficultyId: 'custom', poolFilter, mystery: poke,
      custom: { points: sf.budget, guessCost: 1, startClueMode: 'custom' },
      startClueIds: [genClueId, bstClueId].filter((x) => x != null),
    });
    acIndex = -1;
    showGame();
  }

  function showGame() {
    clear(root).append(
      el('div', { class: 'game-topbar' },
        el('button', { class: 'btn-secondary game-exit', onClick: () => onExit && onExit() }, '\u2190 Quit'),
        el('div', { class: 'sf-counters' },
          el('div', { class: 'points-display' },
            el('div', { class: 'points-number', id: 'sf-pts' }, `${round.pointsRemaining} pts`),
            el('div', { class: 'points-bar-track' }, el('div', { class: 'points-bar-fill', id: 'sf-bar' }))),
          el('div', { class: 'sf-caught' }, '\uD83C\uDFC6 ', el('span', { id: 'sf-caught' }, String(sf.caught)), ' caught'))),
      el('div', { class: 'game-body' },
        el('div', { class: 'clue-panel', id: 'sf-clue-panel' }),
        el('div', { class: 'game-side' },
          el('div', { class: 'guess-block' },
            el('div', { class: 'guess-input-wrap' },
              el('input', { class: 'guess-input', id: 'sf-guess', type: 'text', placeholder: 'Which Pok\u00e9mon is it?', autocomplete: 'off', onInput: (e) => renderAuto(e.target.value), onKeydown: onGuessKey }),
              el('button', { class: 'guess-btn', onClick: submitFromInput }, 'Catch'),
              el('div', { class: 'autocomplete-list', id: 'sf-ac' })),
            el('div', { class: 'sf-actions' },
              el('button', { class: 'btn-bait', onClick: throwBait }, '\uD83C\uDF6F Bait (reveal a random clue)'),
              el('button', { class: 'btn-run', onClick: run }, '\uD83D\uDC5F Run')),
            el('div', { class: 'guess-feedback', id: 'sf-feedback' })))),
    );
    renderClues();
    updateBudget();
  }

  function updateBudget() {
    const num = root.querySelector('#sf-pts'); const bar = root.querySelector('#sf-bar');
    if (num) num.textContent = `${round.pointsRemaining} pts`;
    if (bar) {
      const pct = sf.startPts > 0 ? round.pointsRemaining / sf.startPts : 0;
      bar.style.width = `${Math.max(0, Math.min(100, pct * 100))}%`;
      bar.style.background = pct > 0.5 ? '#29cc66' : pct > 0.25 ? '#f0c020' : '#e04040';
    }
    const c = root.querySelector('#sf-caught'); if (c) c.textContent = String(sf.caught);
  }

  // ---- clue grid (no difficulty locks in Safari) --------------------------
  function dynamicColor(cost) {
    const costs = clues.map((c) => round.clueCurrentCost(c.id));
    const lo = Math.min(...costs), hi = Math.max(...costs);
    if (hi === lo) return 'hsl(200,60%,42%)';
    const t = Math.max(0, Math.min(1, (cost - lo) / (hi - lo)));
    return `hsl(${Math.round(120 * (1 - t))},${62 + Math.round(18 * Math.abs(t - 0.5) * 2)}%,${40 + Math.round(6 * (1 - Math.abs(t - 0.5) * 2))}%)`;
  }

  function renderClues() {
    const panel = root.querySelector('#sf-clue-panel');
    if (!panel) return;
    clear(panel);
    for (const cat of cats) {
      const body = el('div', { class: 'cat-body' });
      for (const clue of clues.filter((c) => c.cat === cat.id)) body.appendChild(renderCard(clue, cat));
      if (body.children.length) {
        panel.appendChild(el('div', { class: 'cat-section' },
          el('div', { class: 'cat-header', style: { background: cat.bg } }, el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
          body));
      }
    }
  }

  function renderCard(clue, cat) {
    const s = round.state;
    const hist = s.clueHistory[clue.id] || [];
    const isRevealed = clue.id in s.revealedClues;
    const isMulti = clue.maxUses !== 1 || clue.costIncrement > 0;
    const cost = round.clueCurrentCost(clue.id);
    const card = el('button', { class: 'clue-btn', dataset: { clue: clue.id } });

    if (isRevealed && !isMulti) {
      card.classList.add('revealed');
      Object.assign(card.style, { background: cat.bg, borderColor: cat.color });
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name', style: { color: cat.color } }, clue.name)),
        el('div', { class: 'clue-revealed-value' }, String(s.revealedClues[clue.id])));
      return card;
    }
    if (round.clueExhausted(clue)) {
      card.classList.add('unavailable');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name)),
        el('div', { class: 'clue-unavail-note' }, '\u2717 ' + (hist[hist.length - 1] || 'Exhausted')));
      return card;
    }
    if (!round.clueAvailable(clue) || (clue.requiresClueId != null && !(clue.requiresClueId in s.revealedClues))) {
      card.classList.add('unavailable');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name)),
        el('div', { class: 'clue-unavail-note' }, 'Not available'));
      return card;
    }
    if (round.pointsRemaining < cost) card.classList.add('cant-afford');
    if (isMulti && hist.length) { card.classList.add('revealed'); Object.assign(card.style, { background: cat.bg, borderColor: cat.color }); }
    card.append(el('div', { class: 'clue-top' },
      el('span', { class: 'clue-btn-name', style: isMulti && hist.length ? { color: cat.color } : {} }, clue.name),
      el('span', { class: 'clue-cost-badge', style: { background: dynamicColor(cost) } }, `${cost}pt${cost !== 1 ? 's' : ''}`)));
    for (let i = 0; i < hist.length; i++) card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } }, (i ? `#${i + 1} ` : '') + hist[i]));
    card.addEventListener('click', () => buy(clue.id));
    return card;
  }

  function buy(id) {
    const res = round.buyClue(id);
    if (!res.ok) return;
    afterSpend();
  }
  function throwBait() {
    const affordable = clues.filter((c) => round.clueAvailable(c) && round.clueCurrentCost(c.id) > 0 && round.pointsRemaining >= round.clueCurrentCost(c.id));
    if (!affordable.length) { feedback('No clues you can afford right now.', '#e06060'); return; }
    const c = affordable[Math.floor(rng() * affordable.length)];
    if (round.buyClue(c.id).ok) afterSpend();
  }
  function afterSpend() {
    renderClues();
    updateBudget();
    sf.budget = round.pointsRemaining;
    if (round.gameOver || round.pointsRemaining <= 0) endGame();
  }

  function run() {
    if (!sf || round.gameOver) return;
    markCatch(round.mystery.name, 'seen');
    feedback(`You ran! It was ${round.mystery.name}.`, '#e0a060');
    setTimeout(() => { if (sf) nextMon(); }, 1000);
  }

  // ---- guessing -----------------------------------------------------------
  function submitFromInput() { const i = root.querySelector('#sf-guess'); if (i) doGuess(i.value); }
  function doGuess(name) {
    closeAuto();
    const val = String(name || '').trim();
    if (!val) return;
    if (normalizeName(val) === normalizeName(round.mystery.name)) {
      sf.caught++;
      markCatch(round.mystery.name, 'caught');
      sf.budget = round.pointsRemaining;
      feedback(`\u2705 Caught ${round.mystery.name}!`, '#50cc80');
      updateBudget();
      setTimeout(() => { if (sf) nextMon(); }, 850);
      return;
    }
    // wrong: engine deducts the 1-pt guess cost (and ends the round if it hits 0)
    round.submitGuess(val);
    sf.budget = round.pointsRemaining;
    const i = root.querySelector('#sf-guess'); if (i) i.value = '';
    feedback('\u274C Not quite!', '#e06060');
    renderClues();
    updateBudget();
    if (round.gameOver || round.pointsRemaining <= 0) endGame();
  }
  function feedback(msg, color) { const f = root.querySelector('#sf-feedback'); if (f) { f.textContent = msg; f.style.color = color; } }

  // ---- autocomplete -------------------------------------------------------
  function renderAuto(q) {
    const list = root.querySelector('#sf-ac'); if (!list) return;
    const query = normalizeName(q);
    if (!query) { closeAuto(); return; }
    const matches = round.allNames.filter((n) => n.toLowerCase().includes(query)).slice(0, 10);
    if (!matches.length) { closeAuto(); return; }
    acIndex = -1; clear(list);
    matches.forEach((n) => list.appendChild(el('div', { class: 'ac-item', dataset: { name: n }, onClick: () => doGuess(n) }, n)));
    list.classList.add('open');
  }
  function onGuessKey(e) {
    const list = root.querySelector('#sf-ac'); const items = list ? [...list.querySelectorAll('.ac-item')] : [];
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, -1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (acIndex >= 0 && items[acIndex]) doGuess(items[acIndex].dataset.name); else submitFromInput(); }
    else if (e.key === 'Escape') closeAuto();
  }
  function closeAuto() { const list = root.querySelector('#sf-ac'); if (list) { list.classList.remove('open'); clear(list); } acIndex = -1; }

  // ---- summary ------------------------------------------------------------
  function endGame() {
    if (!sf) return;
    const exhausted = sf.idx >= sf.pool.length && round.pointsRemaining > 0;
    if (round.mystery && !round.gameOver) markCatch(round.mystery.name, 'seen');
    // Submit to leaderboard
    const gen = data.id || 'gen2';
    submitScore(gen, 'safari', { score: done.caught, detail: `budget:${done.startPts} spent:${ptsUsed}` }).catch(() => {});
    const ptsUsed = sf.startPts - round.pointsRemaining;
    const eff = sf.startPts > 0 ? (sf.caught / sf.startPts * 100).toFixed(1) : '0';
    const done = sf; sf = null;
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' }, el('div', { class: 'summary-result' }, '\uD83C\uDF3F Safari complete')),
          el('p', { class: 'sf-intro' }, exhausted ? 'You caught everything in the pool!' : 'You ran out of points.'),
          el('div', { class: 'stats-grid' },
            stat(done.caught, 'Caught'), stat(done.startPts, 'Budget'), stat(ptsUsed, 'Spent'), stat(`${eff}%`, 'Per 100 pts')),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showConfig }, 'Play again'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));
    function stat(v, l) { return el('div', { class: 'stat-box' }, el('div', { class: 'sval' }, String(v)), el('div', { class: 'sname' }, l)); }
  }

  // ---- utils --------------------------------------------------------------
  function clampInt(v, lo, hi, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
  function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
  const onDocClick = (e) => { if (!e.target.closest('.guess-input-wrap')) closeAuto(); };
  document.addEventListener('click', onDocClick);

  return { destroy() { document.removeEventListener('click', onDocClick); sf = null; clear(mount); } };
}

export default createSafari;
