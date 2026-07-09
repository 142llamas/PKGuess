/**
 * @file        js/modes/multiplayer.js
 * @version     1.3.3
 * @updated     2026-07-09
 * @changelog
 *   1.3.3 — Fixed: the "Reveal Full Stat Spread" clue showed a bare number
 *           string with no HP/Atk/Def/... labels, matching the same fix in
 *           single.js/safari.js/online.js. Now uses the shared statSpreadEl.
 *   1.3.2 — removed the "Skip guess / go to reveal" button from GTR's guess
 *           phase — it let a player skip guessing entirely, undermining
 *           GTR's whole premise (guess cold, only reveal if wrong).
 *   1.3.1 — #7: the reveal-phase hint text claimed clues were positioned
 *           "above" (and used an ↑ arrow) — only true in mobile's stacked
 *           layout; on desktop the clue grid sits to the LEFT of the side
 *           panel where this hint lives. Dropped the layout-dependent
 *           direction entirely ("Click a clue to reveal it") so it's correct
 *           regardless of viewport. Same fix applied to the sibling
 *           "by category" hint.
 *           #9: GTR's reveal step (only ever reached after a wrong guess) let
 *           the SAME player reveal as many clues as they wanted (revealClue()
 *           only advanced the phase for RTG, never GTR) and offered a "Skip
 *           to guess"/"Skip reveal" option that could end a turn with ZERO
 *           reveals. Now exactly one mandatory reveal, then the turn passes
 *           automatically to the next player; all skip options are suppressed
 *           during GTR's reveal phase.
 *   1.3.0 — #4: applyEvoDeductions() now delegates to the shared mp-rules.computeAutoDeducedIds (same logic, single source of truth with online.js).
 *   1.2.0 — #17: hotseat never touched the catch tracker — a round's winner now marks the mystery Caught, and quitting mid-round marks it Seen. Fixed finding: Random/By-category reveal pools permanently dropped a multi-use clue (e.g. Reveal One Weakness) after its FIRST use instead of respecting its real use cap — mpCard() also now shows per-use reveal history instead of collapsing multi-use clues to their latest value only. Cost checks use the live current cost, not the stale base cost.
 *   1.1.0 — Gen 2 mode draws from the full dex (#13). Added "By category" clue selection + a real Category Diversity setting (previously never reached the engine, so Force-Different/Cycle-All were silent no-ops in hotseat). Random/By-category cards are now read-only; manual reveals are subject to the diversity rule instead of always bypassing it (#10/#11/#15b/#15c).
 *   1.0.0 — Hot-seat multiplayer, ported from the canonical MP screen.
 *           2–4 players pass the device. Shared point pool per round; whoever
 *           correctly identifies the Pokémon earns the remaining points. Two
 *           game modes: RTG (reveal-then-guess) and GTR (guess-then-reveal).
 *           Two clue modes: choose or weighted-random. Per-round clue exclusion
 *           panel. Evolution cross-inference auto-deductions. Round-end overlay
 *           with standings; final podium + per-player stats; collapsible round
 *           history table. All clue rules via engine.js.
 *
 * Contract: createMultiplayer({ mount, config, data, params, onExit }) → { destroy }
 */

import { el, clear, statSpreadEl } from '../lib/dom.js';
import { PokeGuessRound, normalizeName, poolFilterForData, matchesPool } from '../lib/engine.js';
import { markCaught, markSeen } from '../lib/catch-tracker.js';
import { computeAutoDeducedIds } from '../lib/mp-rules.js';

const PLAYER_COLORS = ['#ffd700', '#3a7fdb', '#27a447', '#d04830'];
const PLACE_EMOJI = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49', '4\uFE0F\u20E3'];

