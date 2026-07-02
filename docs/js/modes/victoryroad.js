/**
 * @file        js/modes/victoryroad.js
 * @version     1.2.0
 * @updated     2026-06-24
 * @changelog
 *   1.2.0 — Gen 2 mode draws from the full dex (#13).
 *   1.1.0 — Tier rows expandable/collapsible: click to reveal clue names.
 *   1.0.0 — Victory Road, ported from the canonical screen. Endless streak
 *           gauntlet: one guess per Pokémon, wrong = game over. Pre-revealed
 *           clues shrink as the streak climbs through 8 tiers (fewer clues =
 *           harder). Perfect sweep (all 251 named) triggers an overlay; can
 *           continue for more laps. Live timer tracks total run and per-Pokémon
 *           time. All clue reveals go through engine.js; tier clue IDs are
 *           resolved by special/field so one controller serves both gens.
 *
 * Contract: createVictoryRoad({ mount, config, data, params, onExit }) → { destroy }
 */

import { el, clear, statSpreadEl, genBar } from '../lib/dom.js';
import { PokeGuessRound, normalizeName, poolFilterForData, matchesPool } from '../lib/engine.js';
import { submitScore } from '../lib/leaderboard-data.js';

// Tier definitions (streak thresholds + which clue specials/fields to pre-reveal).
// Specials/fields listed in render order; the controller resolves them to actual
// clue IDs at runtime so Gen 1 and Gen 2 work with the same tier table.
const VR_TIERS = [
  { minStreak:   0, label: 'Tier 1',
    slots: ['generation','evoStage','compMovesetMulti','bstRange','fullStats','randomType','secondType','habitat','eggMoveMulti','firstAnime','gymLeader','e4'] },
  { minStreak:   5, label: 'Tier 2',
    slots: ['generation','evoStage','compMovesetMulti','bstRange','fullStats','randomType','secondType','firstAnime','gymLeader','e4'] },
  { minStreak:  10, label: 'Tier 3',
    slots: ['generation','evoStage','compMovesetMulti','bstRange','fullStats','randomType','gymLeader','e4'] },
  { minStreak:  20, label: 'Tier 4',
    slots: ['generation','evoStage','compMovesetMulti','fullStats','randomType','gymLeader','e4'] },
  { minStreak:  50, label: 'Tier 5',
    slots: ['generation','evoStage','compMovesetMulti','fullStats'] },
  { minStreak: 100, label: 'Tier 6',
    slots: ['generation','evoStage','compMovesetMulti','highestStat','highestStatVal','lowestStat','lowestStatVal'] },
  { minStreak: 175, label: 'Tier 7',
    slots: ['generation','evoStage','compMovesetMulti'] },
  { minStreak: 200, label: 'Tier 8',
    slots: ['generation','evoStage','compMovesetMulti'] },
];

