/**
 * @file        js/modes/pokedex.js
 * @version     1.1.0
 * @updated     2026-06-24
 * @changelog
 *   1.1.0 — Seen/Caught are now independent toggle filters whose union applies when both are active (#17), replacing the old exclusive All/Caught/Not-caught radio. Uses the shared lib/catch-tracker.js.
 *   1.0.0 — Pokédex / study reference, ported from the canonical study screen.
 *           Browse the full dex (search by name or number, sort #/A–Z), a catch
 *           tracker (Unseen / Seen / Caught, persisted in localStorage), and a
 *           per-Pokémon detail view (info, type matchups, competitive movesets,
 *           full move list by source). Reads movelist-gen{N}.json. Reference
 *           only — no engine rules involved. Gen is selected by the route, so
 *           the same controller serves both gens.
 *
 * Contract: createPokedex({ mount, config, data, params, onExit }) → { destroy }
 */

import { el, clear, statSpreadEl, genBar } from '../lib/dom.js';
import { pokemonInfoHTML } from '../lib/pokeinfo.js';
import { loadCatchMap, getCatchStatus, setCatchStatus } from '../lib/catch-tracker.js';

const SOURCE_ORDER = ['Level-up', 'TM / HM', 'Egg Move', 'Move Tutor', 'RBY TM (import)'];

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createPokedex({ mount, config, data, params, onExit }) {
  const root = el('div', { class: 'study-container', id: 'study-container' });
  clear(mount).appendChild(root);

  const dex = (data.pokedex || []).slice();
  const genLabel = (config && config.genLabels && config.genLabels[data.id?.replace('gen', '')]) || (data.id === 'gen1' ? 'Gen 1' : 'Gen 2');
  let movelist = {};
  const view = { query: '', sort: 'num', filters: { seen: false, caught: false }, index: 0, list: [] };

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; })
    .catch(() => { movelist = {}; })
    .finally(renderList);

  // ---- catch tracker (shared/lib/catch-tracker.js) ------------------------
  function pokeBall(status) {
    if (status === 'caught') {
      return '<svg width="20" height="20" viewBox="0 0 20 20" style="flex-shrink:0"><circle cx="10" cy="10" r="9" fill="#fff" stroke="#333" stroke-width="1.5"/><path d="M1.2 10 A8.8 8.8 0 0 1 18.8 10 Z" fill="#d63030"/><rect x="1" y="9.2" width="18" height="1.6" fill="#333"/><circle cx="10" cy="10" r="3.3" fill="#fff" stroke="#333" stroke-width="1.5"/><circle cx="10" cy="10" r="1.4" fill="#d63030"/></svg>';
    }
    if (status === 'seen') {
      return '<svg width="20" height="20" viewBox="0 0 20 20" style="flex-shrink:0;opacity:0.4"><circle cx="10" cy="10" r="9" fill="none" stroke="#aaa" stroke-width="1.5"/><rect x="1" y="9.2" width="18" height="1.6" fill="#aaa"/><circle cx="10" cy="10" r="3.3" fill="none" stroke="#aaa" stroke-width="1.5"/></svg>';
    }
    return '<span style="display:inline-block;width:20px"></span>';
  }

  // ---- filtering ----------------------------------------------------------
  // #17 — Seen and Caught are independent toggles, not an exclusive radio.
  // Caught is a SUBSET of Seen (a caught mon's stored status is 'caught', not
  // both), so: Caught alone -> status==='caught'; Seen alone -> status==='seen'
  // (unchanged, exclusive "seen but not caught" meaning); BOTH -> the union
  // (anything tracked at all, i.e. 'seen' OR 'caught'); NEITHER -> show all.
  function filteredList() {
    const q = view.query.trim().toLowerCase();
    const ct = loadCatchMap();
    let list = q
      ? dex.filter((p) => p.name.toLowerCase().includes(q) || String(p.num) === q || String(parseInt(p.num, 10)) === q)
      : dex.slice();
    const { seen, caught } = view.filters;
    if (seen || caught) {
      list = list.filter((p) => {
        const st = ct[p.name.toLowerCase()];
        if (seen && caught) return st === 'seen' || st === 'caught';
        if (caught) return st === 'caught';
        return st === 'seen';
      });
    }
    list = list.slice().sort((a, b) => view.sort === 'alpha'
      ? a.name.localeCompare(b.name)
      : parseInt(a.num, 10) - parseInt(b.num, 10));
    return list;
  }

  // ---- list screen --------------------------------------------------------
  function renderList() {
    const list = filteredList();
    view.list = list;
    const ct = loadCatchMap();
    const total = dex.length;
    const caught = dex.filter((p) => ct[p.name.toLowerCase()] === 'caught').length;
    const seen = dex.filter((p) => ct[p.name.toLowerCase()] === 'seen').length;
    const unseen = total - caught - seen;

    clear(root);

    root.append(
      el('div', { class: 'study-head' },
        el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'),
        el('div', { class: 'study-title' }, `\uD83D\uDCD6 Pok\u00e9dex \u2014 ${genLabel}`),
        el('span', { style: { width: '70px' } })),
      genBar(params?.modeId || 'pokedex', params?.gen || (data.id === 'gen1' ? 1 : 2)),
      controls(),
      catchBar(caught, seen, unseen),
      el('div', { class: 'study-count' }, `${list.length} Pok\u00e9mon`),
      el('div', { class: 'study-list' },
        list.length
          ? list.map((p) => studyRow(p, ct[p.name.toLowerCase()] || null))
          : el('div', { class: 'study-empty' }, 'No Pok\u00e9mon match your search.')),
    );
  }

  function controls() {
    const search = el('input', {
      class: 'study-search', type: 'text', placeholder: 'Search by name or number\u2026', value: view.query,
      onInput: (e) => { view.query = e.target.value; refreshListBody(); },
    });
    const sortBtn = (val, label) => el('button', {
      class: view.sort === val ? 'active' : '',
      onClick: () => { view.sort = val; renderList(); },
    }, label);
    return el('div', { class: 'study-controls' },
      search,
      el('div', { class: 'study-sort' }, sortBtn('num', '# Number'), sortBtn('alpha', 'A\u2013Z')));
  }

  function catchBar(caught, seen, unseen) {
    const toggleBtn = (key, label) => el('button', {
      class: 'btn-secondary',
      style: { fontSize: '10px', padding: '3px 9px', ...(view.filters[key] ? { background: 'var(--accent-gold)', color: '#1a1000' } : {}) },
      onClick: () => { view.filters[key] = !view.filters[key]; renderList(); },
    }, label);
    const allActive = !view.filters.seen && !view.filters.caught;
    const allBtn = el('button', {
      class: 'btn-secondary',
      style: { fontSize: '10px', padding: '3px 9px', ...(allActive ? { background: 'var(--accent-gold)', color: '#1a1000' } : {}) },
      onClick: () => { view.filters.seen = false; view.filters.caught = false; renderList(); },
    }, 'All');
    return el('div', { class: 'study-catchbar' },
      el('span', { style: { color: 'var(--accent-gold)' } }, `\uD83C\uDFC6 ${caught}`),
      el('span', { style: { color: 'var(--text-dim)' } }, `\uD83D\uDC41 ${seen}`),
      el('span', { style: { color: 'var(--text-dim)' } }, `\u2753 ${unseen}`),
      el('span', { class: 'study-catchbar-filters' }, allBtn, toggleBtn('seen', '\uD83D\uDC41 Seen'), toggleBtn('caught', '\uD83C\uDFC6 Caught')));
  }

  // refresh only the list body on each keystroke (keeps input focus)
  function refreshListBody() {
    const list = filteredList();
    view.list = list;
    const ct = loadCatchMap();
    const body = root.querySelector('.study-list');
    const count = root.querySelector('.study-count');
    if (count) count.textContent = `${list.length} Pok\u00e9mon`;
    if (!body) return;
    clear(body);
    if (!list.length) { body.appendChild(el('div', { class: 'study-empty' }, 'No Pok\u00e9mon match your search.')); return; }
    list.forEach((p) => body.appendChild(studyRow(p, ct[p.name.toLowerCase()] || null)));
  }

  function studyRow(p, status) {
    const types = [p.type1, ...(p.type2 && p.type2 !== '\u2014' && p.type2 !== '-' ? [p.type2] : [])];
    return el('div', { class: 'study-row', onClick: () => openDetail(p.num) },
      el('span', { class: 'study-row-num' }, `#${p.num}`),
      el('span', { class: 'study-row-name' }, p.name),
      el('span', { class: 'study-row-types' }, ...types.map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
      el('span', { class: 'study-row-ball', html: pokeBall(status) }));
  }

  // ---- detail screen ------------------------------------------------------
  function openDetail(num) {
    const list = view.list && view.list.length ? view.list : filteredList();
    view.list = list;
    const idx = list.findIndex((p) => String(p.num) === String(num));
    view.index = idx < 0 ? 0 : idx;
    renderDetail();
  }
  function nav(delta) {
    if (!view.list.length) return;
    view.index = (view.index + delta + view.list.length) % view.list.length;
    renderDetail();
  }

  function renderDetail() {
    const poke = view.list[view.index];
    if (!poke) { renderList(); return; }
    const status = getCatchStatus(poke.name);
    clear(root);

    const statusBtn = (val, label) => el('button', {
      class: 'catch-btn' + (status === val || (val === 'unseen' && !status) ? ' active' : ''),
      onClick: () => { setCatchStatus(poke.name, val); renderDetail(); },
    }, label);

    root.append(
      el('div', { class: 'study-detail-header' },
        el('button', { class: 'btn-secondary', onClick: renderList }, '\u2190 List'),
        el('span', { class: 'gen-bar-label', style: { whiteSpace: 'nowrap' } }, genLabel),
        el('div', { class: 'study-detail-nav' },
          el('button', { class: 'btn-secondary', onClick: () => nav(-1) }, '\u2190 Prev'),
          el('span', { class: 'study-detail-pos' }, `${view.index + 1} / ${view.list.length}`),
          el('button', { class: 'btn-secondary', onClick: () => nav(1) }, 'Next \u2192'))),
      el('div', { class: 'catch-controls' },
        el('span', { class: 'catch-label' }, 'Catch status:'),
        statusBtn('unseen', '\u2753 Unseen'), statusBtn('seen', '\uD83D\uDC41 Seen'), statusBtn('caught', '\uD83C\uDFC6 Caught')),
      el('div', { html: infoHTML(poke) }),
    );
    // Replace placeholder with actual statSpreadEl (since infoHTML uses innerHTML)
    const placeholder = root.querySelector('#poke-stat-spread-placeholder');
    if (placeholder && poke.fullStats) placeholder.replaceWith(statSpreadEl(poke.fullStats));

    const toggle = root.querySelector('.collapsible-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      const body = toggle.parentElement.querySelector('.collapsible-body');
      if (body) body.classList.toggle('open');
    });
  }

  // faithful port of canonical pokemonInfoHTML (movelist instead of global)
  function infoHTML(poke) { return pokemonInfoHTML(poke, movelist); }

  return { destroy() { clear(mount); } };
}

export default createPokedex;
