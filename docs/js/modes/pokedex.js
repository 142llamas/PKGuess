/**
 * @file        js/modes/pokedex.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
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

import { el, clear, statSpreadEl } from '../lib/dom.js';

const CATCH_KEY = 'pokeGuess_catchTracker';
const SOURCE_ORDER = ['Level-up', 'TM / HM', 'Egg Move', 'Move Tutor', 'RBY TM (import)'];

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createPokedex({ mount, config, data, params, onExit }) {
  const root = el('div', { class: 'study-container', id: 'study-container' });
  clear(mount).appendChild(root);

  const dex = (data.pokedex || []).slice();
  const genLabel = (config && config.genLabels && config.genLabels[data.id?.replace('gen', '')]) || (data.id === 'gen1' ? 'Gen 1' : 'Gen 2');
  let movelist = {};
  const view = { query: '', sort: 'num', catchFilter: 'all', index: 0, list: [] };

  fetch(`data/movelist-${data.id}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((ml) => { movelist = ml || {}; })
    .catch(() => { movelist = {}; })
    .finally(renderList);

  // ---- catch tracker (localStorage) ---------------------------------------
  function catchLoad() { try { return JSON.parse(localStorage.getItem(CATCH_KEY) || '{}'); } catch { return {}; } }
  function catchSave(d) { try { localStorage.setItem(CATCH_KEY, JSON.stringify(d)); } catch { /* ignore */ } }
  function catchStatus(name) { return catchLoad()[name.toLowerCase()] || null; }
  function setCatch(name, status) {
    const d = catchLoad();
    if (status === 'unseen') delete d[name.toLowerCase()]; else d[name.toLowerCase()] = status;
    catchSave(d);
  }

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
  function filteredList() {
    const q = view.query.trim().toLowerCase();
    const ct = catchLoad();
    let list = q
      ? dex.filter((p) => p.name.toLowerCase().includes(q) || String(p.num) === q || String(parseInt(p.num, 10)) === q)
      : dex.slice();
    if (view.catchFilter === 'caught') list = list.filter((p) => ct[p.name.toLowerCase()] === 'caught');
    if (view.catchFilter === 'notcaught') list = list.filter((p) => ct[p.name.toLowerCase()] !== 'caught');
    list = list.slice().sort((a, b) => view.sort === 'alpha'
      ? a.name.localeCompare(b.name)
      : parseInt(a.num, 10) - parseInt(b.num, 10));
    return list;
  }

  // ---- list screen --------------------------------------------------------
  function renderList() {
    const list = filteredList();
    view.list = list;
    const ct = catchLoad();
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
    const fbtn = (val, label) => el('button', {
      class: 'btn-secondary',
      style: { fontSize: '10px', padding: '3px 9px', ...(view.catchFilter === val ? { background: 'var(--accent-gold)', color: '#1a1000' } : {}) },
      onClick: () => { view.catchFilter = val; renderList(); },
    }, label);
    return el('div', { class: 'study-catchbar' },
      el('span', { style: { color: 'var(--accent-gold)' } }, `\uD83C\uDFC6 ${caught}`),
      el('span', { style: { color: 'var(--text-dim)' } }, `\uD83D\uDC41 ${seen}`),
      el('span', { style: { color: 'var(--text-dim)' } }, `\u2753 ${unseen}`),
      el('span', { class: 'study-catchbar-filters' }, fbtn('all', 'All'), fbtn('caught', '\uD83C\uDFC6 Caught'), fbtn('notcaught', 'Not caught')));
  }

  // refresh only the list body on each keystroke (keeps input focus)
  function refreshListBody() {
    const list = filteredList();
    view.list = list;
    const ct = catchLoad();
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
    const status = catchStatus(poke.name);
    clear(root);

    const statusBtn = (val, label) => el('button', {
      class: 'catch-btn' + (status === val || (val === 'unseen' && !status) ? ' active' : ''),
      onClick: () => { setCatch(poke.name, val); renderDetail(); },
    }, label);

    root.append(
      el('div', { class: 'study-detail-header' },
        el('button', { class: 'btn-secondary', onClick: renderList }, '\u2190 List'),
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
  function infoHTML(poke) {
    const types = [poke.type1, ...(poke.type2 && poke.type2 !== '\u2014' ? [poke.type2] : [])];
    const typePills = types.map((t) => `<span class="type-pill type-${t.toLowerCase()}">${escHtml(t)}</span>`).join('');
    let statsHtml = '';
    if (poke.fullStats) {
      const pts = poke.fullStats.split('/'); const ns = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
      statsHtml = '<div class="stats-grid">' + pts.map((v, i) => `<div class="stat-box"><div class="sname">${ns[i] || '?'}</div><div class="sval">${escHtml(v.trim())}</div></div>`).join('') + '</div>';
    }
    const tag = (cls, src) => (src || '').split(',').map((s) => s.trim()).filter(Boolean).map((x) => `<span class="${cls}">${escHtml(x)}</span>`).join('');
    const weakT = tag('weak-tag', poke.allWeaknesses);
    const resistT = tag('resist-tag', poke.allResistances);
    const immuneT = poke.immunities && poke.immunities !== '\u2014'
      ? tag('immune-tag', poke.immunities) : '<span style="color:var(--text-dim);font-size:11px">None</span>';
    const comps = [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4].filter((m) => m && m.trim());
    const compH = comps.length
      ? comps.map((m, i) => `<div class="comp-moveset-item"><strong>Moveset ${i + 1}</strong>${escHtml(m)}</div>`).join('')
      : '<div style="color:var(--text-dim);font-size:12px">No competitive movesets listed.</div>';
    const moves = movelist[poke.name.toLowerCase()] || [];
    const byS = {}; SOURCE_ORDER.forEach((s) => { byS[s] = []; });
    moves.forEach((m) => { if (byS[m.source]) byS[m.source].push(m.move); });
    const mlH = SOURCE_ORDER.filter((s) => byS[s].length).map((s) =>
      `<div class="move-source-group"><div class="move-source-title">${escHtml(s)}</div><div class="move-list-grid">${byS[s].map((m) => `<span class="move-tag">${escHtml(m)}</span>`).join('')}</div></div>`).join('')
      || '<div style="color:var(--text-dim);font-size:12px">No move data found.</div>';
    const gen = parseInt(poke.num, 10) <= 151 ? '1st' : '2nd';
    let animeInfo = `<div class="stat-row"><span class="label">Generation</span><span class="value">${gen}</span></div>`;
    if (poke.firstAnime && String(poke.firstAnime).trim()) {
      animeInfo += `<div class="stat-row"><span class="label">Anime Debut</span><span class="value" style="text-align:right;max-width:60%">${escHtml(poke.firstAnime)}</span></div>`;
    }

    return '<div class="summary-grid"><div class="summary-card"><h3>Pok\u00e9mon Info</h3>'
      + `<div class="poke-name-big">${escHtml(poke.name)}</div><div class="type-pills">${typePills}</div>`
      + '<div style="display:flex;flex-direction:column;gap:3px">'
      + `<div class="stat-row"><span class="label">Pok\u00e9dex #</span><span class="value">${escHtml(poke.num)}</span></div>`
      + `<div class="stat-row"><span class="label">Habitat</span><span class="value">${escHtml(poke.habitat || '\u2014')}</span></div>`
      + `<div class="stat-row"><span class="label">BST Range</span><span class="value">${escHtml(poke.bstRange || '\u2014')}</span></div>`
      + `<div class="stat-row"><span class="label">Evo Stage</span><span class="value">${escHtml(poke.evoStage || '\u2014')}</span></div>`
      + `<div class="stat-row"><span class="label">Evo Method</span><span class="value">${escHtml(poke.evoMethod || '\u2014')}</span></div>`
      + `<div class="stat-row"><span class="label">Family Size</span><span class="value">${escHtml(poke.familySize || '\u2014')}</span></div>`
      + (poke.npcObtain && poke.npcObtain !== '\u2014' ? `<div class="stat-row"><span class="label">Obtain</span><span class="value">${escHtml(poke.npcObtain)}</span></div>` : '')
      + animeInfo + '</div>'
      + '<div style="margin-top:12px"><div class="info-subhead">Base Stats</div>'
      + (poke.fullStats ? `<div id="poke-stat-spread-placeholder"></div>` : '')
      + (poke.fullStats ? `<div class="full-stat-string">${escHtml(poke.fullStats)}</div>` : '') + '</div></div>'
      + '<div class="summary-card"><h3>Type Matchups</h3>'
      + '<div class="info-subhead">Weaknesses</div><div class="weaknesses-list">' + (weakT || '<span style="color:var(--text-dim);font-size:11px">None</span>') + '</div>'
      + '<div class="info-subhead" style="margin-top:10px">Resistances</div><div class="resistances-list">' + (resistT || '<span style="color:var(--text-dim);font-size:11px">None</span>') + '</div>'
      + '<div class="info-subhead" style="margin-top:10px">Immunities</div><div>' + immuneT + '</div>'
      + '<h3 style="margin-top:16px">Competitive Movesets</h3><div class="comp-movesets">' + compH + '</div></div></div>'
      + `<div class="movelist-section"><button class="collapsible-toggle">\uD83D\uDCD6 Full Move List (${moves.length} moves) <span>\u25bc</span></button><div class="collapsible-body">${mlH}</div></div>`;
  }

  return { destroy() { clear(mount); } };
}

export default createPokedex;