export function createMultiplayer({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'sp-content' });
  clear(mount).appendChild(root);

  if (!Array.isArray(data.clues) || !data.clues.length) {
    root.append(
      el('h2', { class: 'sp-section-title' }, 'Data needs updating'),
      el('p', { class: 'placeholder-text' }, `Re-run the pipeline and re-upload docs/data/${data.id || 'genN'}.json.`),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
    return { destroy() { clear(mount); } };
  }

  const rng = params.rng || Math.random;
  const poolFilter = poolFilterForData(data.id);
  const dflt = (config && config.mpDefaults) || {};
  let movelist = {};
  let mp = null; // runtime state
  let acIndex = -1;

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; })
    .catch(() => { movelist = {}; })
    .finally(() => { showSetup(); prefillPlayerOne(); });

  // Default Player 1 to the signed-in display name (#25).
  function prefillPlayerOne() {
    import('../lib/identity.js').then((m) => m.getIdentity()).then((id) => {
      if (id && id.name && !setup.playerNames[0]) {
        setup.playerNames[0] = id.name.slice(0, 16);
        const c = document.getElementById('mp-player-inputs');
        if (c) renderPlayerInputs(c);
      }
    }).catch(() => { /* offline — keep the placeholder */ });
  }

  // ===== SETUP SCREEN =======================================================
  let setup = {
    playerNames: ['', 'Player 2', '', ''],
    playerCount: 2,
    gameMode: 'rtg',   // 'rtg' | 'gtr'
    clueMode: 'choose', // 'choose' | 'random' | 'category'
    catDiversity: 'free', // 'free' | 'diff' | 'cycle'
    winTarget: dflt.winTarget || 150,
    poolStart: dflt.poolPerRound || 75,
    guessCost: dflt.guessCost || 0,
    excludedIds: new Set(),
  };

  function showSetup() {
    clear(root);
    root.append(
      el('div', { class: 'sp-section-title' }, `\u2694\uFE0F Multiplayer \u2014 ${data.id === 'gen1' ? 'Gen 1' : 'Gen 2'}`),
      el('div', { class: 'mp-setup-body' },
        playerSection(),
        modeSection(),
        clueSection(),
        numbersSection(),
        excludeSection(),
      ),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-primary', onClick: startGame }, '\u2694\uFE0F Start Multiplayer')));
  }

  function playerSection() {
    const inputs = el('div', { class: 'mp-player-inputs', id: 'mp-player-inputs' });
    renderPlayerInputs(inputs);
    return el('div', { class: 'mp-form-section' },
      el('div', { class: 'mp-form-label' }, 'Players (2\u20134)'),
      inputs,
      el('div', { class: 'mp-player-btns' },
        el('button', { class: 'btn-secondary', style: { fontSize: '12px', padding: '6px 12px' },
          onClick: () => { setup.playerCount = Math.min(4, setup.playerCount + 1); renderPlayerInputs(inputs); } }, '+ Add'),
        el('button', { class: 'btn-secondary', style: { fontSize: '12px', padding: '6px 12px' },
          onClick: () => { setup.playerCount = Math.max(2, setup.playerCount - 1); renderPlayerInputs(inputs); } }, '\u2212 Remove')));
  }

  function renderPlayerInputs(container) {
    clear(container);
    for (let i = 0; i < setup.playerCount; i++) {
      const color = PLAYER_COLORS[i];
      const inp = el('input', { class: 'mp-name-input', type: 'text', placeholder: `Player ${i + 1}`, value: setup.playerNames[i] || '',
        onInput: (e) => { setup.playerNames[i] = e.target.value; },
        style: { borderColor: color } });
      container.append(el('div', { class: 'mp-name-row' },
        el('span', { class: 'mp-name-swatch', style: { background: color } }),
        inp));
    }
  }

  function toggle(id, opts, current, onChange) {
    return el('div', { class: 'mp-toggle-row' },
      ...opts.map(([val, label, sub]) => {
        const btn = el('button', {
          class: 'mp-toggle-btn' + (current() === val ? ' active' : ''),
          dataset: { val },
          onClick: (e) => { onChange(val); e.currentTarget.closest('.mp-toggle-row').querySelectorAll('.mp-toggle-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === val)); },
        }, el('div', { class: 'mp-tb-label' }, label), sub ? el('div', { class: 'mp-tb-sub' }, sub) : null);
        return btn;
      }));
  }

  function modeSection() {
    return el('div', { class: 'mp-form-section' },
      el('div', { class: 'mp-form-label' }, 'Game Mode'),
      toggle('gameMode', [
        ['rtg', 'Reveal, then Guess', 'Reveal a clue first, then make your guess each turn'],
        ['gtr', 'Guess, then Reveal', 'Guess first — if wrong, reveal a clue then pass'],
      ], () => setup.gameMode, (v) => { setup.gameMode = v; }));
  }

  function clueSection() {
    return el('div', { class: 'mp-form-section' },
      el('div', { class: 'mp-form-label' }, 'Clue Selection'),
      toggle('clueMode', [
        ['choose', 'Choose Clues', 'Active player picks which clue to reveal'],
        ['random', 'Random Clues', 'A weighted-random clue is revealed automatically'],
        ['category', 'By Category', 'Pick a category; a random clue from it is revealed'],
      ], () => setup.clueMode, (v) => { setup.clueMode = v; }),
      el('div', { class: 'mp-form-label', style: { marginTop: '12px' } }, 'Category Diversity'),
      toggle('catDiversity', [
        ['free', 'Free Choice', 'Reveal from any category in any order'],
        ['diff', 'Force Different', 'Cannot reveal from the same category twice in a row'],
        ['cycle', 'Cycle All', 'Must reveal from every available category before repeating any'],
      ], () => setup.catDiversity, (v) => { setup.catDiversity = v; }));
  }

  function numInput(label, key, min, max) {
    return el('label', { class: 'sp-custom-field' }, label,
      el('input', { type: 'number', value: String(setup[key]), min: String(min), max: String(max),
        onInput: (e) => { setup[key] = clampInt(e.target.value, min, max, setup[key]); } }));
  }
  function numbersSection() {
    return el('div', { class: 'sp-custom-panel' },
      numInput('Win target (pts)', 'winTarget', 10, 9999),
      numInput('Pool per round (pts)', 'poolStart', 10, 999),
      numInput('Wrong-guess cost (pts)', 'guessCost', 0, 50));
  }

  function excludeSection() {
    const body = el('div', { class: 'mp-exclude-body', id: 'mp-excl-body', style: { display: 'none' } });
    const tog = el('button', { class: 'mp-excl-toggle',
      onClick: () => { const open = body.style.display !== 'none'; body.style.display = open ? 'none' : ''; tog.classList.toggle('open', !open); } },
      '\u2699\uFE0F Clue Availability ', el('span', { class: 'adv-arrow' }, '\u25bc'));
    buildExcludeGrid(body);
    return el('div', { class: 'mp-form-section' }, tog, body);
  }

  function buildExcludeGrid(container) {
    const cats = data.categories, clues = data.clues;
    for (const cat of cats) {
      const catClues = clues.filter((c) => c.cat === cat.id);
      const catBlock = el('div', { class: 'mp-excl-cat' });
      const header = el('div', { class: 'mp-excl-cat-head', style: { color: cat.color } }, cat.name);
      catBlock.append(header);
      for (const c of catClues) {
        const cb = el('input', { type: 'checkbox', checked: true,
          onChange: (e) => { e.target.checked ? setup.excludedIds.delete(c.id) : setup.excludedIds.add(c.id); } });
        catBlock.append(el('label', { class: 'mp-excl-row' }, cb, el('span', {}, c.name),
          el('span', { class: 'mp-excl-cost' }, `${c.cost}pt`)));
      }
      container.append(catBlock);
    }
  }

  // ===== GAME STATE =========================================================
  function startGame() {
    const names = setup.playerNames.slice(0, setup.playerCount).map((n, i) => (n && n.trim()) || `Player ${i + 1}`);
    const players = names.map((name, i) => ({
      id: i, name, color: PLAYER_COLORS[i],
      score: 0, roundsWon: 0, pointsEarned: 0,
      guessesTotal: 0, guessesCorrect: 0, guessesWrong: 0,
      clueCount: 0, clueCostTotal: 0,
    }));
    // Build shuffled pool from dex
    const pool = data.pokedex.filter((p) => matchesPool(p.num, poolFilter));
    mp = {
      players, turnOrder: players.map((p) => p.id),
      currentTurnPos: 0, gameMode: setup.gameMode, clueMode: setup.clueMode, catDiversity: setup.catDiversity,
      winTarget: setup.winTarget, poolStart: setup.poolStart, guessCost: setup.guessCost,
      excludedIds: new Set(setup.excludedIds),
      pool, round: null, phase: null, turnHasRevealed: false,
      pointPool: setup.poolStart, roundNum: 1, roundHistory: [],
      lastRandomRevealCat: null, gameOver: false,
    };
    startRound();
  }

  function startRound() {
    const poke = mp.pool[Math.floor(rng() * mp.pool.length)];
    mp.round = new PokeGuessRound({ genData: data, movelist, rng });
    mp.round.start({
      difficultyId: 'custom', poolFilter, mystery: poke, catDiversity: mp.catDiversity,
      custom: { points: mp.poolStart, guessCost: 0, startClueMode: 'none' },
    });
    mp.pointPool = mp.poolStart;
    mp.phase = mp.gameMode === 'rtg' ? 'reveal' : 'guess';
    mp.turnHasRevealed = false;
    mp.lastRandomRevealCat = null;
    mp._roundGuesses = [];
    acIndex = -1;
    showGame();
  }

  // ===== GAME SCREEN ========================================================
  function showGame() {
    const cur = mp.players[mp.turnOrder[mp.currentTurnPos]];
    clear(root).append(
      el('div', { class: 'game-topbar' },
        el('button', { class: 'btn-secondary game-exit', onClick: () => {
        if (confirm('Quit? Progress will be lost.')) {
          if (mp && mp.round && mp.round.mystery && !mp.gameOver) markSeen(mp.round.mystery.name); // #17b
          onExit && onExit();
        }
      } }, '\u2190 Quit'),
        el('div', { class: 'mp-topbar-info' },
          el('div', { class: 'mp-round-badge', id: 'mp-round-badge' }, `Round ${mp.roundNum}`),
          el('div', { class: 'mp-target-badge' }, data.id === 'gen1' ? 'Gen 1' : 'Gen 2'),
          el('div', { class: 'mp-target-badge' }, `Win: ${mp.winTarget} pts`)),
        el('div', { class: 'mp-pool-display' },
          el('div', { class: 'points-number', id: 'mp-pool-pts' }, `${mp.pointPool} pts`),
          el('div', { class: 'points-bar-track' }, el('div', { class: 'points-bar-fill', id: 'mp-pool-bar' })))),
      el('div', { class: 'game-body' },
        el('div', { class: 'clue-panel', id: 'mp-clue-panel' }),
        el('div', { class: 'game-side' },
          playerScoreboard(),
          el('div', { class: 'guess-block', id: 'mp-action-block' }),
          el('div', { class: 'mp-guess-log', id: 'mp-guess-log' }),
          el('div', { class: 'revealed-summary', id: 'mp-revealed' }))),
      el('div', { class: 'mp-overlay', id: 'mp-overlay' }));
    renderCluePanel();
    renderRevealed();
    renderActionBlock();
    updatePool();
  }

  function updatePool() {
    const n = root.querySelector('#mp-pool-pts'); const b = root.querySelector('#mp-pool-bar');
    if (n) n.textContent = `${mp.pointPool} pts`;
    if (b) {
      const pct = mp.poolStart > 0 ? mp.pointPool / mp.poolStart : 0;
      b.style.width = `${Math.max(0, pct * 100)}%`;
      b.style.background = pct > 0.5 ? '#29cc66' : pct > 0.25 ? '#f0c020' : '#e04040';
    }
  }

  function playerScoreboard() {
    return el('div', { class: 'mp-scoreboard' },
      ...mp.players.map((p) => {
        const isCur = p.id === mp.turnOrder[mp.currentTurnPos];
        return el('div', { class: `mp-score-row${isCur ? ' active' : ''}`, style: { borderColor: isCur ? p.color : 'transparent' } },
          el('span', { class: 'mp-score-name', style: { color: p.color } }, p.name),
          el('span', { class: 'mp-score-pts' }, `${p.score} pts`));
      }));
  }

  // ---- clue grid -----------------------------------------------------------
  function renderCluePanel() {
    const panel = root.querySelector('#mp-clue-panel'); if (!panel) return;
    clear(panel);
    const r = mp.round, s = r.state;
    const cats = data.categories, clues = data.clues;
    panel.classList.remove('category-mode', 'random-mode');
    if (mp.clueMode === 'category') panel.classList.add('category-mode');
    if (mp.clueMode === 'random') panel.classList.add('random-mode');
    const phaseLocked = mp.phase !== 'reveal';
    for (const cat of cats) {
      const body = el('div', { class: 'cat-body' });
      for (const c of clues.filter((cl) => cl.cat === cat.id)) body.appendChild(mpCard(c, cat));
      if (!body.children.length) continue;
      if (mp.clueMode === 'category') {
        const diversityBlocked = r.categoryDiversityBlocked(cat.id);
        const hasRevealable = clues.some((c) => c.cat === cat.id && !mp.excludedIds.has(c.id)
          && r.clueAvailable(c) && !r.clueLimitInfo(c).atLimit && mp.pointPool >= r.clueCurrentCost(c.id));
        const blocked = phaseLocked || diversityBlocked || !hasRevealable;
        const reason = phaseLocked ? '' : diversityBlocked ? (mp.catDiversity === 'cycle' ? 'Pick from an unused category first' : 'Pick a different category first') : 'No clues left here';
        const header = el('div', { class: 'cat-header cat-header-reveal', style: { background: cat.bg } },
          el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name),
          !phaseLocked ? el('button', { class: 'cat-reveal-btn', disabled: blocked }, blocked ? reason : '\uD83C\uDFB2 Reveal') : null);
        const section = el('div', { class: 'cat-section cat-section-clickable' + (blocked ? ' reveal-disabled' : '') }, header, body);
        if (!blocked) section.addEventListener('click', (e) => { if (e.target.closest('.cat-body')) return; revealFromCategory(cat.id); });
        panel.appendChild(section);
      } else {
        panel.appendChild(el('div', { class: 'cat-section' },
          el('div', { class: 'cat-header', style: { background: cat.bg } }, el('span', { class: 'cat-name', style: { color: cat.color } }, cat.name)),
          body));
      }
    }
  }

  function mpCard(clue, cat) {
    const r = mp.round, s = r.state;
    const hist = s.clueHistory[clue.id] || [];
    const uses = hist.length;
    const isRevealed = clue.id in r.revealedClues;
    const isMultiUse = clue.maxUses !== 1 || clue.costIncrement > 0;
    const currentCost = r.clueCurrentCost(clue.id);
    const isExcluded = mp.excludedIds.has(clue.id);
    const isPhaseReveal = mp.phase === 'reveal';
    const card = el('button', { class: 'clue-btn', dataset: { clue: clue.id } });

    if (isRevealed && !isMultiUse) {
      card.classList.add('revealed');
      Object.assign(card.style, { background: cat.bg, borderColor: cat.color });
      // #6 (requested): labeled stat spread (HP/Atk/Def/...), matching
      // single.js/victoryroad.js — was a bare number string before.
      const revealedValueEl = clue.field === 'fullStats'
        ? el('div', { class: 'clue-revealed-value' }, statSpreadEl(String(r.revealedClues[clue.id])))
        : el('div', { class: 'clue-revealed-value' }, String(r.revealedClues[clue.id]));
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name', style: { color: cat.color } }, clue.name)),
        revealedValueEl);
      return card;
    }
    // #17-adjacent finding: a multi-use clue that's now exhausted (hit its cap,
    // e.g. all weaknesses shown) must still show what it revealed, not collapse
    // into a bare "unavailable" card — mirrors single.js's exhaustion display.
    if (isMultiUse && r.clueExhausted(clue)) {
      card.classList.add('unavailable');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name),
        el('span', { class: 'clue-cost-badge', style: { background: '#555' } }, `${clue.cost}pt`)),
        el('div', { class: 'clue-unavail-note' }, '\u2717 ' + (hist[hist.length - 1] || 'Exhausted')));
      return card;
    }
    if (isExcluded || !r.clueAvailable(clue)) {
      card.classList.add('unavailable');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name),
        el('span', { class: 'clue-cost-badge', style: { background: '#555' } }, `${clue.cost}pt`)));
      return card;
    }
    // Category-diversity gate — only meaningful in "Choose" mode (#15c); Random
    // and By-category reveal through their own dedicated controls instead.
    if (mp.clueMode === 'choose' && r.diversityBlocked(clue)) {
      card.classList.add('unavailable', 'prereq-blocked');
      card.append(el('div', { class: 'clue-top' }, el('span', { class: 'clue-btn-name' }, clue.name),
        el('span', { class: 'clue-cost-badge', style: { background: '#555' } }, `${clue.cost}pt`)),
        el('div', { class: 'clue-unavail-note' }, mp.catDiversity === 'cycle' ? 'Pick from an unused category first' : 'Pick a different category first'));
      return card;
    }
    if (mp.pointPool < currentCost || !isPhaseReveal) card.classList.add('cant-afford');
    const costs = data.clues.map((c) => c.cost);
    const lo = Math.min(...costs), hi = Math.max(...costs);
    const t = hi > lo ? (currentCost - lo) / (hi - lo) : 0;
    const bg = `hsl(${Math.round(120 * (1 - t))},${62 + Math.round(18 * Math.abs(t - 0.5) * 2)}%,${40 + Math.round(6 * (1 - Math.abs(t - 0.5) * 2))}%)`;
    const useBadge = (isMultiUse && uses > 0) ? el('span', { class: 'clue-use-badge' }, `use ${uses + 1}`) : null;
    if (isMultiUse && uses > 0) {
      card.classList.add('revealed');
      Object.assign(card.style, { background: cat.bg, borderColor: cat.color });
    }
    card.append(el('div', { class: 'clue-top' },
      el('span', { class: 'clue-btn-name', style: isMultiUse && uses > 0 ? { color: cat.color } : {} }, clue.name),
      el('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
        el('span', { class: 'clue-cost-badge', style: { background: bg } }, `${currentCost}pt`), useBadge)));
    for (let i = 0; i < hist.length; i++) {
      card.append(el('div', { class: 'clue-revealed-value', style: { fontSize: i ? '11px' : '12px', opacity: i ? '0.8' : '1' } },
        (i ? `#${i + 1} ` : '') + hist[i]));
    }
    // Cards are clickable ONLY in "Choose" mode (#11/#15b) — Random and
    // By-category reveal through the action block / category header instead.
    if (mp.clueMode === 'choose' && isPhaseReveal) card.addEventListener('click', () => revealClue(clue.id));
    return card;
  }

  // ---- reveal --------------------------------------------------------------
  function revealClue(id, { auto = false } = {}) {
    if (mp.phase !== 'reveal') return;
    const clue = data.clues.find((c) => c.id === id);
    if (!clue || mp.excludedIds.has(id)) return;
    const r = mp.round;
    if (!r.clueAvailable(clue)) return;
    if (mp.pointPool < clue.cost) return;
    const res = r.buyClue(id, { auto });
    if (!res.ok) return;
    mp.pointPool = Math.max(0, mp.pointPool - clue.cost);
    const cur = mp.players[mp.turnOrder[mp.currentTurnPos]];
    cur.clueCount++; cur.clueCostTotal += clue.cost;
    mp.turnHasRevealed = true;
    applyEvoDeductions();
    if (mp.gameMode === 'gtr') {
      // #9 — GTR's reveal phase is only ever reached after a wrong guess, and
      // is exactly ONE mandatory clue: the turn passes immediately to the next
      // player. No further reveals, no skipping back to guess yourself.
      nextTurn();
      return;
    }
    if (mp.gameMode === 'rtg') mp.phase = 'guess';
    updatePool();
    renderCluePanel();
    renderRevealed();
    renderActionBlock();
  }

  function revealRandom() {
    if (mp.phase !== 'reveal') return;
    const r = mp.round;
    const available = data.clues.filter((c) =>
      !mp.excludedIds.has(c.id) && r.clueAvailable(c) && mp.pointPool >= r.clueCurrentCost(c.id));
    if (!available.length) { skipReveal(); return; }
    const pen = data.multiClue?.randomRevealCategoryPenalty ?? 0.25;
    const weights = available.map((c) => (1 / Math.max(1, r.clueCurrentCost(c.id))) * (c.cat === mp.lastRandomRevealCat ? pen : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = available[available.length - 1];
    let rr = rng() * (total || 1);
    for (let i = 0; i < available.length; i++) { rr -= weights[i]; if (rr <= 0) { pick = available[i]; break; } }
    mp.lastRandomRevealCat = pick.cat;
    revealClue(pick.id, { auto: true });
  }

  // "By category" clue selection (#11/#15b.iii): a category header click reveals
  // a random clue from THAT category only. Mirrors revealRandom()'s pattern
  // (same excludedIds/pointPool awareness) rather than the engine's own
  // autoRevealFromCategory, since only this local pool understands exclusions.
  function revealFromCategory(catId) {
    if (mp.phase !== 'reveal') return;
    const r = mp.round;
    if (r.categoryDiversityBlocked(catId)) return; // header should already be disabled
    const available = data.clues.filter((c) =>
      c.cat === catId && !mp.excludedIds.has(c.id) && r.clueAvailable(c) && mp.pointPool >= r.clueCurrentCost(c.id));
    if (!available.length) return;
    const pen = data.multiClue?.randomRevealCategoryPenalty ?? 0.25;
    const weights = available.map((c) => (1 / Math.max(1, r.clueCurrentCost(c.id))) * (c.cat === mp.lastRandomRevealCat ? pen : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = available[available.length - 1];
    let rr = rng() * (total || 1);
    for (let i = 0; i < available.length; i++) { rr -= weights[i]; if (rr <= 0) { pick = available[i]; break; } }
    mp.lastRandomRevealCat = pick.cat;
    revealClue(pick.id, { auto: true });
  }

  function skipReveal() {
    mp.turnHasRevealed = false;
    nextTurn();
  }

  function applyEvoDeductions() {
    computeAutoDeducedIds(mp.round, mp.excludedIds);
  }

  // ---- action block (phase-dependent) -------------------------------------
  function renderActionBlock() {
    const block = root.querySelector('#mp-action-block'); if (!block) return;
    clear(block);
    const cur = mp.players[mp.turnOrder[mp.currentTurnPos]];
    block.append(el('div', { class: 'mp-active-player', style: { color: cur.color } },
      `${cur.name}\u2019s turn \u2014 `, el('span', { class: 'mp-phase-label' },
        mp.phase === 'reveal' ? 'reveal a clue' : 'make a guess')));
    if (mp.phase === 'reveal') {
      // #9 — GTR's reveal phase (only reached after a wrong guess) must yield
      // exactly one reveal: no "skip reveal" (which would let the turn end
      // with ZERO reveals) and no "skip to guess" (which would let the SAME
      // player guess again instead of passing the turn, or stop short of the
      // reveal revealClue() now forces automatically anyway).
      const gtrForcedReveal = mp.gameMode === 'gtr';
      if (mp.clueMode === 'random') {
        block.append(el('button', { class: 'btn-bait', style: { width: '100%' }, onClick: revealRandom }, '\uD83C\uDF6F Reveal a random clue'));
        if (!gtrForcedReveal) {
          block.append(el('button', { class: 'btn-secondary', style: { width: '100%', marginTop: '8px', fontSize: '12px' }, onClick: skipReveal }, 'Skip reveal'));
        }
      } else if (mp.clueMode === 'category') {
        block.append(el('p', { class: 'mp-phase-hint' }, 'Click a category to reveal a random clue from it'));
        if (!gtrForcedReveal && mp.turnHasRevealed) {
          block.append(el('button', { class: 'btn-secondary', style: { width: '100%', fontSize: '12px' }, onClick: () => { mp.phase = 'guess'; renderActionBlock(); renderCluePanel(); } }, 'Skip to guess \u25b6'));
        }
      } else {
        block.append(el('p', { class: 'mp-phase-hint' }, 'Click a clue to reveal it'));
        if (!gtrForcedReveal && mp.turnHasRevealed) {
          block.append(el('button', { class: 'btn-secondary', style: { width: '100%', fontSize: '12px' }, onClick: () => { mp.phase = 'guess'; renderActionBlock(); renderCluePanel(); } }, 'Skip to guess \u25b6'));
        }
      }
    } else {
      // Guess phase
      const inp = el('input', { class: 'guess-input', id: 'mp-guess', type: 'text',
        placeholder: 'Which Pok\u00e9mon?', autocomplete: 'off',
        onInput: (e) => renderAuto(e.target.value), onKeydown: onGuessKey });
      block.append(
        el('div', { class: 'guess-input-wrap' },
          inp,
          el('button', { class: 'guess-btn', onClick: submitFromInput }, 'Guess'),
          el('div', { class: 'autocomplete-list', id: 'mp-ac' })),
        el('div', { class: 'guess-feedback', id: 'mp-feedback' }));
      setTimeout(() => inp.focus(), 30);
    }
  }

  // ---- guessing -----------------------------------------------------------
  function submitFromInput() { const i = root.querySelector('#mp-guess'); if (i) doGuess(i.value); }
  function doGuess(name) {
    if (mp.phase !== 'guess' || mp.gameOver) return;
    closeAuto();
    const val = String(name || '').trim(); if (!val) return;
    const cur = mp.players[mp.turnOrder[mp.currentTurnPos]];
    cur.guessesTotal++;
    (mp._roundGuesses ||= []).push({ pid: cur.id, name: val, correct: normalizeName(val) === normalizeName(mp.round.mystery.name) });
    if (normalizeName(val) === normalizeName(mp.round.mystery.name)) {
      cur.guessesCorrect++; cur.roundsWon++;
      const earned = mp.pointPool;
      cur.score += earned; cur.pointsEarned += earned;
      roundEnd(cur.id, earned);
    } else {
      cur.guessesWrong++;
      if (mp.guessCost > 0) mp.pointPool = Math.max(0, mp.pointPool - mp.guessCost);
      const fb = root.querySelector('#mp-feedback');
      if (fb) { fb.className = 'guess-feedback error'; fb.textContent = `Not ${val}! Try again next turn.`; setTimeout(() => { if (fb) fb.textContent = ''; }, 2500); }
      const inp = root.querySelector('#mp-guess'); if (inp) { inp.value = ''; inp.classList.add('wrong-flash'); setTimeout(() => inp.classList.remove('wrong-flash'), 500); }
      renderGuessLog();
      if (mp.gameMode === 'gtr') {
        mp.phase = 'reveal';
        renderActionBlock(); renderCluePanel(); updatePool();
      } else {
        nextTurn();
      }
    }
  }

  function nextTurn() {
    mp.currentTurnPos = (mp.currentTurnPos + 1) % mp.turnOrder.length;
    mp.phase = mp.gameMode === 'rtg' ? 'reveal' : 'guess';
    mp.turnHasRevealed = false;
    updatePool(); renderCluePanel(); renderRevealed(); renderActionBlock(); renderGuessLog();
    updateActivePlayer();
  }
  function renderGuessLog() {
    const log = root.querySelector('#mp-guess-log'); if (!log) return;
    // collect all guesses for this round from all players
    const guesses = mp.players.flatMap((p) =>
      (mp._roundGuesses || []).filter((g) => g.pid === p.id).map((g) => ({ ...g, color: p.color, pname: p.name })));
    if (!guesses.length) { log.textContent = ''; return; }
    log.textContent = '';
    log.append(el('div', { style: { fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-pixel)', marginBottom: '4px' } }, 'Guesses this round:'));
    guesses.forEach((g) => log.append(
      el('div', { class: 'mp-guess-log-item ' + (g.correct ? 'correct' : 'wrong') },
        el('span', { style: { color: g.color, fontWeight: 700 } }, g.pname + ': '),
        g.name)));
  }

  function updateActivePlayer() {
    // re-render scoreboard in place
    const side = root.querySelector('.game-side'); if (!side) return;
    const old = side.querySelector('.mp-scoreboard');
    if (old) old.replaceWith(playerScoreboard());
  }

  // ---- revealed summary ---------------------------------------------------
  function renderRevealed() {
    const box = root.querySelector('#mp-revealed'); if (!box) return;
    clear(box);
    const rv = mp.round.revealedClues;
    const ids = Object.keys(rv).map(Number); if (!ids.length) { box.append(el('div', { class: 'rev-empty' }, 'No clues revealed yet.')); return; }
    box.append(el('div', { class: 'rev-cat-label' }, 'Revealed'));
    for (const id of ids) {
      const c = data.clues.find((cl) => cl.id === id);
      box.append(el('div', { class: 'rev-item' },
        el('span', { class: 'rev-item-name' }, c ? c.name : `#${id}`),
        el('span', { class: 'rev-item-value' }, String(rv[id]))));
    }
  }

  // ---- autocomplete -------------------------------------------------------
  function renderAuto(q) {
    const list = root.querySelector('#mp-ac'); if (!list) return;
    const query = normalizeName(q); if (!query) { closeAuto(); return; }
    const matches = mp.round.allNames.filter((n) => n.toLowerCase().includes(query)).slice(0, 10);
    if (!matches.length) { closeAuto(); return; }
    acIndex = -1; clear(list);
    matches.forEach((n) => list.appendChild(el('div', { class: 'ac-item', dataset: { name: n }, onClick: () => doGuess(n) }, n)));
    list.classList.add('open');
  }
  function onGuessKey(e) {
    const list = root.querySelector('#mp-ac'); const items = list ? [...list.querySelectorAll('.ac-item')] : [];
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, -1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (acIndex >= 0 && items[acIndex]) doGuess(items[acIndex].dataset.name); else submitFromInput(); }
    else if (e.key === 'Escape') closeAuto();
  }
  function closeAuto() { const list = root.querySelector('#mp-ac'); if (list) { list.classList.remove('open'); clear(list); } acIndex = -1; }

  // ---- round end overlay --------------------------------------------------
  function roundEnd(winnerId, earned) {
    const winner = mp.players[winnerId];
    const poke = mp.round.mystery;
    markCaught(poke.name); // #17a — hotseat shares one device/tracker, so a win by any player catches it
    const cluesCount = Object.keys(mp.round.revealedClues).length;
    mp.roundHistory.push({
      round: mp.roundNum, pokemon: poke.name, type1: poke.type1, type2: poke.type2,
      winnerId, winnerName: winner.name, pointsEarned: earned, cluesRevealed: cluesCount,
    });
    // winner rotates to end
    mp.turnOrder.splice(mp.turnOrder.indexOf(winnerId), 1);
    mp.turnOrder.push(winnerId);
    mp.currentTurnPos = 0;
    mp.roundNum++;
    const isGameEnd = mp.players.some((p) => p.score >= mp.winTarget);
    if (isGameEnd) mp.gameOver = true;
    showRoundOverlay(winner, isGameEnd);
  }

  function showRoundOverlay(winner, isGameEnd) {
    const overlay = root.querySelector('#mp-overlay'); if (!overlay) return;
    const sorted = [...mp.players].sort((a, b) => b.score - a.score);
    const types = [mp.round.mystery.type1, ...(mp.round.mystery.type2 && mp.round.mystery.type2 !== '\u2014' ? [mp.round.mystery.type2] : [])];
    const typePills = types.map((t) => `<span class="type-pill type-${t.toLowerCase()}" style="font-size:10px;padding:2px 8px">${t}</span>`).join(' ');
    const standings = sorted.map((p, i) =>
      `<div class="rec-standing-row${p.id === winner.id ? ' leader' : ''}">
        <span class="rs-rank">${PLACE_EMOJI[i]}</span>
        <span style="flex:1;font-weight:${p.id === winner.id ? 800 : 600}">${p.name}</span>
        <span class="rs-score" style="color:${p.color}">${p.score} pts</span>
      </div>`).join('');
    overlay.innerHTML = `
      <div class="round-end-card">
        <div class="rec-winner">${isGameEnd ? '\uD83C\uDFC6 Game Over!<br>' : ''}\uD83C\uDF89 ${winner.name} got it!</div>
        <div class="rec-pokemon">The Pok\u00e9mon was: <strong>${mp.round.mystery.name}</strong></div>
        <div style="display:flex;gap:6px;justify-content:center;margin-bottom:12px">${typePills}</div>
        <div class="rec-earned">+${earned()} pts earned</div>
        <div class="rec-standings"><div class="rec-standings-title">Standings</div>${standings}</div>
        ${isGameEnd
          ? `<button class="rec-next-btn" id="rec-go-summary">See Final Results \uD83C\uDFC6</button>`
          : `<button class="rec-next-btn" id="rec-next-round">\u25b6 Round ${mp.roundNum}</button>`}
      </div>`;
    overlay.style.display = 'flex';
    const btn = overlay.querySelector('#rec-go-summary') || overlay.querySelector('#rec-next-round');
    if (btn) btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      isGameEnd ? showSummary() : startRound();
    });
    function earned() { return mp.roundHistory[mp.roundHistory.length - 1].pointsEarned; }
  }

  // ===== FINAL SUMMARY ======================================================
  function showSummary() {
    const sorted = [...mp.players].sort((a, b) => b.score - a.score);
    const podiumOrder = sorted.length === 2 ? [sorted[1], sorted[0]] :
      sorted.length === 3 ? [sorted[1], sorted[0], sorted[2]] :
      [sorted[1], sorted[0], sorted[2], sorted[3]];
    const podiumClasses = ['p2', 'p1', 'p3', 'p4'];
    const podiumLabels = ['2nd', '1st', '3rd', '4th'];

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' },
            el('div', { class: 'summary-result' }, '\uD83C\uDFC6 Game Over'),
            el('div', { class: 'summary-mon' }, `${sorted[0].name} wins!`)),
          el('div', { class: 'mp-podium' },
            ...podiumOrder.filter(Boolean).map((p, i) => {
              const rank = sorted.indexOf(p);
              return el('div', { class: 'podium-slot' },
                el('div', { class: `podium-block ${podiumClasses[i]}`, style: { borderColor: p.color + '55' } },
                  el('div', { class: 'podium-place' }, PLACE_EMOJI[rank]),
                  el('div', { class: 'podium-name', style: { color: p.color } }, p.name),
                  el('div', { class: 'podium-score', style: { color: p.color } }, String(p.score)),
                  el('div', { class: 'podium-wins' }, `${p.roundsWon} win${p.roundsWon !== 1 ? 's' : ''}`)));
            })),
          el('div', { class: 'mp-stat-grid' },
            ...sorted.map((p) => playerStatCard(p))),
          roundHistoryTable(),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showSetup }, 'Play again'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));
  }

  function playerStatCard(p) {
    const acc = p.guessesTotal > 0 ? Math.round(p.guessesCorrect / p.guessesTotal * 100) : 0;
    const avg = p.roundsWon > 0 ? Math.round(p.pointsEarned / p.roundsWon) : 0;
    return el('div', { class: 'mp-stat-card' },
      el('h4', { style: { color: p.color, fontFamily: 'var(--font-pixel)', fontSize: '9px' } }, p.name),
      ...[ ['Final Score', `${p.score} pts`], ['Rounds Won', p.roundsWon],
           ['Guess Accuracy', `${acc}%`], ['Wrong Guesses', p.guessesWrong],
           ['Clues Revealed', p.clueCount], ['Avg pts/win', avg] ]
        .map(([l, v]) => el('div', { class: 'mp-stat-row' },
          el('span', { class: 'mp-stat-label' }, l), el('span', { class: 'mp-stat-val' }, String(v)))));
  }

  function roundHistoryTable() {
    const rows = mp.roundHistory;
    let open = false;
    const body = el('tbody', {},
      ...rows.map((r) => el('tr', {},
        el('td', {}, `R${r.round}`), el('td', {}, r.pokemon),
        el('td', { style: { color: mp.players[r.winnerId]?.color } }, r.winnerName),
        el('td', {}, `${r.pointsEarned} pts`),
        el('td', {}, `${r.cluesRevealed} clues`))));
    const table = el('div', { style: { display: 'none', overflowX: 'auto', marginTop: '8px' } },
      el('table', { class: 'mp-history-table' },
        el('thead', {}, el('tr', {}, ...['Rnd', 'Pokémon', 'Winner', 'Pts', 'Clues'].map((h) => el('th', {}, h)))),
        body));
    const tog = el('button', { class: 'mp-history-toggle', onClick: () => { open = !open; table.style.display = open ? '' : 'none'; tog.textContent = (open ? '\u25bc' : '\u25b6') + ` Round history (${rows.length} rounds)`; } },
      `\u25b6 Round history (${rows.length} rounds)`);
    return el('div', { style: { marginTop: '16px' } }, tog, table);
  }

  // ---- utils ---------------------------------------------------------------
  function clampInt(v, lo, hi, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
  const onDocClick = (e) => { if (!e.target.closest('.guess-input-wrap')) closeAuto(); };
  document.addEventListener('click', onDocClick);

  return {
    destroy() { document.removeEventListener('click', onDocClick); mp = null; clear(mount); },
  };
}

export default createMultiplayer;
