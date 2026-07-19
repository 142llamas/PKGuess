/**
 * @file        docs/js/lib/pokeinfo.js
 * @version     1.1.0
 * @updated     2026-07-14
 * @changelog
 *   1.1.0 — The info card now shows the Pokémon's silhouette image, loaded
 *           from ./img/silhouettes/<num>.png (National Dex number, matching
 *           gen2.json's `num`). Because this builder is the single source of
 *           truth for both the Pokédex detail view AND the guess-mode
 *           post-game reveal card, adding the <img> here puts the silhouette
 *           on exactly those two screens and nowhere else. The image files
 *           are ALREADY silhouettes (pre-blacked-out shapes), so this renders
 *           them as-is with the new `.poke-silhouette` class — it does NOT
 *           apply the `.draft-silhouette` blackout filter, which exists to
 *           convert full-colour art into a silhouette and would double-
 *           process an already-silhouette file. A missing file hides itself
 *           via an inline onerror (works because the card is injected via
 *           innerHTML), so the card degrades gracefully with no broken-image
 *           icon and no layout gap when a sprite hasn't been supplied yet.
 *   1.0.0 — Extracted the Pokédex detail card builder so the guess post-game
 *           screen can mirror it exactly (#13). One source of truth for the
 *           per-Pokémon info layout (info, type matchups, competitive sets,
 *           full move list). Stats render via a `#poke-stat-spread-placeholder`
 *           the caller replaces with `statSpreadEl`, and the full move list uses
 *           a `.collapsible-toggle` the caller wires up.
 */

export const SOURCE_ORDER = ['Level-up', 'TM / HM', 'Egg Move', 'Move Tutor', 'RBY TM (import)'];

export const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build the full info card HTML for a Pokédex entry.
 * @param {object} poke      a pokedex row
 * @param {object} movelist  { speciesnamelower: [{move, source}] } (optional)
 * @returns {string} HTML — caller replaces #poke-stat-spread-placeholder and
 *          wires .collapsible-toggle.
 */
export function pokemonInfoHTML(poke, movelist = {}) {
  const types = [poke.type1, ...(poke.type2 && poke.type2 !== '\u2014' ? [poke.type2] : [])];
  const typePills = types.map((t) => `<span class="type-pill type-${t.toLowerCase()}">${escHtml(t)}</span>`).join('');

  const tag = (cls, src) => (src || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((x) => `<span class="${cls}">${escHtml(x)}</span>`).join('');
  const weakT = tag('weak-tag', poke.allWeaknesses);
  const resistT = tag('resist-tag', poke.allResistances);
  const immuneT = poke.immunities && poke.immunities !== '\u2014'
    ? tag('immune-tag', poke.immunities) : '<span style="color:var(--text-dim);font-size:11px">None</span>';

  // The Abra/Kadabra/Alakazam family's competitive-moveset text uses
  // "elemental punch" as a placeholder for whichever of Fire/Ice/Thunder Punch
  // (all three are legal Gen 2 TM moves for this line). This card isn't part
  // of a scored guessing round, so a plain Math.random pick is fine here.
  const resolveElementalPunch = (text) => {
    if (!text || !/elemental punch/i.test(text)) return text;
    const picks = ['Fire Punch', 'Ice Punch', 'Thunder Punch'];
    return text.replace(/elemental punch/i, picks[Math.floor(Math.random() * picks.length)]);
  };
  const comps = [poke.compMoveset1, poke.compMoveset2, poke.compMoveset3, poke.compMoveset4].filter((m) => m && m.trim());
  const compH = comps.length
    ? comps.map((m, i) => `<div class="comp-moveset-item"><strong>Moveset ${i + 1}</strong>${escHtml(resolveElementalPunch(m))}</div>`).join('')
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
    + `<img class="poke-silhouette" src="./img/silhouettes/${encodeURIComponent(poke.num)}.png" alt="" `
    + 'onerror="this.style.display=\'none\'">'
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
    + (poke.fullStats ? '<div id="poke-stat-spread-placeholder"></div>' : '') + '</div></div>'
    + '<div class="summary-card"><h3>Type Matchups</h3>'
    + '<div class="info-subhead">Weaknesses</div><div class="weaknesses-list">' + (weakT || '<span style="color:var(--text-dim);font-size:11px">None</span>') + '</div>'
    + '<div class="info-subhead" style="margin-top:10px">Resistances</div><div class="resistances-list">' + (resistT || '<span style="color:var(--text-dim);font-size:11px">None</span>') + '</div>'
    + '<div class="info-subhead" style="margin-top:10px">Immunities</div><div>' + immuneT + '</div>'
    + '<h3 style="margin-top:16px">Competitive Movesets</h3><div class="comp-movesets">' + compH + '</div></div></div>'
    + `<div class="movelist-section"><button class="collapsible-toggle">\uD83D\uDCD6 Full Move List (${moves.length} moves) <span>\u25bc</span></button><div class="collapsible-body">${mlH}</div></div>`;
}

/**
 * Post-injection wiring for a container whose innerHTML was set from
 * pokemonInfoHTML(). Currently just the silhouette's missing-file fallback:
 * the <img> also carries an inline onerror (which fires in real browsers), but
 * wiring it here too means the graceful-hide works even where inline handlers
 * are disabled (a strict CSP, or a test DOM like jsdom that doesn't execute
 * inline handler attributes) and makes the behaviour unit-testable. Idempotent
 * and null-safe — safe to call once after each render.
 * @param {ParentNode} root the element the info HTML was injected into
 */
export function wirePokemonInfo(root) {
  if (!root || typeof root.querySelector !== 'function') return;
  const sil = root.querySelector('.poke-silhouette');
  if (sil) {
    const hide = () => { sil.style.display = 'none'; };
    sil.addEventListener('error', hide);
    // If it already failed before this handler attached (image errors can fire
    // before JS runs), catch that: complete + zero natural size = broken/missing.
    if (sil.complete && sil.naturalWidth === 0 && sil.getAttribute('src')) hide();
  }
}
