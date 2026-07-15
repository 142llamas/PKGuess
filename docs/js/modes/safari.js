/**
 * @file        js/modes/safari.js
 * @version     1.5.1
 * @updated     2026-07-14
 * @changelog
 *   1.5.1 — Plays the new "game start" SFX (music.js 2.0.0's
 *           `music.playGameStart()`) when "Enter the Safari Zone" is actually
 *           clicked (begin()) — layered over whatever music is already
 *           playing, not a track change.
 *   1.5.0 — Leaderboard submission now includes the catch-per-100-points
 *           efficiency as a sortable metric (Safari boards rank by it), and
 *           shows it in the detail text.
 *   1.4.0 — Two requested changes:
 *             \u2022 Post-game summary now lists every Caught and Ran From mon
 *               by name (sf.caughtNames/sf.ranNames, tracked alongside the
 *               existing count). Whatever mon was active when the game
 *               ended, if not already recorded as caught or explicitly run
 *               from, now counts as run from too — a wrong guess or clue
 *               purchase that used the last point, not just clicking Run,
 *               shows up in the list.
 *             \u2022 Lowered the starting-budget minimum from 50 to 1 (was
 *               50-999) — avoids needing to document the range anywhere in
 *               the UI, per the simpler of the two options discussed.
 *   1.3.0 — Fixed a real, significant bug: endGame() referenced `done.caught`/
 *           `done.startPts`/`ptsUsed` inside the submitScore() call BEFORE any
 *           of those three were actually declared later in the same function
 *           — a temporal-dead-zone ReferenceError thrown every single time
 *           endGame() ran. This explains three symptoms reported together as
 *           one bug: the game appearing stuck (no crash message visible, but
 *           the summary screen never actually rendered since the exception
 *           happened before clear(root).append(...)), no post-game summary
 *           ever appearing, and the score never reaching the leaderboard
 *           (submitScore() never got called, since the crash happened on
 *           that exact line before the call could execute). Reordered so
 *           `done`/`ptsUsed`/`eff` are computed first. Also added the
 *           requested safeguard: Bait/Rock (the random-clue actions) now
 *           exclude any clue whose cost would leave less than 1 point of the
 *           shared budget, so a random reveal can never zero it out on its
 *           own (manual clue selection is unaffected — only the two random-
 *           reveal actions, matching what was asked for). Also: the "Reveal
 *           Full Stat Spread" clue now shows labeled stats (HP/Atk/Def/...)
 *           via the shared statSpreadEl, matching single.js's post-game
 *           summary and Victory Road's in-game ribbon — was a bare number
 *           string before (found to also affect single.js's and
 *           multiplayer.js's/online.js's own in-game clue displays while
 *           investigating this).
 *   1.2.0 — Catch/Seen now go through the shared lib/catch-tracker.js (#17), same storage key, no data loss.
 *   1.1.0 — Gen 2 mode draws from the full dex (#13).
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

import { el, clear, genBar, statSpreadEl } from '../lib/dom.js';
import { music } from '../lib/music.js';
import { PokeGuessRound, normalizeName, poolFilterForData, matchesPool } from '../lib/engine.js';
import { submitScore } from '../lib/leaderboard-data.js';
import { markCaught, markSeen } from '../lib/catch-tracker.js';

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
  const poolFilter = poolFilterForData(data.id);

  let movelist = {};
  let sf = null; // { startPts, budget, pool, idx, caught }
  let acIndex = -1;

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; round.movelist = movelist; })
    .catch(() => { movelist = {}; })
    .finally(showConfig);

  // ---- config -------------------------------------------------------------
  function showConfig() {
    clear(root).append(
      genBar(params.modeId || 'safari', params.gen || (data.id === 'gen1' ? 1 : 2)),
      el('div', { class: 'sp-section-title' }, '\uD83C\uDF3F Safari Zone'),
      el('p', { class: 'sf-intro' }, 'One shared point budget across many Pok\u00e9mon. Spend wisely \u2014 your score is how many you catch before the points run out.'),
      el('div', { class: 'sp-custom-panel' },
        el('label', { class: 'sp-custom-field' }, 'Starting budget',
          el('input', { type: 'number', id: 'sf-start-pts', value: '200', min: '1', max: '999' }))),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-primary', onClick: begin }, 'Enter the Safari Zone \u25b6')),
    );
  }

  function begin() {
    music.playGameStart(); // "Enter the Safari Zone" was actually clicked
    const startPts = clampInt(root.querySelector('#sf-start-pts')?.value, 1, 999, 200);
    const pool = shuffle(data.pokedex.filter((p) => matchesPool(p.num, poolFilter)));
    sf = { startPts, budget: startPts, pool, idx: 0, caught: 0, caughtNames: [], ranNames: [] };
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
              el('button', { class: 'btn-bait', onClick: throwBait }, '\uD83C\uDF6F Bait (random cheap clue)'),
              el('button', { class: 'btn-rock', onClick: throwRock }, '\uD83E\uDEA8 Rock (random pricey clue)'),
              el('button', { class: 'btn-run', onClick: run }, '\uD83D\uDC5F Run')),
            el('div', { class: 'safari-discount-note' },
              el('div', {}, '\uD83C\uDF6F ', el('b', {}, 'Bait'), ' reveals a random cheap clue (<4 pts) at its normal cost.'),
              el('div', {}, '\uD83E\uDEA8 ', el('b', {}, 'Rock'), ' reveals a random pricey clue (\u22654 pts) at its normal cost.'),
              el('div', {}, '\uD83D\uDC46 ', el('b', {}, 'Choosing a clue yourself costs double'), ' \u2014 pay for the privilege of picking.')),
            el('div', { class: 'guess-feedback', id: 'sf-feedback' }),
            el('div', { class: 'revealed-summary', id: 'sf-revealed' }),
            el('div', { class: 'guess-log', id: 'sf-guesslog' })))),
    );
    renderClues();
    renderRevealed();
    renderGuesses();
    updateBudget();
  }

  // #20 — consolidated revealed-clue list (latest highlighted; resets per mon)
  function renderRevealed() {
    const box = root.querySelector('#sf-revealed'); if (!box) return;
    clear(box);
    const hist = round.state.clueHistory || {};
    const ids = Object.keys(hist).map(Number);
    if (!ids.length) return;
    box.append(el('div', { class: 'rev-head' }, 'Revealed this Pok\u00e9mon'));
    ids.forEach((id) => {
      const c = round.clue(id);
      const vals = hist[id] || [];
      vals.forEach((v, i) => {
        const isLatest = id === round.state.lastRevealedClueId && i === vals.length - 1;
        box.append(el('div', { class: 'rev-item' + (isLatest ? ' rev-new' : '') },
          el('span', { class: 'rev-label' }, (c ? c.name : String(id)) + (vals.length > 1 ? ` #${i + 1}` : '')),
          el('span', {}, String(v))));
      });
    });
  }

  // #21 — list of Pokémon guessed for the current mon (resets per mon)
  function renderGuesses() {
    const log = root.querySelector('#sf-guesslog'); if (!log) return;
    clear(log);
    const w = round.wrongGuesses || [];
    if (!w.length) return;
    log.append(el('div', { class: 'rev-head' }, 'Guessed'));
    w.forEach((g, i) => log.append(el('div', { class: 'guess-log-item' },
      el('span', {}, g.name), el('span', { class: 'guess-num' }, `#${i + 1}`))));
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
      // #6 (requested): labeled stat spread (HP/Atk/Def/...), matching
      // single.js/victoryroad.js — was a bare number string before.
      const revealedValueEl = clue.field === 'fullStats'
        ? el('div', { class: 'clue-revealed-value' }, statSpreadEl(String(s.revealedClues[clue.id])))
        : el('div', { class: 'clue-revealed-value' }, String(s.revealedClues[clue.id]));
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name', style: { color: cat.color } }, clue.name)),
        revealedValueEl);
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
    const manualCost = cost * 2;   // #12 — choosing a clue yourself costs double
    if (round.pointsRemaining < manualCost) card.classList.add('cant-afford');
    if (isMulti && hist.length) { card.classList.add('revealed'); Object.assign(card.style, { background: cat.bg, borderColor: cat.color }); }
    card.append(el('div', { class: 'clue-top' },
      el('span', { class: 'clue-btn-name', style: isMulti && hist.length ? { color: cat.color } : {} }, clue.name),
      el('span', { class: 'clue-cost-badge', style: { background: dynamicColor(manualCost) } }, `${manualCost}pt${manualCost !== 1 ? 's' : ''}`)));
    for (let i = 0; i < hist.length; i++) card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } }, (i ? `#${i + 1} ` : '') + hist[i]));
    card.addEventListener('click', () => buy(clue.id));
    return card;
  }

  // Manual pick — costs DOUBLE (#12). Engine charges 1×; we deduct the 2nd ×.
  function buy(id) {
    const cost = round.clueCurrentCost(id);
    if (round.pointsRemaining < cost * 2) { feedback('Not enough points to choose that clue.', '#e06060'); return; }
    const res = round.buyClue(id);
    if (!res.ok) return;
    round.state.pointsRemaining = Math.max(0, round.state.pointsRemaining - cost); // the extra ×1
    afterSpend();
  }
  // Bait = random cheap clue (base cost < 4) at normal cost. Requested
  // safeguard: never offer a random clue whose cost would take the shared
  // budget below 1 point (leaves at least 1 for guessing) -- manual picks
  // (buy(), above) aren't restricted this way, only the two random-reveal
  // actions, matching what was actually asked for.
  function throwBait() {
    const pool = clues.filter((c) => c.cost < 4 && round.clueAvailable(c) && round.pointsRemaining - round.clueCurrentCost(c.id) >= 1);
    if (!pool.length) { feedback('No cheap clues available!', '#e06060'); return; }
    const c = pool[Math.floor(rng() * pool.length)];
    if (round.buyClue(c.id).ok) afterSpend();
  }
  // Rock = random costly clue (base cost >= 4) at normal cost. Same safeguard.
  function throwRock() {
    const pool = clues.filter((c) => c.cost >= 4 && round.clueAvailable(c) && round.pointsRemaining - round.clueCurrentCost(c.id) >= 1);
    if (!pool.length) { feedback('No costly clues available!', '#e04040'); return; }
    const c = pool[Math.floor(rng() * pool.length)];
    if (round.buyClue(c.id).ok) afterSpend();
  }
  function afterSpend() {
    renderClues();
    renderRevealed();
    updateBudget();
    sf.budget = round.pointsRemaining;
    if (round.gameOver || round.pointsRemaining <= 0) endGame();
  }

  function run() {
    if (!sf || round.gameOver) return;
    sf.ranNames.push(round.mystery.name);
    markSeen(round.mystery.name);
    feedback(`You ran! It was ${round.mystery.name}.`, '#e0a060');
    setTimeout(() => { if (sf) nextMon(); }, 1000);
  }

  // ---- guessing -----------------------------------------------------------
  function submitFromInput() { const i = root.querySelector('#sf-guess'); if (i) doGuess(i.value); }
  function doGuess(name) {
    closeAuto();
    const val = String(name || '').trim();
    if (!val) return;
    // #15 — must be a real Pokémon from this gen's list (no penalty otherwise)
    if (!round.allNames.some((n) => normalizeName(n) === normalizeName(val))) {
      feedback('Pick a Pok\u00e9mon from the list.', '#e0a060'); return;
    }
    if (normalizeName(val) === normalizeName(round.mystery.name)) {
      sf.caught++;
      sf.caughtNames.push(round.mystery.name);
      markCaught(round.mystery.name);
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
    renderGuesses();
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
    if (round.mystery && !round.gameOver) markSeen(round.mystery.name);
    // Requested: whatever mon the player was on when the game ended, IF it
    // isn't already recorded as caught or explicitly run from, counts as run
    // from too — "anything other than successfully catching the Pokemon
    // with the final point" (a guess that missed, or a clue purchase that
    // used up the last point) should show up in the run-from list, not just
    // vanish from the summary entirely.
    if (round.mystery && !sf.caughtNames.includes(round.mystery.name) && !sf.ranNames.includes(round.mystery.name)) {
      sf.ranNames.push(round.mystery.name);
    }
    const done = sf; sf = null;
    const ptsUsed = done.startPts - round.pointsRemaining;
    const eff = done.startPts > 0 ? (done.caught / done.startPts * 100).toFixed(1) : '0';
    // Submit to leaderboard. Requested: include the catch-per-100-points
    // efficiency as the sortable metric (Safari boards rank by it), and show
    // it in the detail line too.
    const gen = data.id || 'gen2';
    submitScore(gen, 'safari', {
      score: done.caught,
      metric: done.startPts > 0 ? done.caught / done.startPts * 100 : 0,
      metricLabel: 'catch/100pts',
      detail: `${eff} per 100pts \u00b7 budget:${done.startPts} spent:${ptsUsed}`,
    }).catch(() => {});
    const nameList = (names) => names.length
      ? el('div', { class: 'sf-mon-list' }, ...names.map((n) => el('span', { class: 'sf-mon-chip' }, n)))
      : el('p', { class: 'sf-intro' }, 'None.');
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' }, el('div', { class: 'summary-result' }, '\uD83C\uDF3F Safari complete')),
          el('p', { class: 'sf-intro' }, exhausted ? 'You caught everything in the pool!' : 'You ran out of points.'),
          el('div', { class: 'stats-grid' },
            stat(done.caught, 'Caught'), stat(done.startPts, 'Budget'), stat(ptsUsed, 'Spent'), stat(`${eff}%`, 'Per 100 pts')),
          el('div', { class: 'mp-form-section' }, el('div', { class: 'sp-section-title', style: { fontSize: '11px' } }, `\uD83C\uDFC6 Caught (${done.caughtNames.length})`), nameList(done.caughtNames)),
          el('div', { class: 'mp-form-section' }, el('div', { class: 'sp-section-title', style: { fontSize: '11px' } }, `\uD83C\uDFC3 Ran From (${done.ranNames.length})`), nameList(done.ranNames)),
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
