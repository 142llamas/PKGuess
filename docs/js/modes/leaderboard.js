/**
 * @file        js/modes/leaderboard.js
 * @version     1.2.0
 * @updated     2026-07-05
 * @changelog
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

const PLACE = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

export function createLeaderboard({ mount, config, data, params, onExit }) {
  const root = el('div', { class: 'sp-content' });
  clear(mount).appendChild(root);

  // Start on the tab matching the gen the player came from
  const startGen = data && data.id ? data.id : 'gen2';
  let tab = BOARDS.findIndex((b) => b.gen === startGen);
  if (tab < 0) tab = 0;

  let uid = null;

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
            onClick: () => { tab = i; render(); },
          }, b.label))),
      el('div', { class: 'lb-board', id: 'lb-board' },
        el('div', { class: 'lb-empty' }, 'Loading\u2026')),
      el('div', { class: 'sp-start-row' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('button', { class: 'btn-secondary', onClick: render }, '\u21bb Refresh')));
    loadBoard();
  }

  async function loadBoard() {
    const board = root.querySelector('#lb-board');
    const { gen, mode, label } = BOARDS[tab];
    try {
      const entries = await topEntries(gen, mode, 10);
      if (!board) return;
      if (!entries.length) {
        board.replaceChildren(el('div', { class: 'lb-empty' }, `No scores yet for ${label} — be the first!`));
        return;
      }
      board.replaceChildren(
        el('table', { class: 'lb-table' },
          el('thead', {}, el('tr', {},
            el('th', {}, '#'), el('th', {}, 'Player'),
            el('th', {}, 'Score'), el('th', {}, 'Detail'))),
          el('tbody', {},
            ...entries.map((e, i) => {
              const isMe = uid && e.uid === uid;
              return el('tr', { class: isMe ? 'lb-me' : '' },
                el('td', {}, PLACE[i] || String(i + 1)),
                el('td', { style: { fontWeight: isMe ? 800 : 400, color: isMe ? 'var(--accent-gold)' : '' } },
                  e.name || 'Anonymous'),
                el('td', { style: { fontWeight: 700 } }, String(e.score)),
                el('td', { class: 'lb-detail' }, e.detail || ''));
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
