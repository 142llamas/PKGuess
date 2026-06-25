/**
 * @file        js/modes/draftbattle.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Draft Battle + Daily Challenge controller. 6×2 model: one Pokémon
 *           shown at a time, player picks 0–2 attributes per card, card advances.
 *           Targets 6 cards × 2 picks = 12 attributes (6 stats, 2 types, 4 moves).
 *           If only 1 pick taken from a card, you naturally see more cards.
 *           Uses the vetted DraftSession engine from draft.js via draft-adapter.js.
 *
 * Contract: createDraftBattle({ mount, config, data, params, onExit }) → { destroy }
 *   params.variant = 'freeplay' | 'daily'
 */

import { el, clear, statSpreadEl } from '../lib/dom.js';
import { DraftSession, buildSpeciesList, buildLearnsetMap } from '../lib/draft-adapter.js';

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spc: 'Spc', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

export function createDraftBattle({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'draft-root' });
  clear(mount).appendChild(root);

  const variant = params.variant || 'freeplay';
  const isDaily = variant === 'daily';

  root.append(el('div', { class: 'draft-loading' }, 'Loading draft data\u2026'));

  Promise.all([
    fetch('data/movelist-gen2.json').then((r) => r.ok ? r.json() : {}),
    fetch('data/movestats-gen2.json').then((r) => r.ok ? r.json() : {}),
  ]).then(([movelist, movestats]) => {
    const learnsetMap = buildLearnsetMap(movelist, movestats);
    const species = buildSpeciesList(data, learnsetMap, 2);
    if (!species.length) throw new Error('No draftable species found.');
    const seed = isDaily ? dailySeed() : ((Math.random() * 2 ** 31) | 0);
    const rerolls = isDaily ? { pokemon: 1, moves: 1 } : { pokemon: 3, moves: 3 };
    const session = new DraftSession({ species, gen: 2, seed, rerolls });
    pendingPicks = [];
    renderCard(session);
  }).catch((err) => {
    clear(root).append(
      el('p', { class: 'placeholder-text' }, 'Could not load draft: ' + (err.message || err)),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
  });

  let pendingPicks = [];

  function dailySeed() {
    const ctMs = Date.now() + (new Date().getTimezoneOffset() + (-6 * 60)) * 60000;
    const ct = new Date(ctMs);
    let h = (ct.getFullYear() * 10000 + (ct.getMonth() + 1) * 100 + ct.getDate()) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ===== RENDER CARD ========================================================
  function renderCard(session) {
    if (session.isComplete()) { showComplete(session); return; }
    const card = session.current;
    const avail = session.availablePicks();
    const canPickMore = pendingPicks.length < 2;
    const totalDone = session.statKeys.length - session.openStatSlots().length
      + session.typeSlotsFilled() + session.moves.length;
    const totalSlots = session.statKeys.length + 2 + 4;
    const remaining = totalSlots - totalDone;

    clear(root).append(
      topBar(session),
      el('div', { class: 'draft-body' },
        el('div', { class: 'draft-card-panel' },
          el('div', { class: 'draft-card-header' },
            el('div', { class: 'draft-card-name' }, card.name),
            el('div', { class: 'draft-type-pills' },
              ...card.types.map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}` }, t)),
              session.cardIsMono() ? el('span', { class: 'type-pill type-none' }, '\u2014') : null)),
          statsSection(session, avail, canPickMore),
          typesSection(session, avail, canPickMore),
          movesSection(session, avail, canPickMore)),
        el('div', { class: 'draft-side-panel' },
          draftedSummary(session))),
      bottomBar(session, remaining));
  }

  // ---- Top bar ---------------------------------------------------------------
  function topBar(session) {
    const { pokemon: pr, moves: mr } = session.rerolls;
    const noPending = pendingPicks.length === 0;
    return el('div', { class: 'draft-topbar' },
      el('button', { class: 'btn-secondary game-exit',
        onClick: () => { if (confirm('Quit draft? Progress will be lost.')) onExit && onExit(); } },
        '\u2190 Quit'),
      el('div', { class: 'draft-topbar-center' },
        el('div', { class: 'draft-progress' }, `Card #${session.position + 1}`),
        el('div', { class: 'draft-reroll-btns' },
          el('button', {
            class: `btn-secondary draft-reroll${pr <= 0 || !noPending ? ' cant-afford' : ''}`,
            disabled: pr <= 0 || !noPending,
            onClick: () => { if (session.rerollPokemon()) { pendingPicks = []; renderCard(session); } },
          }, `\uD83D\uDD04 New Pok\u00e9mon (${pr})`),
          el('button', {
            class: `btn-secondary draft-reroll${mr <= 0 ? ' cant-afford' : ''}`,
            disabled: mr <= 0,
            onClick: () => { if (session.rerollMoves()) renderCard(session); },
          }, `\uD83D\uDD04 New Moves (${mr})`))));
  }

  // ---- Bottom bar ------------------------------------------------------------
  function bottomBar(session, remaining) {
    return el('div', { class: 'draft-bottombar' },
      el('div', { class: 'draft-pending-info' },
        pendingPicks.length > 0
          ? `${pendingPicks.length} pick${pendingPicks.length !== 1 ? 's' : ''} selected \u2014`
          : `Pick 0\u20132 attributes, then advance. `,
        el('span', { style: { color: 'var(--text-dim)' } }, ` ${remaining} remaining`)),
      el('div', { class: 'draft-advance-btns' },
        el('button', {
          class: 'btn-primary',
          onClick: () => advanceCard(session),
        }, pendingPicks.length > 0 ? `Confirm & Next \u25b6` : 'Skip \u25b6')));
  }

  // ---- Stats section ---------------------------------------------------------
  function statsSection(session, avail, canPickMore) {
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, 'Stats — pick any 2 you want'),
      el('div', { class: 'draft-stat-chips' },
        ...session.statKeys.map((k) => {
          const drafted = k in session.stats;
          const pending = pendingPicks.some((p) => p.type === 'stat' && p.key === k);
          const available = !drafted && !pending && canPickMore && avail.stats.some((s) => s.stat === k);
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          return el('div', {
            class: `draft-stat-chip ${state}`,
            onClick: available ? () => { pendingPicks.push({ type: 'stat', key: k }); renderCard(session); } : undefined,
          },
            el('span', { class: 'draft-chip-label' }, STAT_LABELS[k] || k.toUpperCase()),
            el('span', { class: 'draft-chip-state' },
              drafted ? '\u2713' : pending ? '\u25cb' : available ? '+' : '\u2014'));
        })));
  }

  // ---- Types section ---------------------------------------------------------
  function typesSection(session, avail, canPickMore) {
    const cardTypes = [...session.current.types];
    if (session.cardIsMono()) cardTypes.push('\u2014');
    const slotsLeft = session.typeSlotsOpen();
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' },
        `Types (${session.typeSlotsFilled()}/2) \u2014 types have the commutative property`),
      el('div', { class: 'draft-type-chips' },
        ...cardTypes.map((t) => {
          const isDash = t === '\u2014';
          const drafted = isDash ? session.typeNone : session.types.includes(t);
          const pending = pendingPicks.some((p) => p.type === 'type' && p.value === t);
          // Types can be drafted twice (becomes monotyped), so don't block on already having the type
          const available = !drafted && !pending && canPickMore && slotsLeft > 0
            && (isDash ? session.canPickNoType() : session.current.types.includes(t));
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          return el('div', {
            class: `draft-type-chip ${state} type-${isDash ? 'none' : t.toLowerCase()}`,
            onClick: available ? () => { pendingPicks.push({ type: 'type', value: t }); renderCard(session); } : undefined,
          }, isDash ? '\u2014 (mono)' : t);
        })));
  }

  // ---- Moves section ---------------------------------------------------------
  function movesSection(session, avail, canPickMore) {
    const choices = session.moveChoices;
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' },
        `Moves (${session.moves.length}/4) \u2014 ${choices.length} shown from full pool`),
      el('div', { class: 'draft-move-grid' },
        ...choices.map((m) => {
          const drafted = session.moves.includes(m);
          const pending = pendingPicks.some((p) => p.type === 'move' && p.value === m);
          const available = !drafted && !pending && canPickMore && session.moveSlotsOpen() > 0 && avail.moves.includes(m);
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          return el('div', {
            class: `draft-move-chip ${state}`,
            onClick: available ? () => { pendingPicks.push({ type: 'move', value: m }); renderCard(session); } : undefined,
          }, m);
        })));
  }

  // ---- Drafted summary sidebar -----------------------------------------------
  function draftedSummary(session) {
    const typeDisplay = [];
    if (session.types[0]) typeDisplay.push(session.types[0]);
    if (session.typeNone) typeDisplay.push('\u2014');
    if (session.types[1]) typeDisplay.push(session.types[1]);
    while (typeDisplay.length < 2) typeDisplay.push('?');
    return el('div', { class: 'draft-summary' },
      el('div', { class: 'draft-summary-title' }, 'Your Build'),
      el('div', { class: 'draft-summary-section' },
        el('div', { class: 'draft-chip-label' }, 'Types'),
        el('div', { class: 'draft-type-pills' },
          ...typeDisplay.map((t) =>
            el('span', { class: `type-pill type-${t === '?' ? 'none' : t === '\u2014' ? 'none' : t.toLowerCase()}` }, t)))),
      el('div', { class: 'draft-summary-section' },
        el('div', { class: 'draft-chip-label' }, 'Stats'),
        el('div', { class: 'draft-stat-mini' },
          ...session.statKeys.map((k) =>
            el('div', { class: `draft-stat-mini-cell${k in session.stats ? ' filled' : ''}` },
              el('span', { class: 'sname' }, STAT_LABELS[k] || k),
              el('span', { class: 'sval' }, k in session.stats ? '\u2713' : '\u2014'))))),
      el('div', { class: 'draft-summary-section' },
        el('div', { class: 'draft-chip-label' }, 'Moves'),
        ...Array.from({ length: 4 }, (_, i) =>
          el('div', { class: `draft-move-slot${session.moves[i] ? ' filled' : ''}` },
            session.moves[i] || `\u2014 slot ${i + 1}`))));
  }

  // ---- Advance card ----------------------------------------------------------
  function advanceCard(session) {
    for (const pick of pendingPicks) {
      if (pick.type === 'stat') session.pickStat(pick.key);
      else if (pick.type === 'type') {
        if (pick.value === '\u2014') session.pickNoType();
        else session.pickType(pick.value);
      } else if (pick.type === 'move') session.pickMove(pick.value);
    }
    pendingPicks = [];
    // If 0 picks, force-advance. DraftSession.skipIfStuck() only works when
    // there are literally no picks — if picks exist but we just didn't take
    // any, we override the position counter via a temporary unlock.
    if (!session.isComplete() && session.hasLegalPick()) {
      // Inject a zero-pick advance by leveraging the internal _advance.
      // Since _advance is private, we push a no-op pick on a non-existent stat
      // or just use the built-in skipIfStuck with a hacky override:
      // Simplest safe approach — skipIfStuck only advances when stuck, so for
      // a true skip we need to use the duck-typed JS object directly.
      session._advance();
    }
    renderCard(session);
  }

  // ===== COMPLETE ============================================================
  function showComplete(session) {
    let result;
    try { result = session.result(); }
    catch (e) { 
      clear(root).append(el('p', { class: 'placeholder-text' }, 'Error: ' + e.message));
      return;
    }
    const statValues = session.statKeys.map((k) => result.baseStats[k] || 0);
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' },
            el('div', { class: 'summary-result' }, '\uD83C\uDF89 Draft Complete!'),
            el('div', { class: 'summary-mon' }, result.name)),
          el('div', { class: 'type-pills' },
            ...result.types.filter(Boolean).map((t) =>
              el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
          statSpreadEl(statValues.join('/')),
          el('div', { class: 'draft-complete-moves' },
            el('div', { class: 'draft-section-title', style: { marginTop: '12px' } }, 'Moves'),
            el('div', { class: 'draft-move-grid' },
              ...result.moves.map((m) => el('div', { class: 'draft-move-chip drafted' }, m)))),
          el('div', { class: 'summary-meta' },
            el('div', {}, `Source: ${result.silhouetteSpecies || result.name}`)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary',
              onClick: () => alert('Battle phase coming in Phase 5b!') }, '\u2694\uFE0F Go to Battle!'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  return { destroy() { clear(mount); } };
}

export default createDraftBattle;