function getTier(streak) {
  let t = VR_TIERS[0];
  for (const tier of VR_TIERS) { if (streak >= tier.minStreak) t = tier; else break; }
  return t;
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

export function createVictoryRoad({ mount, config, data, params = {}, onExit }) {
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
  let movelist = {};
  let vr = null; // runtime state
  let timerInterval = null;
  let acIndex = -1;

  // Resolve tier slots (special/field strings) to live clue IDs once per session.
  // Slot names use Gen-2 vocabulary; map the Gen-1 variants here so each tier
  // resolves to the right clue per generation (#9).
  const clueBySpecial = new Map();
  const clueByField = new Map();
  for (const c of data.clues) {
    if (c.special && !clueBySpecial.has(c.special)) clueBySpecial.set(c.special, c);
    if (c.field && !clueByField.has(c.field)) clueByField.set(c.field, c);
  }
  const SLOT_ALIASES = {
    e4: ['e4', 'e4Gen1', 'e4RedCal', 'e4Rival'],
    gymLeader: ['gymLeader', 'gymLeaderYN'],
    randomType: ['randomType', 'type1'],
    secondType: ['secondType', 'type2'],
    battleTower: ['battleTower', 'exampleMovesetMulti', 'exampleMoveset'],
  };
  const resolveSlot = (slot) => {
    for (const key of (SLOT_ALIASES[slot] || [slot])) {
      const hit = clueBySpecial.get(key) || clueByField.get(key);
      if (hit) return hit;
    }
    return null;
  };

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; })
    .catch(() => { movelist = {}; })
    .finally(showConfig);

  // ---- CONFIG SCREEN -------------------------------------------------------
  function showConfig() {
    // Build expandable tier preview — resolve slot names to clue labels
    const tierRows = VR_TIERS.map((t) => {
      const clueNames = t.slots.map((slot) => {
        const c = resolveSlot(slot);
        return c ? c.name : slot;
      });
      const header = el('div', { class: 'vr-tier-row', dataset: { expanded: 'false' } },
        el('span', { class: 'vr-tier-label' }, t.label),
        el('span', { class: 'vr-tier-streak' }, t.minStreak === 0 ? 'Start' : `${t.minStreak}+`),
        el('span', { class: 'vr-tier-slots' }, `${t.slots.length} clues`),
        el('span', { class: 'vr-tier-chevron' }, '▶'));
      const detail = el('div', { class: 'vr-tier-detail' },
        ...clueNames.map((name) => el('span', { class: 'vr-tier-clue-tag' }, name)));
      header.addEventListener('click', () => {
        const open = header.dataset.expanded === 'true';
        header.dataset.expanded = String(!open);
        header.querySelector('.vr-tier-chevron').textContent = open ? '▶' : '▼';
        detail.classList.toggle('open', !open);
      });
      return el('div', {}, header, detail);
    });

    clear(root).append(
      genBar(params.modeId || 'victoryroad', params.gen || (data.id === 'gen1' ? 1 : 2)),
      el('div', { class: 'sp-section-title' }, '\uD83D\uDDFB Victory Road'),
      el('p', { class: 'sf-intro' },
        'One guess per Pok\u00e9mon. Wrong answer = game over. Fewer clues as your streak grows. '
        + 'Name all 251 for a perfect sweep!'),
      el('div', { class: 'vr-tier-preview' }, ...tierRows),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-primary', onClick: begin }, '\uD83D\uDDFB Enter Victory Road \u25b6')));
  }

  // ---- BEGIN ---------------------------------------------------------------
  function begin() {
    const pool = shuffle(data.pokedex.filter((p) => matchesPool(p.num, poolFilter)));
    const now = Date.now();
    vr = { streak: 0, pool, poolIdx: 0, perfectLaps: 0, startTime: now, pokeStartTime: now, bestPokeMs: null, totalMs: 0, round: null };
    startTimer();
    nextMon();
  }

  // ---- PER-MON ROUND -------------------------------------------------------
  function nextMon() {
    if (!vr) return;
    if (vr.poolIdx >= vr.pool.length) {
      vr.perfectLaps++;
      stopTimer();
      showPerfectOverlay();
      return;
    }
    const poke = vr.pool[vr.poolIdx++];
    vr.round = new PokeGuessRound({ genData: data, movelist, rng });
    vr.round.start({
      difficultyId: 'custom', poolFilter, mystery: poke,
      custom: { points: 999, guessCost: 0, startClueMode: 'none' },
    });
    vr.pokeStartTime = Date.now();
    acIndex = -1;

    // Pre-reveal tier clues
    const tier = getTier(vr.streak);
    const r = vr.round;
    const seen = new Set();
    for (const slot of tier.slots) {
      const clue = resolveSlot(slot);
      if (!clue || seen.has(clue.id)) continue;
      // eggMoveMulti: reveal up to 3
      if (clue.special === 'eggMoveMulti') {
        for (let i = 0; i < 3; i++) {
          if (!r.clueAvailable(clue)) break;
          const res = r.buyClue(clue.id, { auto: true });
          if (!res.ok || !res.value || res.value.startsWith('No more')) break;
        }
        seen.add(clue.id); continue;
      }
      // compMovesetMulti: reveal all available
      if (clue.special === 'compMovesetMulti') {
        for (let i = 0; i < 4; i++) {
          if (!r.clueAvailable(clue)) break;
          const res = r.buyClue(clue.id, { auto: true });
          if (!res.ok || !res.value || res.value.startsWith('No more')) break;
        }
        seen.add(clue.id); continue;
      }
      // secondType: reveal even for mono-type mons so the ribbon shows "—"
      // (the engine returns "— (pure X-type)") rather than hiding it (#17).
      if (r.clueAvailable(clue)) r.buyClue(clue.id, { auto: true });
      seen.add(clue.id);
    }
    showGame();
  }

  // ---- GAME SCREEN ---------------------------------------------------------
  function showGame() {
    const tier = getTier(vr.streak);
    clear(root).append(
      el('div', { class: 'game-topbar' },
        el('button', { class: 'btn-secondary game-exit', onClick: () => onExit && onExit() }, '\u2190 Quit'),
        el('div', { class: 'vr-topbar-center' },
          el('div', { class: 'vr-streak', id: 'vr-streak' }, String(vr.streak)),
          el('div', { class: 'vr-streak-label' }, 'streak'),
          el('div', { class: 'vr-tier-badge', id: 'vr-tier' }, tier.label)),
        el('div', { class: 'vr-timers' },
          el('div', { class: 'vr-time', id: 'vr-total-time' }, '0:00'),
          el('div', { class: 'vr-poke-time', id: 'vr-poke-time' }, 'this: 0.0s'))),
      el('div', { class: 'vr-ribbon-wrap' },
        vr.tierBanner ? tierBannerEl(vr.tierBanner) : null,
        el('div', { class: 'vr-clue-ribbon', id: 'vr-ribbon' })),
      el('div', { class: 'vr-guess-area' },
        el('div', { class: 'guess-input-wrap' },
          el('input', { class: 'guess-input', id: 'vr-guess', type: 'text', placeholder: 'Name the Pok\u00e9mon\u2026', autocomplete: 'off',
            onInput: (e) => renderAuto(e.target.value), onKeydown: onGuessKey }),
          el('button', { class: 'guess-btn', onClick: submitFromInput }, 'Guess'),
          el('div', { class: 'autocomplete-list', id: 'vr-ac' })),
        el('div', { class: 'guess-feedback', id: 'vr-feedback' }),
        el('div', { class: 'vr-best-flash', id: 'vr-best-flash' })),
      el('div', { class: 'vr-perfect-overlay', id: 'vr-perfect-overlay' },
        el('div', { class: 'vr-perfect-box' },
          el('div', { class: 'vr-perfect-title', id: 'vr-perfect-title' }),
          el('div', { class: 'vr-perfect-sub', id: 'vr-perfect-sub' }),
          el('div', { class: 'vr-perfect-streak', id: 'vr-perfect-streak' }),
          el('button', { class: 'btn-primary', onClick: perfectContinue }, 'Keep going \u25b6'),
          el('button', { class: 'btn-secondary', style: { marginTop: '8px' }, onClick: perfectEnd }, 'Bank my streak'))),
    );
    renderRibbon();
    vr.tierBanner = null;   // one-shot: only on the mon right after promotion
    const inp = root.querySelector('#vr-guess'); if (inp) setTimeout(() => inp.focus(), 50);
  }

  function tierBannerEl(b) {
    return el('div', { class: 'vr-tier-banner' },
      el('div', { class: 'vr-tier-banner-head' }, `\u2B06\uFE0F New tier: ${b.tier}`),
      el('div', { class: 'vr-tier-banner-sub' }, 'Fewer clues from here on \u2014 lean on what you know.'),
      (b.lost && b.lost.length)
        ? el('div', { class: 'vr-tier-banner-lost' }, 'No longer shown: ' + b.lost.join(', '))
        : null);
  }

  // ---- CLUE RIBBON ---------------------------------------------------------
  // Chips grouped by category, in the canonical ribbon order
  const RIBBON_ORDER_SPECIALS = [
    'generation', 'evoStage', 'randomType', 'secondType', 'bstRange', 'habitat',
    'gymLeader', 'e4', 'firstAnime', 'fullStats', 'highestStat', 'highestStatVal',
    'lowestStat', 'lowestStatVal', 'eggMoveMulti', 'compMovesetMulti',
  ];
  const RIBBON_ORDER_FIELDS = [
    'generation', 'evoStage', 'type1', 'type2', 'bstRange', 'habitat',
    'gymLeader', 'e4Rival', 'e4RedCal', 'firstAnime', 'fullStats',
    'highestStat', 'highestStatVal', 'lowestStat', 'lowestStatVal',
  ];

  function chipOrder(clue) {
    const si = RIBBON_ORDER_SPECIALS.indexOf(clue.special);
    const fi = RIBBON_ORDER_FIELDS.indexOf(clue.field);
    const i = si >= 0 ? si : fi >= 0 ? fi + 100 : 999;
    return i;
  }

  function renderRibbon() {
    const ribbon = root.querySelector('#vr-ribbon');
    if (!ribbon) return;
    clear(ribbon);
    const r = vr.round;
    const rv = r.revealedClues;
    const hist = r.state.clueHistory;
    const ids = Object.keys(rv).map(Number).sort((a, b) => {
      const ca = r.clue(a), cb = r.clue(b);
      return (chipOrder(ca || {}) - chipOrder(cb || {}));
    });
    if (!ids.length) {
      ribbon.append(el('div', { class: 'vr-no-clues' }, 'No clues for this tier \u2014 name them from memory!'));
      return;
    }
    // Merge highestStat+Val and lowestStat+Val into single chips
    const skip = new Set();
    const highValId = clueByField.get('highestStatVal')?.id;
    const lowValId = clueByField.get('lowestStatVal')?.id;
    ids.forEach((id) => {
      const clue = r.clue(id); if (!clue) return;
      if (skip.has(id)) return;
      const isComp = clue.special === 'compMovesetMulti' || clue.special === 'compMoveset';
      const isEgg = clue.special === 'eggMoveMulti' || clue.special === 'eggMove';
      const isHighStat = clue.field === 'highestStat';
      const isLowStat = clue.field === 'lowestStat';
      const entries = hist[id] || [rv[id]];

      if (isComp) {
        entries.forEach((v, i) => {
          const chip = el('div', { class: 'vr-clue-chip core' },
            el('div', { class: 'vr-chip-label' }, entries.length > 1 ? `Comp Moveset ${i + 1}` : 'Comp Moveset'),
            el('div', {}, v));
          ribbon.append(chip);
        });
        return;
      }
      if (isEgg) {
        entries.forEach((v, i) => {
          ribbon.append(el('div', { class: 'vr-clue-chip' },
            el('div', { class: 'vr-chip-label' }, entries.length > 1 ? `Egg Move ${i + 1}` : 'Egg Move'),
            el('div', {}, v)));
        });
        return;
      }
      // Merge highest stat + value
      if (isHighStat && highValId && (highValId in rv)) {
        skip.add(highValId);
        ribbon.append(el('div', { class: 'vr-clue-chip' },
          el('div', { class: 'vr-chip-label' }, 'Highest Stat'),
          el('div', {}, `${rv[id]} (${rv[highValId]})`)));
        return;
      }
      if (id === highValId) { skip.add(id); return; }
      if (isLowStat && lowValId && (lowValId in rv)) {
        skip.add(lowValId);
        ribbon.append(el('div', { class: 'vr-clue-chip' },
          el('div', { class: 'vr-chip-label' }, 'Lowest Stat'),
          el('div', {}, `${rv[id]} (${rv[lowValId]})`)));
        return;
      }
      if (id === lowValId) { skip.add(id); return; }

      // Standard chip
      const label = clue.name || clue.field || '';
      const isCore = ['generation', 'evoStage', 'compMovesetMulti'].includes(clue.special)
        || ['evoStage', 'generation'].includes(clue.field);
      const isFullStats = clue.field === 'fullStats';
      const chip = el('div', { class: `vr-clue-chip${isCore ? ' core' : ''}` },
        el('div', { class: 'vr-chip-label' }, label));
      if (isFullStats) {
        chip.appendChild(statSpreadEl(String(rv[id])));
      } else {
        chip.appendChild(document.createTextNode(String(rv[id])));
      }
      ribbon.append(chip);
    });
  }

  // ---- GUESSING ------------------------------------------------------------
  function submitFromInput() { const i = root.querySelector('#vr-guess'); if (i) doGuess(i.value); }
  function doGuess(name) {
    if (!vr || !vr.round) return;
    closeAuto();
    const val = String(name || '').trim();
    if (!val) return;
    // #15 — only real Pokémon from this gen count; a typo must NOT end the run.
    if (!vr.round.allNames.some((n) => normalizeName(n) === normalizeName(val))) {
      showFeedback('Pick a Pok\u00e9mon from the list.', '#e0a060'); return;
    }
    const pokeMs = Date.now() - vr.pokeStartTime;
    const correct = normalizeName(val) === normalizeName(vr.round.mystery.name);
    if (correct) {
      const prevTier = getTier(vr.streak);
      vr.streak++;
      const newTier = getTier(vr.streak);
      if (newTier.label !== prevTier.label) {              // #23 — reached a new tier
        const newSlots = new Set(newTier.slots);
        const lost = prevTier.slots
          .filter((s) => !newSlots.has(s))
          .map((s) => { const c = resolveSlot(s); return c ? c.name : null; })
          .filter(Boolean);
        vr.tierBanner = { tier: newTier.label, lost };
      }
      const isNewBest = vr.bestPokeMs === null || pokeMs < vr.bestPokeMs;
      if (isNewBest) vr.bestPokeMs = pokeMs;
      showFeedback(`\u2705 Correct! Streak: ${vr.streak}  (${(pokeMs / 1000).toFixed(1)}s)`, '#50cc80');
      if (isNewBest && vr.streak > 1) {
        const flash = root.querySelector('#vr-best-flash');
        if (flash) {
          flash.textContent = `\u26a1 Best! ${(pokeMs / 1000).toFixed(1)}s`;
          flash.classList.add('show');
          setTimeout(() => flash.classList.remove('show'), 1800);
        }
      }
      root.querySelector('#vr-streak').textContent = String(vr.streak);
      root.querySelector('#vr-tier').textContent = getTier(vr.streak).label;
      setTimeout(() => { if (vr) nextMon(); }, 850);
    } else {
      vr.totalMs = Date.now() - vr.startTime;
      stopTimer();
      showFeedback(`\u274C Wrong! It was ${vr.round.mystery.name}. Game over!`, '#e06060');
      const inp = root.querySelector('#vr-guess'); if (inp) inp.disabled = true;
      setTimeout(() => showSummary(), 1400);
    }
  }
  function showFeedback(msg, color) {
    const f = root.querySelector('#vr-feedback');
    if (f) { f.textContent = msg; f.style.color = color; }
  }

  // ---- AUTOCOMPLETE --------------------------------------------------------
  function renderAuto(q) {
    const list = root.querySelector('#vr-ac'); if (!list) return;
    const query = normalizeName(q);
    if (!query) { closeAuto(); return; }
    const matches = vr.round.allNames.filter((n) => n.toLowerCase().includes(query)).slice(0, 10);
    if (!matches.length) { closeAuto(); return; }
    acIndex = -1; clear(list);
    matches.forEach((n) => list.appendChild(el('div', { class: 'ac-item', dataset: { name: n }, onClick: () => doGuess(n) }, n)));
    list.classList.add('open');
  }
  function onGuessKey(e) {
    const list = root.querySelector('#vr-ac'); const items = list ? [...list.querySelectorAll('.ac-item')] : [];
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, -1); items.forEach((it, i) => it.classList.toggle('active', i === acIndex)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (acIndex >= 0 && items[acIndex]) doGuess(items[acIndex].dataset.name); else submitFromInput(); }
    else if (e.key === 'Escape') closeAuto();
  }
  function closeAuto() { const list = root.querySelector('#vr-ac'); if (list) { list.classList.remove('open'); clear(list); } acIndex = -1; }

  // ---- TIMER ---------------------------------------------------------------
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      if (!vr) { stopTimer(); return; }
      const tt = root.querySelector('#vr-total-time'); const pt = root.querySelector('#vr-poke-time');
      if (tt) tt.textContent = fmtTime(Date.now() - vr.startTime);
      if (pt) pt.textContent = 'this: ' + ((Date.now() - vr.pokeStartTime) / 1000).toFixed(1) + 's';
    }, 100);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

  // ---- PERFECT SWEEP OVERLAY -----------------------------------------------
  function showPerfectOverlay() {
    const laps = vr.perfectLaps;
    const overlay = root.querySelector('#vr-perfect-overlay'); if (!overlay) return;
    root.querySelector('#vr-perfect-title').textContent =
      laps === 1 ? '\u2728 PERFECT RUN \u2014 ALL 251! \u2728' : `\u2728 PERFECT RUN \u2014 LAP ${laps}! \u2728`;
    root.querySelector('#vr-perfect-sub').textContent =
      laps === 1 ? "You've named every single Pok\u00e9mon without a mistake!"
                 : "You're on a roll. Keep going or bank your incredible streak?";
    root.querySelector('#vr-perfect-streak').textContent = `${vr.streak} streak`;
    overlay.classList.add('active');
  }
  function perfectContinue() {
    const overlay = root.querySelector('#vr-perfect-overlay');
    if (overlay) overlay.classList.remove('active');
    // Reshuffle for the next lap
    vr.pool = shuffle(data.pokedex.filter((p) => matchesPool(p.num, poolFilter)));
    vr.poolIdx = 0;
    startTimer();
    nextMon();
  }
  function perfectEnd() { vr.totalMs = Date.now() - vr.startTime; stopTimer(); showSummary(); }

  // ---- SUMMARY -------------------------------------------------------------
  function showSummary() {
    if (!vr) return;
    const s = vr;
    const totalMs = s.totalMs || (Date.now() - s.startTime);
    const avgMs = s.streak > 0 ? Math.round(totalMs / s.streak) : null;
    const tier = getTier(s.streak);
    const isPerfect = s.perfectLaps > 0;
    // Submit to leaderboard
    submitScore(data.id || 'gen2', 'victoryroad', {
      score: s.streak,
      detail: `time:${fmtTime(totalMs)} best:${s.bestPokeMs ? (s.bestPokeMs/1000).toFixed(1)+'s' : '-'} laps:${s.perfectLaps}`,
    }).catch(() => {});
    const done = s; vr = null;
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: `summary-header ${isPerfect ? 'win' : 'loss'}` },
            el('div', { class: 'summary-result' }, isPerfect ? '\uD83D\uDC51 Perfect Run!' : '\uD83C\uDFCE\uFE0F Run Over'),
            el('div', { class: 'summary-mon' }, `${done.streak} streak`),
            el('div', { class: 'summary-score' }, tier.label)),
          isPerfect ? el('div', { class: 'vr-perfect-banner' },
            `\uD83D\uDC51 ${done.perfectLaps}\u00d7 Perfect Sweep \u2014 all 251 named!`) : null,
          !isPerfect && done.round ? el('div', { class: 'summary-meta' },
            el('div', {}, `The Pok\u00e9mon was: `),
            el('strong', { style: { color: 'var(--accent-gold)' } }, done.round.mystery.name)) : null,
          el('div', { class: 'stats-grid' },
            ...([
              [String(done.streak), 'Streak'],
              [fmtTime(totalMs), 'Run Time'],
              avgMs !== null ? [`${(avgMs / 1000).toFixed(1)}s`, 'Avg / Pok\u00e9mon'] : null,
              done.bestPokeMs !== null ? [`${(done.bestPokeMs / 1000).toFixed(1)}s`, '\u26a1 Best'] : null,
              done.perfectLaps > 0 ? [String(done.perfectLaps) + '\u00d7', 'Sweeps'] : null,
            ].filter(Boolean).map(([v, l]) => el('div', { class: 'stat-box' },
              el('div', { class: 'sval' }, v), el('div', { class: 'sname' }, l))))),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showConfig }, 'Play again'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main menu')))));
  }

  // ---- utils ---------------------------------------------------------------
  function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
  const onDocClick = (e) => { if (!e.target.closest('.guess-input-wrap')) closeAuto(); };
  document.addEventListener('click', onDocClick);

  return {
    destroy() {
      stopTimer();
      document.removeEventListener('click', onDocClick);
      vr = null;
      clear(mount);
    },
  };
}

export default createVictoryRoad;
