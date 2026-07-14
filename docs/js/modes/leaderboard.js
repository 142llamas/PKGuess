/**
 * @file        js/modes/leaderboard.js
 * @version     1.3.0
 * @updated     2026-07-12
 * @changelog
 *   1.3.0 — Safari boards now rank by the catch-per-100-points metric (shown
 *           in its own column). Victory Road boards default to ranking by
 *           total caught but gain a sort toggle to re-rank by average time per
 *           catch (lower is better). Single Player is score-only, unchanged.
 *           Metric column + per-mode SORT_CONFIG drive all three.
 *   1.2.0 — #11: added prominent Elite 4 Standings / Daily Challenge Results
 *           links at the top of the screen — draft results live in their own
 *           screens (throne status, daily rankings), not in the score tables
 *           here, and Leaderboard is often the first place a player looks.
 *   1.1.0 — Wait for Firebase auth before reading (fixes empty board). Start
 *           on the tab matching the gen the player navigated from. Stat spread
 *           values now show abbreviation labels.
 *   1.0.0 — Initial leaderboard browse screen.
 */

import { el, clear } from '../lib/dom.js';
import { topEntries } from '../lib/leaderboard-data.js';
import { getIdentity } from '../lib/identity.js';

const BOARDS = [
  { gen: 'gen1', mode: 'single',      label: 'Gen 1 · Single Player' },
  { gen: 'gen1', mode: 'victoryroad', label: 'Gen 1 · Victory Road'  },
  { gen: 'gen1', mode: 'safari',      label: 'Gen 1 · Safari Zone'   },
  { gen: 'gen2', mode: 'single',      label: 'Gen 2 · Single Player' },
  { gen: 'gen2', mode: 'victoryroad', label: 'Gen 2 · Victory Road'  },
  { gen: 'gen2', mode: 'safari',      label: 'Gen 2 · Safari Zone'   },
];

// Per-mode sort behaviour.
//  - Safari: ranked by the catch-per-100-points efficiency metric (requested),
//    higher is better. No toggle — this IS the Safari ranking.
//  - Victory Road: ranked by total caught (score) by DEFAULT, with a toggle to
//    re-sort by average time per catch (lower is better). (requested)
//  - Single Player: score only, no metric.
const SORT_CONFIG = {
  safari:      { metricLabel: 'Catch / 100 pts', metricAsc: false, toggle: false, defaultMetric: true },
  victoryroad: { metricLabel: 'Avg time / catch', metricAsc: true,  toggle: true,  defaultMetric: false },
  single:      { toggle: false, defaultMetric: false },
};

const PLACE = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

