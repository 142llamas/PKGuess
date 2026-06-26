/**
 * @file        js/modes/draftbattle.js
 * @version     1.1.0
 * @updated     2026-06-25
 * @changelog
 *   1.1.0 — Must pick exactly 2 per card (no skip, no 1-pick advance).
 *           Unselect pending picks before confirming. Soft confirmation on
 *           reroll when picks are pending. Types: commutative-property note
 *           removed. Battle phase is Phase 5b (stubbed with info screen).
 *   1.0.0 — Initial 6×2 draft UI.
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
  root.append(el('div', { class: 'draft-loading' }, 'Loading draft data\u2026'));

  const variant = params.variant || 'freeplay';
  const isDaily = variant === 'daily';
  let pendingPicks = []; // [{type,key?,value?}]  — cleared on confirm or reroll
  let toast = null;

  Promise.all([
    fetch('data/movelist-gen2.json').then((r) => r.ok ? r.json() : {}),
    fetch('data/movestats-gen2.json').then((r) => r.ok ? r.json() : {}),
    fetch('data/draftpool-gen2.json').then((r) => r.ok ? r.json() : {}).catch(() => ({})),
  ]).then(([movelist, movestats, draftpoolExtra]) => {
    const draftMovelist = { ...movelist, ...draftpoolExtra };
    const learnsetMap = buildLearnsetMap(draftMovelist, movestats);
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

  function dailySeed() {
    const ctMs = Date.now() + (new Date().getTimezoneOffset() + (-6 * 60)) * 60000;
    const ct = new Date(ctMs);
    let h = (ct.getFullYear() * 10000 + (ct.getMonth() + 1) * 100 + ct.getDate()) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ---- soft toast ----------------------------------------------------------
  function showToast(msg, onConfirm) {
    if (toast) toast.remove();
    toast = el('div', { class: 'draft-toast' },
      el('span', {}, msg),
      el('div', { class: 'draft-toast-btns' },
        el('button', { class: 'btn-primary', style: { padding: '6px 14px', fontSize: '12px' },
          onClick: () => { toast.remove(); toast = null; onConfirm(); } }, 'Continue'),
        el('button', { class: 'btn-secondary', style: { padding: '6px 14px', fontSize: '12px' },
          onClick: () => { toast.remove(); toast = null; } }, 'Cancel')));
    root.append(toast);
  }

  // ===== RENDER CARD ========================================================
  function renderCard(session) {
    if (toast) { toast.remove(); toast = null; }
    if (session.isComplete()) { showComplete(session); return; }
    const card = session.current;
    const avail = session.availablePicks();
    const canPickMore = pendingPicks.length < 2;
    const totalDone = session.statKeys.length - session.openStatSlots().length
      + session.typeSlotsFilled() + session.moves.length;
    const remaining = (session.statKeys.length + 2 + 4) - totalDone;
    const readyToConfirm = pendingPicks.length === 2;

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
      bottomBar(session, remaining, readyToConfirm));
  }

  // ---- Top bar -------------------------------------------------------------
  function topBar(session) {
    const { pokemon: pr, moves: mr } = session.rerolls;
    return el('div', { class: 'draft-topbar' },
      el('button', { class: 'btn-secondary game-exit',
        onClick: () => { if (confirm('Quit draft? Progress will be lost.')) onExit && onExit(); } },
        '\u2190 Quit'),
      el('div', { class: 'draft-topbar-center' },
        el('div', { class: 'draft-progress' }, `Card #${session.position + 1}`),
        el('div', { class: 'draft-reroll-btns' },
          el('button', {
            class: `btn-secondary draft-reroll${pr <= 0 ? ' cant-afford' : ''}`,
            disabled: pr <= 0,
            onClick: () => {
              const doReroll = () => { if (session.rerollPokemon()) { pendingPicks = []; renderCard(session); } };
              if (pendingPicks.length > 0) {
                showToast('\uD83D\uDD04 Rerolling the Pok\u00e9mon will clear your current selection.', doReroll);
              } else { doReroll(); }
            },
          }, `\uD83D\uDD04 New Pok\u00e9mon (${pr})`),
          el('button', {
            class: `btn-secondary draft-reroll${mr <= 0 ? ' cant-afford' : ''}`,
            disabled: mr <= 0,
            onClick: () => {
              const hasMoveSelected = pendingPicks.some((p) => p.type === 'move');
              const doReroll = () => {
                if (session.rerollMoves()) {
                  // Only clear move picks; stat/type picks survive a move reroll
                  pendingPicks = pendingPicks.filter((p) => p.type !== 'move');
                  renderCard(session);
                }
              };
              if (hasMoveSelected) {
                showToast('\uD83D\uDD04 Rerolling moves will clear your selected move.', doReroll);
              } else { doReroll(); }
            },
          }, `\uD83D\uDD04 New Moves (${mr})`))));
  }

  // ---- Bottom bar ----------------------------------------------------------
  function bottomBar(session, remaining, readyToConfirm) {
    return el('div', { class: 'draft-bottombar' },
      el('div', { class: 'draft-pending-info' },
        readyToConfirm
          ? el('span', { style: { color: 'var(--accent-gold)', fontWeight: 700 } }, '2 picks ready \u2014 confirm to advance')
          : el('span', {}, `${pendingPicks.length}/2 picked \u2014 pick ${2 - pendingPicks.length} more`),
        el('span', { style: { color: 'var(--text-dim)', marginLeft: '10px' } }, `${remaining} attributes remaining`)),
      el('div', { class: 'draft-advance-btns' },
        readyToConfirm
          ? el('button', { class: 'btn-primary', onClick: () => advanceCard(session) }, 'Confirm & Next \u25b6')
          : el('button', { class: 'btn-primary', disabled: true, style: { opacity: 0.4 } }, 'Confirm & Next \u25b6')));
  }

  // ---- Stats section -------------------------------------------------------
  function statsSection(session, avail, canPickMore) {
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, 'Stats'),
      el('div', { class: 'draft-stat-chips' },
        ...session.statKeys.map((k) => {
          const drafted = k in session.stats;
          const pending = pendingPicks.some((p) => p.type === 'stat' && p.key === k);
          const available = !drafted && !pending && canPickMore && avail.stats.some((s) => s.stat === k);
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'stat' && p.key === k)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'stat', key: k }); renderCard(session); }
            : undefined;
          return el('div', { class: `draft-stat-chip ${state}`, onClick },
            el('span', { class: 'draft-chip-label' }, STAT_LABELS[k] || k.toUpperCase()),
            el('span', { class: 'draft-chip-state' },
              drafted ? '\u2713' : pending ? '\u00d7' : available ? '+' : '\u2014'));
        })));
  }

  // ---- Types section -------------------------------------------------------
  function typesSection(session, avail, canPickMore) {
    const cardTypes = [...session.current.types];
    if (session.cardIsMono()) cardTypes.push('\u2014');
    const slotsLeft = session.typeSlotsOpen();
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, `Types (${session.typeSlotsFilled()}/2 filled)`),
      el('div', { class: 'draft-type-chips' },
        ...cardTypes.map((t) => {
          const isDash = t === '\u2014';
          const drafted = isDash ? session.typeNone : session.types.includes(t);
          const pending = pendingPicks.some((p) => p.type === 'type' && p.value === t);
          const available = !drafted && !pending && canPickMore && slotsLeft > 0
            && (isDash ? session.canPickNoType() : session.current.types.includes(t));
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'type' && p.value === t)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'type', value: t }); renderCard(session); }
            : undefined;
          return el('div', { class: `draft-type-chip ${state} type-${isDash ? 'none' : t.toLowerCase()}`, onClick },
            isDash ? '\u2014 (mono)' : t);
        })));
  }

  // ---- Moves section -------------------------------------------------------
  function movesSection(session, avail, canPickMore) {
    const choices = session.moveChoices;
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, `Moves (${session.moves.length}/4 drafted)`),
      el('div', { class: 'draft-move-grid' },
        ...choices.map((m) => {
          const drafted = session.moves.includes(m);
          const pending = pendingPicks.some((p) => p.type === 'move' && p.value === m);
          const available = !drafted && !pending && canPickMore && session.moveSlotsOpen() > 0 && avail.moves.includes(m);
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'move' && p.value === m)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'move', value: m }); renderCard(session); }
            : undefined;
          return el('div', { class: `draft-move-chip ${state}`, onClick }, m);
        })));
  }

  // ---- Drafted summary sidebar --------------------------------------------
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
            el('span', { class: `type-pill type-${t === '?' || t === '\u2014' ? 'none' : t.toLowerCase()}` }, t)))),
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

  // ---- Advance (requires exactly 2 picks) ----------------------------------
  function advanceCard(session) {
    if (pendingPicks.length !== 2) return; // button is disabled if not 2
    for (const pick of pendingPicks) {
      if (pick.type === 'stat') session.pickStat(pick.key);
      else if (pick.type === 'type') {
        if (pick.value === '\u2014') session.pickNoType();
        else session.pickType(pick.value);
      } else if (pick.type === 'move') session.pickMove(pick.value);
    }
    pendingPicks = [];
    renderCard(session);
  }

  // ===== COMPLETE ===========================================================
  function showComplete(session) {
    let result;
    try { result = session.result(); } catch (e) {
      clear(root).append(el('p', { class: 'placeholder-text' }, 'Error: ' + e.message));
      return;
    }
    const statVals = session.statKeys.map((k) => result.baseStats[k] || 0);
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' },
            el('div', { class: 'summary-result' }, '\uD83C\uDF89 Draft Complete!'),
            el('div', { class: 'summary-mon' }, result.name)),
          el('div', { class: 'type-pills' },
            ...result.types.filter(Boolean).map((t) =>
              el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
          statSpreadEl(statVals.join('/')),
          el('div', { class: 'draft-complete-moves' },
            el('div', { class: 'draft-section-title', style: { marginTop: '12px' } }, 'Moves'),
            el('div', { class: 'draft-move-grid' },
              ...result.moves.map((m) => el('div', { class: 'draft-move-chip drafted' }, m)))),
          el('div', { class: 'summary-meta' },
            el('div', {}, `Based on: ${result.silhouetteSpecies || result.name}`)),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showBattleStub }, '\u2694\uFE0F Go to Battle!'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  function showBattleStub() {
    // Battle is Phase 5b — runMatch + playback + throne system
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' },
            el('div', { class: 'summary-result' }, '\u2694\uFE0F Battle — Coming Soon'),
            el('div', { class: 'summary-mon' }, 'Phase 5b')),
          el('p', { class: 'sf-intro' },
            'The battle simulation, playback, and throne system are the next phase of development. '
            + 'Your draft is complete and valid \u2014 the battle engine (runMatch from sim.js) is already integrated; '
            + 'the UI to display results and the throne/daily systems are what\u2019s still being built.'),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  return { destroy() { if (toast) { toast.remove(); toast = null; } clear(mount); } };
}

export default createDraftBattle;
