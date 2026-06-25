/**
 * @file        js/modes/single.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Single Player screen controller on top of lib/engine.js. Faithful
 *           re-creation of the canonical flow (config → game → summary) with no
 *           game rules of its own: every decision (availability, cost, limits,
 *           guessing, scoring, category diversity, forced phases) is delegated
 *           to PokeGuessRound. Markup mirrors the canonical class names so the
 *           ported CSS styles it. Reads movelist-gen{N}.json for moveset clues.
 *
 * Contract: createSingle({ mount, config, data, params, onExit }) → { destroy }
 *   data   = gen{N}.json (pokedex, clues, categories, difficulties, multiClue)
 *   params = { rng? } optional injected RNG (deterministic tests)
 */

import { el, clear } from '../lib/dom.js';
import { statSpreadEl } from '../lib/dom.js';
import { PokeGuessRound, normalizeName } from '../lib/engine.js';
import { submitScore } from '../lib/leaderboard-data.js';

export function createSingle({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'sp-content' });
  clear(mount).appendChild(root);

  // Guard: this mode needs the clue/difficulty config folded into gen{N}.json by
  // the data pipeline. If it's absent (e.g. a stale data file was deployed),
  // show a clear message instead of throwing into a blank screen.
  if (!Array.isArray(data.difficulties) || !data.difficulties.length
      || !Array.isArray(data.clues) || !data.clues.length
      || !Array.isArray(data.categories) || !data.categories.length) {
    root.append(
      el('h2', { class: 'sp-section-title' }, 'Data needs updating'),
      el('p', { class: 'placeholder-text' },
        `This generation's data file is missing its clue/difficulty configuration. `
        + `Re-run the data pipeline (tools/generate-data.mjs) and re-upload `
        + `docs/data/${data.id || 'genN'}.json, then reload.`),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
    );
    return { destroy() { clear(mount); } };
  }

  const cats = data.categories || [];
  const clues = data.clues || [];
  const catById = new Map(cats.map((c) => [c.id, c]));
  let round = null;
  let movelist = {};
  let acIndex = -1;

  // ---- load movelist (for moveset clues), then show config ----------------
  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; })
    .catch(() => { movelist = {}; })
    .finally(showConfig);

  // ===== CONFIG SCREEN =====================================================
  const chosen = { difficulty: 'normal', guessMode: 'free', clueMode: 'choose', catDiversity: 'free', points: 50, guessCost: 1 };

  function showConfig() {
    const diffGrid = el('div', { class: 'diff-grid' },
      ...data.difficulties.map((d) => diffCard(d)));

    const optionRow = (label, name, options) => el('div', { class: 'sp-opt-row' },
      el('div', { class: 'sp-opt-label' }, label),
      el('div', { class: 'sp-opt-btns' }, ...options.map(([val, txt]) =>
        el('button', {
          class: 'sp-opt-btn' + (chosen[name] === val ? ' active' : ''),
          dataset: { name, val },
          onClick: (e) => {
            chosen[name] = val;
            e.currentTarget.parentElement.querySelectorAll('.sp-opt-btn')
              .forEach((b) => b.classList.toggle('active', b.dataset.val === val));
          },
        }, txt))));

    const customPanel = el('div', { class: 'sp-custom-panel', id: 'sp-custom-panel', style: { display: chosen.difficulty === 'custom' ? '' : 'none' } },
      el('label', { class: 'sp-custom-field' }, 'Starting points',
        el('input', { type: 'number', id: 'sp-custom-points', value: String(chosen.points), min: '1', max: '999' })),
      el('label', { class: 'sp-custom-field' }, 'Wrong-guess cost',
        el('input', { type: 'number', id: 'sp-custom-guesscost', value: String(chosen.guessCost), min: '0', max: '5' })));

    clear(root).append(
      el('div', { class: 'sp-section-title' }, 'Choose a difficulty'),
      diffGrid,
      customPanel,
      el('div', { class: 'sp-section-title' }, 'Options'),
      optionRow('Guess mode', 'guessMode', [['free', 'Guess anytime'], ['forced', 'Forced reveal']]),
      optionRow('Clue selection', 'clueMode', [['choose', 'Choose'], ['random', 'Random'], ['category', 'By category']]),
      optionRow('Category diversity', 'catDiversity', [['free', 'Free'], ['diff', 'Force different'], ['cycle', 'Cycle all']]),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-primary', onClick: beginRound }, 'Start game \u25b6')),
    );
  }

  function diffCard(d) {
    const card = el('div', {
      class: 'diff-card' + (chosen.difficulty === d.id ? ' selected' : ''),
      dataset: { diff: d.id },
      onClick: () => {
        chosen.difficulty = d.id;
        root.querySelectorAll('.diff-card').forEach((c) => c.classList.toggle('selected', c.dataset.diff === d.id));
        const cp = root.querySelector('#sp-custom-panel');
        if (cp) cp.style.display = d.id === 'custom' ? '' : 'none';
      },
    },
      el('div', { class: 'diff-name' }, d.name),
      el('div', { class: 'diff-points' }, d.id === 'custom' ? '?' : `${d.points}`, el('span', {}, ' pts')),
      d.desc ? el('div', { class: 'diff-desc' }, d.desc) : null,
    );
    return card;
  }

  function beginRound() {
    if (chosen.difficulty === 'custom') {
      chosen.points = clampInt(root.querySelector('#sp-custom-points')?.value, 1, 999, 50);
      chosen.guessCost = clampInt(root.querySelector('#sp-custom-guesscost')?.value, 0, 5, 1);
    }
    round = new PokeGuessRound({ genData: data, movelist, rng: params.rng });
    const poolFilter = data.id === 'gen1' ? 'gen1' : data.id === 'gen2' ? 'gen2' : 'both';
    round.start({
      difficultyId: chosen.difficulty,
      poolFilter,
      guessMode: chosen.guessMode,
      clueMode: chosen.clueMode,
      catDiversity: chosen.catDiversity,
      custom: chosen.difficulty === 'custom' ? { points: chosen.points, guessCost: chosen.guessCost, startClueMode: 'none' } : null,
    });
    showGame();
  }

  // ===== GAME SCREEN =======================================================
  function showGame() {
    clear(root).append(
      topBar(),
      el('div', { class: 'game-body' },
        el('div', { class: 'clue-panel', id: 'clue-panel' }),
        el('div', { class: 'game-side' },
          guessArea(),
          el('div', { class: 'revealed-summary', id: 'revealed-summary' }),
        ),
      ),
    );
    renderClueGrid();
    renderRevealed();
    updatePoints();
    updateForcedUI();
  }

  function topBar() {
    return el('div', { class: 'game-topbar' },
      el('button', { class: 'btn-secondary game-exit', onClick: () => onExit && onExit() }, '\u2190 Quit'),
      el('div', { class: 'points-display' },
        el('div', { class: 'points-number', id: 'points-number' }, `${round.pointsRemaining} pts`),
        el('div', { class: 'points-bar-track' }, el('div', { class: 'points-bar-fill', id: 'points-bar-fill' }))),
      el('div', { class: 'sp-forced-indicator', id: 'sp-forced-indicator', style: { display: 'none' } }),
    );
  }

  function guessArea() {
    const input = el('input', {
      class: 'guess-input', id: 'guess-input', type: 'text', placeholder: 'Type a Pok\u00e9mon name\u2026', autocomplete: 'off',
      onInput: (e) => renderAutocomplete(e.target.value),
      onKeydown: onGuessKey,
    });
    return el('div', { class: 'guess-block' },
      el('div', { class: 'guess-input-wrap' },
        input,
        el('button', { class: 'guess-btn', onClick: () => submitFromInput() }, 'Guess'),
        el('div', { class: 'autocomplete-list', id: 'autocomplete-list' })),
      el('div', { class: 'guess-feedback', id: 'guess-feedback' }),
      el('div', { class: 'guess-count-badge', id: 'guess-count-badge' }, '0 guesses'),
      el('div', { class: 'guess-log', id: 'guess-log' }),
    );
  }

  // ---- clue grid ----------------------------------------------------------
  function dynamicColor(cost) {
    const costs = clues.map((c) => round.clueCurrentCost(c.id));
    const lo = Math.min(...costs), hi = Math.max(...costs);
    if (hi === lo) return 'hsl(200,60%,42%)';
    const t = Math.max(0, Math.min(1, (cost - lo) / (hi - lo)));
    const hue = Math.round(120 * (1 - t));
    const sat = 62 + Math.round(18 * Math.abs(t - 0.5) * 2);
    const lit = 40 + Math.round(6 * (1 - Math.abs(t - 0.5) * 2));
    return `hsl(${hue},${sat}%,${lit}%)`;
  }

  function renderClueGrid() {
    const panel = root.querySelector('#clue-panel');
    if (!panel) return;
    clear(panel);
    const lockedCats = (round.state.diffRestrictions && round.state.diffRestrictions.lockedCats) || [];
    for (const cat of cats) {
      if (lockedCats.includes(cat.id)) continue;
      const body = el('div', { class: 'cat-body' });
      const section = el('div', { class: 'cat-section' },
        el('div', { class: 'cat-header', style: { background: cat.bg } },
          el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
        body);
      for (const clue of clues.filter((c) => c.cat === cat.id)) body.appendChild(renderCard(clue, cat));
      if (body.children.length) panel.appendChild(section);
    }
    // locked-category summary line
    if (lockedCats.length) {
      const names = lockedCats.map((id) => catById.get(id)?.name).filter(Boolean).join(', ');
      panel.appendChild(el('div', { class: 'clue-unavail-note', style: { padding: '8px' } }, `\uD83D\uDD12 Locked on this difficulty: ${names}`));
    }
  }

  function renderCard(clue, cat) {
    const s = round.state;
    const hist = s.clueHistory[clue.id] || [];
    const uses = hist.length;
    const isRevealed = clue.id in s.revealedClues;
    const isMultiUse = clue.maxUses !== 1 || clue.costIncrement > 0;
    const currentCost = round.clueCurrentCost(clue.id);
    const diffLock = round.difficultyLock(clue);
    const limitInfo = round.clueLimitInfo(clue);

    const card = el('button', { class: 'clue-btn', dataset: { clue: clue.id } });

    if (diffLock && !(isMultiUse && uses > 0)) {
      card.classList.add('unavailable', 'difficulty-locked');
      card.title = diffLock;
      card.append(top(clue.name, '\uD83D\uDD12'), note('clue-unavail-note', diffLock));
      return card;
    }
    if (isRevealed && !isMultiUse) {
      card.classList.add('revealed');
      Object.assign(card.style, { background: cat.bg, borderColor: cat.color });
      card.append(top(clue.name, null, cat.color), note('clue-revealed-value', String(s.revealedClues[clue.id])));
      return card;
    }
    if (round.clueExhausted(clue)) {
      card.classList.add('unavailable');
      card.append(top(clue.name), note('clue-unavail-note', '\u2717 ' + (hist[hist.length - 1] || 'Exhausted')));
      return card;
    }
    if (!round.clueAvailable(clue)) {
      card.classList.add('unavailable');
      card.append(top(clue.name), note('clue-unavail-note', unavailNote(clue)));
      return card;
    }
    if (clue.requiresClueId != null && !(clue.requiresClueId in s.revealedClues)) {
      card.classList.add('unavailable');
      const req = round.clue(clue.requiresClueId);
      card.append(top(clue.name), note('clue-prereq-note', `Requires: ${req ? req.name : '?'}`));
      return card;
    }

    // available / multi-use
    const canAfford = round.pointsRemaining >= currentCost;
    const phaseLocked = s.guessMode === 'forced' && s.forcedPhase === 'guess';
    if (!canAfford || phaseLocked || limitInfo.atLimit) card.classList.add('cant-afford');

    const costBadge = el('span', { class: 'clue-cost-badge', style: { background: dynamicColor(currentCost) } }, `${currentCost}pt${currentCost !== 1 ? 's' : ''}`);
    const rising = (clue.costIncrement > 0)
      ? el('span', { class: 'clue-cost-rising' }, `\u2191 +${clue.costIncrement}/use`) : null;
    const useBadge = (isMultiUse && uses > 0) ? el('span', { class: 'clue-use-badge' }, `use ${uses + 1}`) : null;

    if (isMultiUse && uses > 0) {
      card.classList.add('revealed');
      Object.assign(card.style, { background: cat.bg, borderColor: cat.color });
    }
    card.append(el('div', { class: 'clue-top' },
      el('span', { class: 'clue-btn-name', style: isMultiUse && uses > 0 ? { color: cat.color } : {} }, clue.name),
      el('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, costBadge, rising, useBadge)));
    for (let i = 0; i < hist.length; i++) {
      card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } },
        (i ? `#${i + 1} ` : '') + hist[i]));
    }
    if (limitInfo.note) card.append(note('clue-limit-note', (limitInfo.atLimit ? '\u2717 ' : '') + limitInfo.note));
    card.addEventListener('click', () => buyAndRefresh(clue.id));
    return card;

    function top(name, badge, color) {
      return el('div', { class: 'clue-top' },
        el('span', { class: 'clue-btn-name', style: color ? { color } : {} }, name),
        badge ? el('span', { style: { opacity: 0.6 } }, badge) : null);
    }
    function note(cls, txt) { return el('div', { class: cls }, txt); }
  }

  function unavailNote(clue) {
    if ([3, 4, 5, 6].includes(clue.id)) return 'Confirm \u201Ccaught in wild\u201D first';
    if (clue.id === 12) return 'Needs \u201Cevolves from\u201D = Yes';
    if (clue.id === 15) return 'Both types known';
    if ([18, 19, 20, 21, 22].includes(clue.id)) return 'Full spread already shown';
    return 'Not available';
  }

  function buyAndRefresh(id) {
    const res = round.buyClue(id);
    if (!res.ok) return;
    renderClueGrid();
    renderRevealed();
    updatePoints();
    updateForcedUI();
    if (round.gameOver) showSummary();
  }

  // ---- revealed summary ---------------------------------------------------
  function renderRevealed() {
    const box = root.querySelector('#revealed-summary');
    if (!box) return;
    clear(box);
    const rv = round.revealedClues;
    const ids = Object.keys(rv).map(Number);
    if (!ids.length) { box.append(el('div', { class: 'rev-empty' }, 'No clues revealed yet.')); return; }
    box.append(el('div', { class: 'rev-cat-label' }, 'Revealed'));
    for (const id of ids) {
      const c = round.clue(id);
      box.append(el('div', { class: 'rev-item' + (id === round.state.lastRevealedClueId ? ' rev-new' : '') },
        el('span', { class: 'rev-item-name' }, c ? c.name : `#${id}`),
        el('span', { class: 'rev-item-value' }, String(rv[id]))));
    }
  }

  // ---- points -------------------------------------------------------------
  function updatePoints() {
    const num = root.querySelector('#points-number');
    const bar = root.querySelector('#points-bar-fill');
    if (!num || !bar) return;
    const pct = round.startingPoints > 0 ? round.pointsRemaining / round.startingPoints : 0;
    num.textContent = `${round.pointsRemaining} pts`;
    num.className = 'points-number ' + (pct > 0.6 ? 'high' : pct > 0.3 ? 'mid' : 'low');
    bar.style.width = `${Math.max(0, pct * 100)}%`;
    bar.style.background = pct > 0.6 ? '#29cc66' : pct > 0.3 ? '#f0c020' : '#e04040';
  }

  function updateForcedUI() {
    const ind = root.querySelector('#sp-forced-indicator');
    if (!ind) return;
    if (round.state.guessMode !== 'forced') { ind.style.display = 'none'; return; }
    ind.style.display = '';
    ind.textContent = round.state.forcedPhase === 'guess' ? 'Forced: make a guess' : 'Forced: reveal a clue';
  }

  // ---- guessing -----------------------------------------------------------
  function submitFromInput() {
    const input = root.querySelector('#guess-input');
    if (!input) return;
    doGuess(input.value);
  }
  function doGuess(name) {
    const input = root.querySelector('#guess-input');
    closeAutocomplete();
    const res = round.submitGuess(name);
    if (!res.ok) return;
    if (res.correct) { 
      // Submit to leaderboard (fire-and-forget — never blocks the UI)
      const gen = data.id || 'gen2';
      const detail = `diff:${chosen.difficulty} clues:${Object.keys(round.revealedClues).length} wrong:${round.wrongGuesses.length}`;
      submitScore(gen, 'single', { score: round.pointsRemaining, detail }).catch(() => {});
      showSummary(); return; 
    }
    // wrong
    const fb = root.querySelector('#guess-feedback');
    if (fb) {
      fb.className = 'guess-feedback error';
      fb.textContent = 'Not quite!' + (round.state.guessCost > 0 ? ` \u2013${round.state.guessCost} pt${round.state.guessCost !== 1 ? 's' : ''}` : '');
      setTimeout(() => { if (fb) fb.textContent = ''; }, 2200);
    }
    if (input) input.value = '';
    const wc = round.wrongGuesses.length;
    const badge = root.querySelector('#guess-count-badge');
    if (badge) badge.textContent = `${wc} guess${wc !== 1 ? 'es' : ''}`;
    renderGuessLog();
    renderClueGrid();
    updatePoints();
    updateForcedUI();
    if (round.gameOver) showSummary();
  }

  function renderGuessLog() {
    const log = root.querySelector('#guess-log');
    if (!log) return;
    clear(log);
    const w = round.wrongGuesses;
    if (!w.length) { log.append(el('div', { class: 'guess-log-empty' }, 'None yet.')); return; }
    w.forEach((g, i) => log.append(el('div', { class: 'guess-log-item' },
      el('span', {}, g.name), el('span', { class: 'guess-num' }, `#${i + 1}`))));
  }

  // ---- autocomplete -------------------------------------------------------
  function renderAutocomplete(q) {
    const list = root.querySelector('#autocomplete-list');
    if (!list) return;
    const query = normalizeName(q);
    if (!query) { closeAutocomplete(); return; }
    const matches = round.allNames.filter((n) => n.toLowerCase().includes(query)).slice(0, 10);
    if (!matches.length) { closeAutocomplete(); return; }
    acIndex = -1;
    clear(list);
    matches.forEach((n) => {
      const item = el('div', { class: 'ac-item', dataset: { name: n }, onClick: () => { fillGuess(n); } }, n);
      list.appendChild(item);
    });
    list.classList.add('open');
  }
  function fillGuess(name) {
    const input = root.querySelector('#guess-input');
    if (input) input.value = name;
    closeAutocomplete();
    doGuess(name);
  }
  function onGuessKey(e) {
    const list = root.querySelector('#autocomplete-list');
    const items = list ? [...list.querySelectorAll('.ac-item')] : [];
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); markAc(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, -1); markAc(items); }
    else if (e.key === 'Enter') { e.preventDefault(); if (acIndex >= 0 && items[acIndex]) fillGuess(items[acIndex].dataset.name); else submitFromInput(); }
    else if (e.key === 'Escape') closeAutocomplete();
  }
  function markAc(items) { items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
  function closeAutocomplete() {
    const list = root.querySelector('#autocomplete-list');
    if (list) { list.classList.remove('open'); clear(list); }
    acIndex = -1;
  }

  // ===== SUMMARY ===========================================================
  function showSummary() {
    const m = round.mystery;
    const win = round.gameResult === 'win';
    const types = [m.type1, ...(m.type2 && m.type2 !== '\u2014' ? [m.type2] : [])];

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' + (win ? ' win' : ' loss') },
            el('div', { class: 'summary-result' }, win ? '\uD83C\uDF89 Correct!' : '\uD83D\uDCA5 Out of points'),
            el('div', { class: 'summary-mon' }, `#${m.num} ${m.name}`),
            win ? el('div', { class: 'summary-score' }, `Score: ${round.pointsRemaining} pts`) : null),
          el('div', { class: 'type-pills' }, ...types.map((t) =>
            el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
          m.fullStats ? statSpreadEl(m.fullStats) : null,
          el('div', { class: 'summary-meta' },
            el('div', {}, `Wrong guesses: ${round.wrongGuesses.length}`),
            el('div', {}, `Clues revealed: ${Object.keys(round.revealedClues).length}`)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showConfig }, 'Play again'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')),
        )));
  }

  // ---- utils + lifecycle --------------------------------------------------
  function clampInt(v, lo, hi, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  const onDocClick = (e) => { if (!e.target.closest('.guess-input-wrap')) closeAutocomplete(); };
  document.addEventListener('click', onDocClick);

  return {
    destroy() {
      document.removeEventListener('click', onDocClick);
      clear(mount);
    },
  };
}

export default createSingle;