export function createLeaderboard({ mount, config, data, params, onExit }) {
  const root = el('div', { class: 'sp-content' });
  clear(mount).appendChild(root);

  // Start on the tab matching the gen the player came from
  const startGen = data && data.id ? data.id : 'gen2';
  let tab = BOARDS.findIndex((b) => b.gen === startGen);
  if (tab < 0) tab = 0;

  let uid = null;
  let sortByMetric = false;  // VR toggle; Safari overrides to always-metric below

  // Wait for auth before rendering so reads succeed
  getIdentity()
    .then((id) => { uid = id.uid; })
    .catch(() => {})
    .finally(render);

  function render() {
    clear(root).append(
      el('div', { class: 'sp-section-title' }, '\uD83C\uDFC6 Leaderboards'),
      // #11 — draft results live in their own screens (Elite 4 standings,
      // Daily Challenge rankings), not in the score tables below — since
      // Leaderboard is often the first place a player looks for them, link
      // straight there instead of leaving them to hunt through the main menu.
      el('div', { class: 'lb-draft-links' },
        el('span', { class: 'sf-intro', style: { margin: 0 } }, 'Looking for Draft Battle results?'),
        el('button', { class: 'btn-secondary', onClick: () => { location.hash = '#/draftbattle/2/thrones'; } }, '\u2694\uFE0F Elite 4 Standings'),
        el('button', { class: 'btn-secondary', onClick: () => { location.hash = '#/dailychallenge/2/results'; } }, '\uD83D\uDCC5 Daily Challenge Results')),
      el('div', { class: 'lb-tabs' },
        ...BOARDS.map((b, i) =>
          el('button', {
            class: 'lb-tab' + (i === tab ? ' active' : ''),
            onClick: () => { tab = i; sortByMetric = false; render(); },
          }, b.label))),
      el('div', { class: 'lb-board', id: 'lb-board' },
        el('div', { class: 'lb-empty' }, 'Loading\u2026')),
      sortToggle(),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-secondary', onClick: render }, '\u21bb Refresh')));
    loadBoard();
  }

  // Victory Road gets a toggle to re-sort by the time-per-catch metric; other
  // boards have a fixed sort so no control is shown.
  function sortToggle() {
    const cfg = SORT_CONFIG[BOARDS[tab].mode] || {};
    if (!cfg.toggle) return el('span', { style: { display: 'none' } });
    return el('div', { class: 'lb-sort-row' },
      el('span', { class: 'sf-intro', style: { margin: 0 } }, 'Sort by:'),
      el('button', {
        class: 'btn-secondary' + (!sortByMetric ? ' active' : ''),
        onClick: () => { if (sortByMetric) { sortByMetric = false; render(); } },
      }, 'Total caught'),
      el('button', {
        class: 'btn-secondary' + (sortByMetric ? ' active' : ''),
        onClick: () => { if (!sortByMetric) { sortByMetric = true; render(); } },
      }, cfg.metricLabel || 'Metric'));
  }

  async function loadBoard() {
    const board = root.querySelector('#lb-board');
    const { gen, mode, label } = BOARDS[tab];
    const cfg = SORT_CONFIG[mode] || {};
    // Safari always sorts by its metric; VR sorts by metric only when toggled;
    // Single Player has no metric.
    const useMetric = cfg.defaultMetric || (cfg.toggle && sortByMetric);
    const opts = useMetric ? { sortBy: 'metric', metricAsc: !!cfg.metricAsc } : {};
    const showMetricCol = cfg.defaultMetric || cfg.toggle; // any board that HAS a metric
    try {
      const entries = await topEntries(gen, mode, 10, opts);
      if (!board) return;
      if (!entries.length) {
        board.replaceChildren(el('div', { class: 'lb-empty' }, `No scores yet for ${label} — be the first!`));
        return;
      }
      const metricText = (e) => {
        if (typeof e.metric !== 'number') return '\u2014';
        if (mode === 'safari') return e.metric.toFixed(1);           // catch per 100 pts
        if (mode === 'victoryroad') return (e.metric / 1000).toFixed(1) + 's'; // avg time/catch
        return String(e.metric);
      };
      const headerCells = [
        el('th', {}, '#'), el('th', {}, 'Player'),
        el('th', {}, mode === 'safari' ? 'Caught' : 'Score'),
      ];
      if (showMetricCol) headerCells.push(el('th', {}, cfg.metricLabel || 'Metric'));
      headerCells.push(el('th', {}, 'Detail'));
      board.replaceChildren(
        el('table', { class: 'lb-table' },
          el('thead', {}, el('tr', {}, ...headerCells)),
          el('tbody', {},
            ...entries.map((e, i) => {
              const isMe = uid && e.uid === uid;
              const cells = [
                el('td', {}, PLACE[i] || String(i + 1)),
                el('td', { style: { fontWeight: isMe ? 800 : 400, color: isMe ? 'var(--accent-gold)' : '' } },
                  e.name || 'Anonymous'),
                el('td', { style: { fontWeight: 700 } }, String(e.score)),
              ];
              if (showMetricCol) {
                const highlighted = useMetric;
                cells.push(el('td', { style: { fontWeight: highlighted ? 700 : 400, color: highlighted ? 'var(--accent-gold)' : '' } }, metricText(e)));
              }
              cells.push(el('td', { class: 'lb-detail' }, e.detail || ''));
              return el('tr', { class: isMe ? 'lb-me' : '' }, ...cells);
            }))));
    } catch (err) {
      console.warn('leaderboard load error:', err);
      if (board) board.replaceChildren(
        el('div', { class: 'lb-empty' }, 'Could not load scores — check your connection and that Firebase rules are published.'));
    }
  }

  return { destroy() { clear(mount); } };
}

export default createLeaderboard;
