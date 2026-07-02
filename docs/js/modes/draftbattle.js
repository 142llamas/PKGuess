/**
 * @file        js/modes/draftbattle.js
 * @version     1.10.0
 * @updated     2026-06-26
 * @changelog
 *   1.10.0 — #9: daily results now has a "See Yesterday’s Results" button (Central-Time date math reused from today’s), with a "Today’s Results" button to return; showDailyResults()/renderDailyResults() generalized to take an optional historical date instead of always reading ctx.dateStr.
 *   1.9.0 — #14a: claimThrone() now enforces the one-spot-per-Pokémon rule via draft.js’s resolveThroneCascade, with a distinct on-screen message for each outcome (claimed + vacated, or kept the existing higher spot). throneCard() now threads the defeated holder’s full mon/uid through to the battle result so the cascade has what it needs.
 *   1.8.0 — #7: each Elite-4 tier’s NPC now scales to a target base-stat-total band (Will 425–450, Koga 475–500, Bruno 525–550, Lance 575–600) instead of drafting with the same natural stat distribution a player gets. The All-Time Champion tier is intentionally left unscaled (the spec didn’t define a band for it).
 *   1.7.0 — Battle-log playback now narrates every event sim.js 2.0.0 introduced (charge, recharge, multi-hit, curse, belly drum, rest, pain split, leech seed, crash, stat boosts, confusion ending) — these were previously silently dropped by the renderer's default:continue, so a stat-changing or special move would fire correctly but show nothing happening on screen.
 *   1.6.0 — Elite-4 labels (1–Will…, Stage x), one-throne history "name – types – stats", removed "battle the leader", default name "Player", locked-stage hardening (#5,#8,#14).
 *   1.5.0 — Elite-4 flow: ordered unlock (#2), "Challenge the Elite 4" (#1), claim "{name}’s spot" (#3), daily already-done gate (#6a), jump-to Elite-4/Results views (#7).
 *   1.4.0 — Draft batch (#1–10): thrones renamed to the Elite 4 (Day–Will,
 *           Week–Koga, Month–Bruno, Year–Lance, All-Time–Champion) with ①②③④/👑
 *           badges; "offline" banner now reflects the actual connection, not an
 *           empty node; daily entry write surfaces errors + verifies; a
 *           deterministic "Daily Rival" always competes; champion history per
 *           tier (Firebase) with a per-throne History view; share text rewritten
 *           to "I beat ___" with no win-meter; removed the "501 sims" wording.
 *   1.3.0 — Wired to draft.js v0.5.0 (per-card commit). Draft picks are now
 *           buffered in the UI and applied atomically via session.commitCard()
 *           so BOTH of a card's picks read that card's data. Type chips are
 *           pickable even when already owned (→ mono); "—" labelled "no 2nd
 *           type"; drafted stats grey out on all later cards; dynamic "N picks"
 *           prompt; Skip button when a card offers no valid pick. Requires
 *           draft.js ≥ 0.5.0 and lib/share.js.
 *   1.2.0 — PHASE 5b. Replaced the battle stub with the full post-draft flow:
 *           • Battle playback — runMatch(N=501) verdict (win% + strict-majority
 *             "beat") plus a step-through of one sample log with live HP bars.
 *           • Throne Challenge (free-play) — 5 thrones (Day/Week/Month/Year/
 *             All-Time). Each holds the reigning mon; a throne whose stored
 *             period has rolled over (midnight CT, etc.) shows a deterministic
 *             NPC champion. Beat the champion to claim the throne (Firebase).
 *           • Daily Challenge — one seeded draft + one attempt per identity,
 *             all-pairs ranking by average win%, results page + share card.
 *           • Central-Time date/seed/period now come from lib/share.js (DST-
 *             correct); the local fixed-offset dailySeed() was removed.
 *           Draft UI (the 6×2 card loop) is unchanged from 1.1.0.
 *   1.1.0 — Must pick exactly 2 per card; soft confirmations; battle stub.
 *   1.0.0 — Initial 6×2 draft UI.
 *
 * Contract: createDraftBattle({ mount, config, data, params, onExit }) → { destroy }
 *   params.variant = 'freeplay' | 'daily'
 */

import { el, clear, statSpreadEl } from '../lib/dom.js';
import {
  DraftSession, autoDraft, autoDraftScaled, resolveThroneCascade, TIER_RANK, buildSpeciesList, buildLearnsetMap, runMatch, toRealStats,
} from '../lib/draft-adapter.js';
import {
  centralDateStr, centralPeriodKey, seedFromDate, seedFromString, buildSummaryText,
  copyToClipboard, shareWhatsApp,
} from '../lib/share.js';

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spc: 'Spc', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const STATUS_LABELS = { par: 'paralyzed', brn: 'burned', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen', leechseed: 'Leech Seed', curse: 'the curse' };
const TIERS = [
  { key: 'day',   cadence: 'Day',      npc: 'Will',     icon: '\u2460', stage: 1, statBand: [425, 450] }, // ①
  { key: 'week',  cadence: 'Week',     npc: 'Koga',     icon: '\u2461', stage: 2, statBand: [475, 500] }, // ②
  { key: 'month', cadence: 'Month',    npc: 'Bruno',    icon: '\u2462', stage: 3, statBand: [525, 550] }, // ③
  { key: 'year',  cadence: 'Year',     npc: 'Lance',    icon: '\u2463', stage: 4, statBand: [575, 600] }, // ④
  { key: 'all',   cadence: 'All Time', npc: 'Champion', icon: '\uD83D\uDC51', stage: null, statBand: null }, // 👑 — no band defined; NPC fallback stays a natural, unscaled auto-draft
].map((t) => ({
  ...t,
  // card on the Elite-4 grid: "1 – Will" … "4 – Lance", "All Time – Champion"
  cardLabel: t.stage ? `${t.stage} \u2013 ${t.npc}` : 'All Time \u2013 Champion',
  // battle / history screen: "Elite 4 – Stage 1" … or "Greatest Pokémon of All Time"
  challengeLabel: t.stage ? `Elite 4 \u2013 Stage ${t.stage}` : 'Greatest Pok\u00e9mon of All Time',
  label: `${t.cadence} \u2013 ${t.npc}`,   // legacy fallback
}));
const BATTLE_N = 501;          // SPEC-locked sample count
const lazyIdentity = () => import('../lib/identity.js').then((m) => m.getIdentity());
const lazyFirebase = () => import('../lib/firebase.js').then((m) => m.getFirebase());

export function createDraftBattle({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'draft-root' });
  clear(mount).appendChild(root);
  root.append(el('div', { class: 'draft-loading' }, 'Loading draft data\u2026'));

  const variant = params.variant || 'freeplay';
  const isDaily = variant === 'daily';

  let pendingPicks = [];   // [{type,key?,value?}] — cleared on confirm or reroll
  let toast = null;
  let playTimer = null;    // battle auto-play interval
  let ctx = null;          // { species, movestats, chart }
  let lastResult = null;   // completed draft result()
  let identity = null;     // resolved lazily for daily / throne
  let firebase = null;

  Promise.all([
    fetch('data/movelist-gen2.json').then((r) => (r.ok ? r.json() : {})),
    fetch('data/movestats-gen2.json').then((r) => (r.ok ? r.json() : {})),
    fetch('data/draftpool-gen2.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch('data/typechart-gen2.json').then((r) => (r.ok ? r.json() : {})),
  ]).then(([movelist, movestats, draftpoolExtra, chart]) => {
    const learnsetMap = buildLearnsetMap({ ...movelist, ...draftpoolExtra }, movestats);
    const species = buildSpeciesList(data, learnsetMap, 2);
    if (!species.length) throw new Error('No draftable species found.');
    ctx = { species, movestats, chart };
    if (isDaily) startDaily();
    else if (params.view === 'thrones') showThrones();   // #7 — view the Elite 4 directly
    else startDraft(((Math.random() * 2 ** 31) | 0), { pokemon: 3, moves: 3 });
  }).catch((err) => showError(err));

  function showError(err) {
    stopPlay();
    clear(root).append(
      el('p', { class: 'placeholder-text' }, 'Could not load: ' + (err && err.message || err)),
      el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Back'));
  }

  function startDraft(seed, rerolls) {
    const session = new DraftSession({ species: ctx.species, gen: 2, seed, rerolls });
    pendingPicks = [];
    renderCard(session);
  }

  // ===== DAILY ENTRY GATE ===================================================
  async function startDaily() {
    clear(root).append(spinner('Loading today\u2019s challenge\u2026'));
    ctx.dateStr = centralDateStr();
    try { identity = await lazyIdentity(); firebase = await lazyFirebase(); } catch { /* offline */ }
    if (params.view === 'results') { showDailyResults(); return; }   // #7 — Results button
    if (identity && firebase) {
      try {
        const existing = await firebase.get(`/draft/daily/${ctx.dateStr}/entries/${identity.uid}`);
        if (existing) { showDailyGate(); return; }        // #6a — already played today
      } catch { /* read failed — let them play, submit may still work */ }
    }
    startDraft(seedFromDate(ctx.dateStr), { pokemon: 1, moves: 1 });
  }

  // #6a — message shown when today's daily is already done
  function showDailyGate() {
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card', style: { textAlign: 'center' } },
          el('div', { class: 'summary-result' }, '\u2705 Already done today'),
          el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
            'You\u2019ve already completed today\u2019s draft challenge. Come back tomorrow for a new one!'),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-primary', onClick: showDailyResults }, 'View Results'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  // ===== shared bits ========================================================
  function spinner(msg) {
    return el('div', { class: 'draft-loading' },
      el('div', { class: 'battle-spinner' }), el('div', { style: { marginTop: '10px' } }, msg));
  }
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
  function flash(msg) {
    if (toast) toast.remove();
    toast = el('div', { class: 'draft-toast' },
      el('span', {}, msg),
      el('div', { class: 'draft-toast-btns' },
        el('button', { class: 'btn-secondary', style: { padding: '6px 14px', fontSize: '12px' },
          onClick: () => { toast.remove(); toast = null; } }, 'OK')));
    root.append(toast);
    setTimeout(() => { if (toast) { toast.remove(); toast = null; } }, 4000);
  }
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } }

  // mon (storage) <-> battle spec helpers
  function storedFromResult(res) {
    const o = { name: res.name, types: res.types.filter(Boolean), baseStats: res.baseStats, moves: res.moves };
    if (res.silhouetteSpecies) o.species = res.silhouetteSpecies;
    if (res.silhouetteSpriteId != null) o.sprite = res.silhouetteSpriteId;
    return o;
  }
  function specFromResult(res) { return { name: res.name, types: res.types.filter(Boolean), stats: res.stats, moves: res.moves }; }
  function specFromStored(m) {
    return { name: m.name, types: (m.types || []).filter(Boolean), stats: toRealStats(m.baseStats, 2), moves: m.moves || [] };
  }

  // ===== RENDER CARD (draft) ===============================================
  // Pending picks (UI buffer) are applied to the engine atomically on confirm via
  // session.commitCard(...), so both picks read the SAME (current) card's data.
  function renderCard(session) {
    if (toast) { toast.remove(); toast = null; }
    if (session.isComplete()) { showComplete(session); return; }
    const avail = session.availablePicks();
    const card = session.current;

    // slot bookkeeping (accounting for what is pending this card)
    const pendStat = pendingPicks.filter((p) => p.type === 'stat').length;
    const pendType = pendingPicks.filter((p) => p.type === 'type').length;   // includes "—"
    const pendMove = pendingPicks.filter((p) => p.type === 'move').length;
    const statLeft = session.openStatSlots().length - pendStat;
    const typeLeft = session.typeSlotsOpen() - pendType;
    const moveLeft = session.moveSlotsOpen() - pendMove;
    const slotsRemaining = session.openStatSlots().length + session.typeSlotsOpen() + session.moveSlotsOpen();

    // how many distinct attributes this card can offer at all (independent of pending)
    const cardTypeCount = avail.types.length + (avail.canPickNoType ? 1 : 0);
    const cardAttrTotal = session.openStatSlots().length
      + (session.typeSlotsOpen() > 0 ? cardTypeCount : 0)
      + (session.moveSlotsOpen() > 0 ? avail.moves.length : 0);

    const maxPick = Math.min(2, slotsRemaining, cardAttrTotal);   // picks wanted from this card
    const canPickMore = pendingPicks.length < maxPick;

    // anything still selectable after the current pending set?
    const dashTaken = session.typeNone || pendingPicks.some((p) => p.type === 'type' && p.value === '\u2014');
    const moreStat = statLeft > 0;
    const moreType = typeLeft > 0 && (avail.types.some((t) => !pendingPicks.some((p) => p.type === 'type' && p.value === t))
      || (avail.canPickNoType && !dashTaken));
    const moreMove = moveLeft > 0 && avail.moves.some((m) => !pendingPicks.some((p) => p.type === 'move' && p.value === m));
    const moreAvailable = canPickMore && (moreStat || moreType || moreMove);

    const readyToConfirm = pendingPicks.length > 0 && (pendingPicks.length === maxPick || !moreAvailable);
    const stuck = maxPick === 0;   // card offers nothing useful → reroll or skip

    const remaining = slotsRemaining;

    clear(root).append(
      topBar(session),
      el('div', { class: 'draft-body' },
        el('div', { class: 'draft-card-panel' },
          el('div', { class: 'draft-card-header' },
            el('div', { class: 'draft-card-name' }, card.name),
            el('div', { class: 'draft-type-pills' },
              ...card.types.map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}` }, t)),
              session.cardIsMono() ? el('span', { class: 'type-pill type-none' }, '\u2014') : null)),
          statsSection(session, avail, canPickMore, statLeft),
          typesSection(session, avail, canPickMore, typeLeft),
          movesSection(session, avail, canPickMore, moveLeft)),
        el('div', { class: 'draft-side-panel' }, draftedSummary(session))),
      bottomBar(session, remaining, readyToConfirm, maxPick, stuck));
  }

  function topBar(session) {
    const { pokemon: pr, moves: mr } = session.rerolls;
    return el('div', { class: 'draft-topbar' },
      el('button', { class: 'btn-secondary game-exit',
        onClick: () => { if (confirm('Quit draft? Progress will be lost.')) onExit && onExit(); } }, '\u2190 Quit'),
      el('div', { class: 'draft-topbar-center' },
        el('div', { class: 'draft-progress' }, `${isDaily ? 'Daily \u00b7 ' : ''}Card #${session.position + 1}`),
        el('div', { class: 'draft-reroll-btns' },
          el('button', { class: `btn-secondary draft-reroll${pr <= 0 ? ' cant-afford' : ''}`, disabled: pr <= 0,
            onClick: () => {
              const doReroll = () => { if (session.rerollPokemon()) { pendingPicks = []; renderCard(session); } };
              if (pendingPicks.length > 0) showToast('\uD83D\uDD04 Rerolling the Pok\u00e9mon will clear your current selection.', doReroll);
              else doReroll();
            } }, `\uD83D\uDD04 New Pok\u00e9mon (${pr})`),
          el('button', { class: `btn-secondary draft-reroll${mr <= 0 ? ' cant-afford' : ''}`, disabled: mr <= 0,
            onClick: () => {
              const hasMove = pendingPicks.some((p) => p.type === 'move');
              const doReroll = () => {
                if (session.rerollMoves()) { pendingPicks = pendingPicks.filter((p) => p.type !== 'move'); renderCard(session); }
              };
              if (hasMove) showToast('\uD83D\uDD04 Rerolling moves will clear your selected move.', doReroll);
              else doReroll();
            } }, `\uD83D\uDD04 New Moves (${mr})`))));
  }

  function bottomBar(session, remaining, readyToConfirm, maxPick, stuck) {
    const info = stuck
      ? el('span', { style: { color: '#e0b341' } }, 'No valid picks on this card \u2014 reroll or skip.')
      : readyToConfirm
        ? el('span', { style: { color: 'var(--accent-gold)', fontWeight: 700 } }, `${pendingPicks.length} pick${pendingPicks.length === 1 ? '' : 's'} ready \u2014 confirm to advance`)
        : el('span', {}, `${pendingPicks.length}/${maxPick} picked \u2014 pick ${maxPick - pendingPicks.length} more`);
    return el('div', { class: 'draft-bottombar' },
      el('div', { class: 'draft-pending-info' },
        info,
        el('span', { style: { color: 'var(--text-dim)', marginLeft: '10px' } }, `${remaining} attributes remaining`)),
      el('div', { class: 'draft-advance-btns' },
        stuck
          ? el('button', { class: 'btn-secondary', onClick: () => { session.skipIfStuck(); pendingPicks = []; renderCard(session); } }, 'Skip card \u23ED')
          : readyToConfirm
            ? el('button', { class: 'btn-primary', onClick: () => advanceCard(session) }, 'Confirm & Next \u25b6')
            : el('button', { class: 'btn-primary', disabled: true, style: { opacity: 0.4 } }, 'Confirm & Next \u25b6')));
  }

  function statsSection(session, avail, canPickMore, statLeft) {
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, 'Stats'),
      el('div', { class: 'draft-stat-chips' },
        ...session.statKeys.map((k) => {
          const drafted = k in session.stats;                       // greyed on ALL future cards
          const pending = pendingPicks.some((p) => p.type === 'stat' && p.key === k);
          const available = !drafted && !pending && canPickMore && statLeft > 0;
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'stat' && p.key === k)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'stat', key: k }); renderCard(session); }
            : undefined;
          return el('div', { class: `draft-stat-chip ${state}`, onClick },
            el('span', { class: 'draft-chip-label' }, STAT_LABELS[k] || k.toUpperCase()),
            el('span', { class: 'draft-chip-state' }, drafted ? '\u2713' : pending ? '\u00d7' : available ? '+' : '\u2014'));
        })));
  }

  function typesSection(session, avail, canPickMore, typeLeft) {
    // A card's real types are always pickable while type slots remain (picking one
    // you already own collapses the build to mono). "—" is pickable on mono cards.
    const cardTypes = [...session.current.types];
    const dashTaken = session.typeNone || pendingPicks.some((p) => p.type === 'type' && p.value === '\u2014');
    if (session.cardIsMono()) cardTypes.push('\u2014');
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, `Types (${session.typeSlotsFilled()}/2 filled)`),
      el('div', { class: 'draft-type-chips' },
        ...cardTypes.map((t) => {
          const isDash = t === '\u2014';
          const owned = !isDash && session.types.includes(t);       // shown but still pickable (→ mono)
          const pending = pendingPicks.some((p) => p.type === 'type' && p.value === t);
          const available = !pending && canPickMore && typeLeft > 0
            && (isDash ? (session.canPickNoType() && !dashTaken) : true);
          const state = pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'type' && p.value === t)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'type', value: t }); renderCard(session); }
            : undefined;
          const label = isDash ? '\u2014 (no 2nd type)' : (owned ? `${t} \u2713` : t);
          return el('div', { class: `draft-type-chip ${state} type-${isDash ? 'none' : t.toLowerCase()}`, onClick }, label);
        })));
  }

  function movesSection(session, avail, canPickMore, moveLeft) {
    const choices = session.moveChoices;
    return el('div', { class: 'draft-section' },
      el('div', { class: 'draft-section-title' }, `Moves (${session.moves.length}/4 drafted)`),
      el('div', { class: 'draft-move-grid' },
        ...(choices.length ? choices : []).map((m) => {
          const drafted = session.moves.includes(m);               // no move twice
          const pending = pendingPicks.some((p) => p.type === 'move' && p.value === m);
          const available = !drafted && !pending && canPickMore && moveLeft > 0;
          const state = drafted ? 'drafted' : pending ? 'pending' : available ? 'available' : 'unavailable';
          const onClick = pending
            ? () => { pendingPicks = pendingPicks.filter((p) => !(p.type === 'move' && p.value === m)); renderCard(session); }
            : available
            ? () => { pendingPicks.push({ type: 'move', value: m }); renderCard(session); }
            : undefined;
          return el('div', { class: `draft-move-chip ${state}`, onClick }, m);
        }),
        choices.length ? null : el('div', { style: { color: 'var(--text-dim)', fontSize: '12px' } }, 'This Pok\u00e9mon has no draftable moves.')));
  }

  function draftedSummary(session) {
    const typeDisplay = session.typeDisplay();                     // e.g. ['Fire','—'] / ['Fire','?']
    return el('div', { class: 'draft-summary' },
      el('div', { class: 'draft-summary-title' }, 'Your Build'),
      el('div', { class: 'draft-summary-section' },
        el('div', { class: 'draft-chip-label' }, 'Types'),
        el('div', { class: 'draft-type-pills' },
          ...typeDisplay.map((t) => el('span', { class: `type-pill type-${t === '?' || t === '\u2014' ? 'none' : t.toLowerCase()}` }, t)))),
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

  // Apply both UI picks atomically against the current card, then advance.
  function advanceCard(session) {
    const picks = pendingPicks.map((p) => (p.type === 'type' && p.value === '\u2014') ? { type: 'none' } : p);
    session.commitCard(picks);
    pendingPicks = [];
    renderCard(session);
  }

  // ===== COMPLETE ===========================================================
  function showComplete(session) {
    stopPlay();
    let result;
    try { result = session.result(); } catch (e) {
      clear(root).append(el('p', { class: 'placeholder-text' }, 'Error: ' + e.message)); return;
    }
    lastResult = result;
    renderBuild(result);
  }

  function renderBuild(result) {
    stopPlay();
    const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    const statVals = statKeys.map((k) => result.baseStats[k] || 0);
    const actions = isDaily
      ? [el('button', { class: 'btn-primary', onClick: submitDaily }, '\uD83D\uDCE4 Submit & See Results'),
         el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')]
      : [el('button', { class: 'btn-primary', onClick: showThrones }, '\u2694\uFE0F Challenge the Elite 4'),
         el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')];

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header win' },
            el('div', { class: 'summary-result' }, '\uD83C\uDF89 Draft Complete!'),
            el('div', { class: 'summary-mon' }, result.name)),
          el('div', { class: 'type-pills' },
            ...result.types.filter(Boolean).map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
          statSpreadEl(statVals.join('/')),
          el('div', { class: 'draft-complete-moves' },
            el('div', { class: 'draft-section-title', style: { marginTop: '12px' } }, 'Moves'),
            el('div', { class: 'draft-move-grid' },
              ...result.moves.map((m) => el('div', { class: 'draft-move-chip drafted' }, m)))),
          el('div', { class: 'summary-meta' }, el('div', {}, `Based on: ${result.silhouetteSpecies || result.name}`)),
          el('div', { class: 'summary-actions' }, ...actions))));
  }

  // ===== THRONE (free-play) =================================================
  async function showThrones() {
    stopPlay();
    clear(root).append(spinner('Summoning the champions\u2026'));
    let raw = null, connected = true;
    try {
      if (!firebase) firebase = await lazyFirebase();
      if (!identity) identity = await lazyIdentity();
      raw = await firebase.get('/draft/throne');   // null simply means "no one has claimed yet"
    } catch { connected = false; raw = null; }
    const thrones = TIERS.map((tier) => resolveThrone(tier, raw && raw[tier.key]));
    renderThrones(thrones, !connected || !firebase);
  }

  function resolveThrone(tier, stored) {
    const period = centralPeriodKey(tier.key);
    if (stored && stored.period === period && stored.mon) {
      return { tier, period, mon: stored.mon, holderName: stored.holderName || 'A challenger', holderUid: stored.holderUid || null, npc: false };
    }
    // Vacant (or rolled over) → the Elite-4 member holds it with a deterministic build,
    // scaled to that stage's target base-stat-total band (#7) when one is defined.
    const seed = seedFromString(`throne:${tier.key}:${period}`);
    const champ = tier.statBand
      ? autoDraftScaled({ species: ctx.species, gen: 2, seed, playerName: tier.npc, minTotal: tier.statBand[0], maxTotal: tier.statBand[1] })
      : autoDraft({ species: ctx.species, gen: 2, seed, playerName: tier.npc });
    return { tier, period, mon: storedFromResult(champ), holderName: tier.npc, holderUid: null, npc: true };
  }

  function renderThrones(thrones, offline) {
    const uid = identity && identity.uid;
    const conquered = (t) => !!(t && t.holderUid && uid && t.holderUid === uid);
    const haveBuild = !!lastResult;
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '6px' } }, '\u2694\uFE0F The Elite 4'),
          el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
            'Beat each member to take their spot \u2014 they must be challenged in order. '
            + 'Each empties to a fresh champion at its reset \u2014 Day at midnight Central, Week end of Sunday, Month on the 1st, Year on Jan 1; All-Time never resets.'),
          offline ? el('div', { class: 'battle-offline' }, '\u26A0\uFE0F Offline \u2014 showing practice champions; claims won\u2019t be saved.') : null,
          !haveBuild ? el('div', { class: 'sf-intro', style: { textAlign: 'center', color: 'var(--text-dim)' } }, 'Draft a team first to challenge them.') : null,
          el('div', { class: 'draft-throne-grid' },
            ...thrones.map((t, i) => throneCard(t, {
              // #2 — unlocked only if it's the first tier or you hold the one before it
              unlocked: i === 0 || conquered(thrones[i - 1]),
              prevName: i > 0 ? thrones[i - 1].tier.npc : null,
              haveBuild,
            }))),
          el('div', { class: 'summary-actions' },
            haveBuild ? el('button', { class: 'btn-secondary', onClick: () => renderBuild(lastResult) }, '\u2190 My Build') : null,
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main Menu')))));
  }

  function throneCard(t, opts = {}) {
    const monName = t.mon.species || t.mon.name;
    const { unlocked = true, prevName = null, haveBuild = true } = opts;
    const canChallenge = unlocked && haveBuild;
    const challengeBtn = canChallenge
      ? el('button', { class: 'btn-primary', style: { padding: '7px 12px', fontSize: '12px' },
          onClick: () => { if (!canChallenge) return; startBattle(specFromResult(lastResult), specFromStored(t.mon),
            { mode: 'throne', tier: t.tier, champLabel: t.holderName, npc: t.npc, champMon: monName, defeatedMon: t.mon, defeatedUid: t.holderUid }); } },
          'Challenge')
      : el('button', { class: 'btn-primary throne-locked-btn', disabled: true, style: { padding: '7px 12px', fontSize: '12px', opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } },
          unlocked ? 'Challenge' : `\uD83D\uDD12 Beat ${prevName} first`);
    return el('div', { class: 'throne-card' + (unlocked ? '' : ' throne-locked') },
      el('div', { class: 'throne-tier' }, `${t.tier.icon} ${t.tier.cardLabel}`),
      el('div', { class: 'throne-holder' }, (t.npc ? '' : '\uD83D\uDC51 ') + t.holderName),
      el('div', { class: 'throne-mon' }, ...(t.mon.types || []).map((ty) => el('span', { class: `type-pill type-${ty.toLowerCase()}`, style: { fontSize: '9px', marginRight: '3px' } }, ty))),
      el('div', { class: 'throne-mon', style: { color: 'var(--text-dim)' } }, monName),
      el('div', { class: 'throne-card-btns' },
        challengeBtn,
        el('button', { class: 'btn-secondary', style: { padding: '7px 10px', fontSize: '11px' },
          onClick: () => showThroneHistory(t.tier) }, 'History')));
  }

  // ===== CHAMPION HISTORY (#7) ==============================================
  async function showThroneHistory(tier) {
    clear(root).append(spinner(`${tier.challengeLabel} \u2014 champion history\u2026`));
    let hist = null;
    try { if (!firebase) firebase = await lazyFirebase(); hist = await firebase.get(`/draft/thronehistory/${tier.key}`); }
    catch { hist = null; }
    const entries = hist ? Object.values(hist).sort((a, b) => (b.at || 0) - (a.at || 0)) : [];
    const fmt = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
    // #14f — "Gastly – Ice/Grass – 35/55/65/35/100/125" (older entries stored a bare name string)
    const monLabel = (mon) => {
      if (!mon) return '';
      if (typeof mon === 'string') return mon;
      const types = (mon.types || []).filter(Boolean).join('/');
      const stats = Array.isArray(mon.baseStats) ? mon.baseStats.join('/') : '';
      return [mon.name, types, stats].filter(Boolean).join(' \u2013 ');
    };
    const rows = entries.length
      ? entries.map((e) => el('tr', {},
          el('td', { style: { color: 'var(--text-dim)', fontSize: '11px', whiteSpace: 'nowrap' } }, fmt(e.at)),
          el('td', { style: { fontWeight: 700 } }, e.name || 'Player'),
          el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, monLabel(e.mon))))
      : [el('tr', {}, el('td', { colspan: '3', style: { textAlign: 'center', color: 'var(--text-dim)' } }, 'No champions yet \u2014 be the first.'))];
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center' } }, `${tier.icon} ${tier.challengeLabel} \u2014 Champions`),
          el('div', { class: 'lb-board' },
            el('table', { class: 'lb-table' },
              el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Player'), el('th', {}, 'Pok\u00e9mon'))),
              el('tbody', {}, ...rows))),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: showThrones }, '\u2190 Elite 4')))));
  }

  async function claimThrone(tier, opts = {}) {
    let id = identity, fb = firebase;
    try { if (!id) id = identity = await lazyIdentity(); if (!fb) fb = firebase = await lazyFirebase(); } catch { /* offline */ }
    if (!id || !fb) return { ok: false, msg: 'Offline \u2014 throne not saved.' };
    const rec = {
      mon: storedFromResult(lastResult),
      holderUid: id.uid,
      holderName: (id.name || 'Player').slice(0, 16),
      takenAt: Date.now(),
      period: centralPeriodKey(tier.key),
    };
    try {
      // #14a — a single Pok\u00e9mon/session can only hold ONE Elite-4 spot at a
      // time. The DECISION (who ends up where) is a pure function so it's
      // fully unit-testable; this just performs the resulting reads/writes.
      let existingThrones = null;
      try { existingThrones = await fb.get('/draft/throne'); } catch { existingThrones = null; }
      const otherKey = existingThrones
        ? Object.keys(existingThrones).find((k) => k !== tier.key && existingThrones[k] && existingThrones[k].holderUid === id.uid)
        : null;

      if (otherKey) {
        const decision = resolveThroneCascade({
          newTierKey: tier.key, oldTierKey: otherKey, tierRank: TIER_RANK,
          defeatedUid: opts.defeatedUid, defeatedMon: opts.defeatedMon, champLabel: opts.champLabel,
        });
        if (decision.action === 'claimNewVacateOld') {
          await fb.set(`/draft/throne/${tier.key}`, rec);
          if (decision.bump) {
            await fb.set(`/draft/throne/${decision.vacatedTier}`, {
              mon: decision.bump.mon, holderUid: decision.bump.holderUid,
              holderName: decision.bump.holderName.slice(0, 16),
              takenAt: Date.now(), period: centralPeriodKey(decision.vacatedTier),
            });
          } else {
            await fb.set(`/draft/throne/${decision.vacatedTier}`, null);
          }
          try { await fb.push(`/draft/thronehistory/${tier.key}`, { name: rec.holderName, mon: { name: lastResult ? lastResult.name : (rec.mon && rec.mon.name) || '', types: (rec.mon && rec.mon.types) || [], baseStats: (rec.mon && rec.mon.baseStats) || [] }, at: rec.takenAt, period: rec.period }); } catch { /* history is best-effort */ }
          return { ok: true, vacatedTier: decision.vacatedTier, bumpedName: decision.bump ? decision.bump.holderName : null };
        }
        // keepOld — player already holds a HIGHER throne; this one reverts to vacant.
        await fb.set(`/draft/throne/${tier.key}`, null);
        return { ok: true, keptHigherTier: decision.keptTier };
      }

      await fb.set(`/draft/throne/${tier.key}`, rec);
      try { await fb.push(`/draft/thronehistory/${tier.key}`, { name: rec.holderName, mon: { name: lastResult ? lastResult.name : (rec.mon && rec.mon.name) || '', types: (rec.mon && rec.mon.types) || [], baseStats: (rec.mon && rec.mon.baseStats) || [] }, at: rec.takenAt, period: rec.period }); } catch { /* history is best-effort */ }
      return { ok: true };
    } catch (e) { return { ok: false, msg: 'Save failed: ' + (e.message || e) }; }
  }

  // ===== BATTLE =============================================================
  function startBattle(aSpec, bSpec, opts) {
    stopPlay();
    clear(root).append(spinner('Running the battle\u2026'));
    // defer so the spinner paints before the (synchronous) sim burst
    setTimeout(() => {
      const seed = seedFromString(`${aSpec.name}|${bSpec.name}|${opts.tier ? opts.tier.key : 'x'}`);
      const res = runMatch(aSpec, bSpec, { gen: 2, moves: ctx.movestats, chart: ctx.chart, n: BATTLE_N, seed });
      const pb = buildPlayback(res.sampleLog, aSpec, bSpec);
      renderBattle(aSpec, bSpec, res, pb, opts);
    }, 30);
  }

  function buildPlayback(sample, aSpec, bSpec) {
    const maxA = aSpec.stats.hp, maxB = bSpec.stats.hp;
    let hpA = maxA, hpB = maxB, turn = 0;
    const sideOf = (nm) => (nm === aSpec.name ? 'a' : nm === bSpec.name ? 'b' : null);
    const dmg = (nm, amt) => { const s = sideOf(nm); if (s === 'a') hpA = Math.max(0, hpA - amt); else if (s === 'b') hpB = Math.max(0, hpB - amt); };
    const heal = (nm, amt) => { const s = sideOf(nm); if (s === 'a') hpA = Math.min(maxA, hpA + amt); else if (s === 'b') hpB = Math.min(maxB, hpB + amt); };
    const frames = [{ hpA, hpB, turn, line: `${aSpec.name} faces ${bSpec.name}!` }];
    const eff = (e) => (e > 1 ? ' \u2014 super effective!' : (e > 0 && e < 1) ? ' \u2014 not very effective' : '');
    for (const e of sample) {
      let line = null;
      switch (e.t) {
        case 'turn': turn = e.n; continue;
        case 'use': line = `${e.source} used ${e.move}.`; break;
        case 'miss': line = `${e.source}\u2019s ${e.move} missed!`; break;
        case 'immune': line = `It doesn\u2019t affect ${e.target}\u2026`; break;
        case 'ohko': dmg(e.target, Infinity); line = `One-hit KO on ${e.target}!`; break;
        case 'damage': dmg(e.target, e.amount); line = `${e.target} took ${e.amount}${e.crit ? ' (critical hit!)' : ''}${eff(e.eff)}`; break;
        case 'recoil': dmg(e.target, e.amount); line = `${e.target} is hit by recoil (${e.amount}).`; break;
        case 'confused-hit': dmg(e.target, e.amount); line = `${e.target} hurt itself in confusion (${e.amount}).`; break;
        case 'chip': dmg(e.target, e.amount); line = `${e.target} is hurt by ${STATUS_LABELS[e.cause] || e.cause} (${e.amount}).`; break;
        case 'heal': heal(e.target, e.amount); line = `${e.target} restored ${e.amount} HP.`; break;
        case 'drain': heal(e.target, e.amount); line = `${e.target} drained ${e.amount} HP.`; break;
        case 'status': line = `${e.target} is ${STATUS_LABELS[e.status] || e.status}!`; break;
        case 'confuse': line = `${e.target} became confused!`; break;
        case 'confuse-end': line = `${e.target} snapped out of confusion.`; break;
        case 'flinch': line = `${e.target} flinched!`; break;
        case 'fullpara': line = `${e.target} is paralyzed and can\u2019t move!`; break;
        case 'asleep': line = `${e.target} is fast asleep.`; break;
        case 'wake': line = `${e.target} woke up!`; break;
        case 'frozen': line = `${e.target} is frozen solid!`; break;
        case 'thaw': line = `${e.target} thawed out!`; break;
        case 'faint': dmg(e.target, Infinity); line = `${e.target} fainted!`; break;
        case 'cap': line = 'Turn limit reached \u2014 highest HP% wins.'; break;
        case 'charge': line = `${e.source} tucked in its ${e.move === 'Fly' ? 'wings and flew up' : e.move === 'Dig' ? 'body and dug underground' : 'power'} for ${e.move}!`; break;
        case 'recharge': line = `${e.target} must recharge!`; break;
        case 'multihit': line = `Hit ${e.hits} time${e.hits === 1 ? '' : 's'}!`; break;
        case 'curse-cost': dmg(e.target, e.amount); line = `${e.target} cut its own HP to lay a curse! (${e.amount})`; break;
        case 'curse': line = `${e.target} was cursed!`; break;
        case 'bellydrum': dmg(e.target, e.amount); line = `${e.target} cut its own HP to maximize its Attack! (${e.amount})`; break;
        case 'rest': line = `${e.target} went to sleep and became healthy!`; break;
        case 'painsplit': line = `${e.source} and ${e.target} shared their pain \u2014 HP equalized.`; break;
        case 'leechseed': line = `${e.target} was seeded!`; break;
        case 'crash': dmg(e.target, e.amount); line = `${e.target} kept going and crashed! (${e.amount})`; break;
        case 'fail': line = 'But it failed!'; break;
        case 'boost': {
          const label = STAT_LABELS[e.stat] || e.stat;
          const mag = Math.abs(e.delta) >= 2 ? ' sharply' : '';
          line = `${e.target}\u2019s ${label}${mag} ${e.delta > 0 ? 'rose' : 'fell'}!`;
          break;
        }
        default: continue;
      }
      if (line != null) frames.push({ hpA, hpB, turn, line });
    }
    return { frames, maxA, maxB };
  }

  function renderBattle(aSpec, bSpec, res, pb, opts) {
    stopPlay();
    let idx = 0;
    const beat = res.challengerBeatsChampion;
    const pct = res.challengerWinPct;

    const stage = el('div', { class: 'battle-stage' });
    const logBox = el('div', { class: 'battle-log-inner' });
    const verdict = el('div', { class: 'battle-verdict' });
    const controls = el('div', { class: 'battle-controls' });

    function hpBar(cur, max, side) {
      const ratio = max > 0 ? cur / max : 0;
      const cls = ratio > 0.5 ? 'hp-ok' : ratio > 0.2 ? 'hp-warn' : 'hp-low';
      return el('div', { class: 'battle-side' },
        el('div', { class: 'battle-mon-name' }, side === 'a' ? `\uD83D\uDD35 ${aSpec.name}` : `\uD83D\uDD34 ${bSpec.name}`),
        el('div', { class: 'battle-types' }, ...(side === 'a' ? aSpec.types : bSpec.types).map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}`, style: { fontSize: '9px', marginRight: '3px' } }, t))),
        el('div', { class: 'hp-track' }, el('div', { class: `hp-fill ${cls}`, style: { width: Math.round(ratio * 100) + '%' } })),
        el('div', { class: 'hp-num' }, `${Math.max(0, Math.round(cur))} / ${max}`));
    }

    function paint() {
      const f = pb.frames[idx];
      clear(stage).append(hpBar(f.hpA, pb.maxA, 'a'), el('div', { class: 'battle-vs' }, 'VS'), hpBar(f.hpB, pb.maxB, 'b'));
      clear(logBox);
      const from = Math.max(0, idx - 40);
      for (let i = from; i <= idx; i++) logBox.append(el('div', { class: 'battle-log-line' }, pb.frames[i].line));
      logBox.scrollTop = logBox.scrollHeight;
      const atEnd = idx >= pb.frames.length - 1;
      clear(verdict);
      if (atEnd) {
        verdict.className = 'battle-verdict ' + (beat ? 'win' : 'loss');
        verdict.append(
          el('div', { class: 'battle-verdict-head' }, beat ? '\uD83C\uDFC6 You win!' : '\u274C You fell short'),
          el('div', { class: 'battle-verdict-sub' }, `${(pct * 100).toFixed(1)}% win rate`));
      }
      renderControls(atEnd);
    }

    function renderControls(atEnd) {
      clear(controls);
      const stepBtn = (label, fn, dis) => el('button', { class: 'btn-secondary', style: { padding: '6px 12px' }, disabled: dis, onClick: fn }, label);
      const playing = !!playTimer;
      controls.append(
        stepBtn('\u25C0 Back', () => { stopPlay(); idx = Math.max(0, idx - 1); paint(); }, idx <= 0),
        playing
          ? stepBtn('\u23F8 Pause', () => { stopPlay(); paint(); }, false)
          : stepBtn('\u25B6 Play', () => {
              stopPlay();
              playTimer = setInterval(() => {
                if (idx >= pb.frames.length - 1) { stopPlay(); paint(); return; }
                idx++; paint();
              }, 650);
              paint();
            }, atEnd),
        stepBtn('Step \u25B6', () => { stopPlay(); idx = Math.min(pb.frames.length - 1, idx + 1); paint(); }, atEnd),
        stepBtn('\u23ED Skip', () => { stopPlay(); idx = pb.frames.length - 1; paint(); }, atEnd));

      // contextual actions at the end
      const after = el('div', { class: 'battle-after' });
      if (atEnd) {
        if (opts.mode === 'throne') {
          if (beat) {
            const beatName = opts.npc ? opts.tier.npc : opts.champLabel;
            after.append(el('button', { class: 'btn-primary', onClick: async () => {
              const r = await claimThrone(opts.tier, opts);
              if (r.ok && r.keptHigherTier) {
                const keptLabel = TIERS.find((t) => t.key === r.keptHigherTier)?.cardLabel || r.keptHigherTier;
                flash(`You already hold a higher Elite 4 spot (${keptLabel}) \u2014 this one stays open for the next challenger.`);
                showThrones();
              } else if (r.ok && r.vacatedTier) {
                const vacatedLabel = TIERS.find((t) => t.key === r.vacatedTier)?.cardLabel || r.vacatedTier;
                const vacateMsg = r.bumpedName ? `${r.bumpedName} was bumped down to the ${vacatedLabel} spot.` : `The ${vacatedLabel} spot is now open for a fresh challenger.`;
                flash(`\uD83D\uDC51 You took ${beatName}\u2019s spot in the Elite 4! (${vacateMsg})`);
                showThrones();
              } else if (r.ok) { flash(`\uD83D\uDC51 You took ${beatName}\u2019s spot in the Elite 4!`); showThrones(); }
              else flash(r.msg || 'Could not claim the spot.');
            } }, `\uD83D\uDC51 Claim ${beatName}\u2019s spot in the Elite 4`));
          }
          after.append(
            el('button', { class: 'btn-secondary', onClick: shareThrone(opts, pct, beat) }, '\uD83D\uDCE4 Share'),
            el('button', { class: 'btn-secondary', onClick: showThrones }, '\u2190 Elite 4'));
        } else if (opts.mode === 'daily') {
          after.append(el('button', { class: 'btn-secondary', onClick: showDailyResults }, '\u2190 Results'));
        }
      }
      controls.append(after);
    }

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '4px', fontSize: '13px' } },
            opts.mode === 'throne' ? `\u2694\uFE0F ${opts.tier.challengeLabel}` : '\u2694\uFE0F Battle'),
          stage, verdict,
          el('div', { class: 'battle-log' }, logBox),
          controls)));
    paint();
  }

  function shareThrone(opts, pct, beat) {
    return async () => {
      // Who did you beat? The Elite-4 member if it was still NPC-held; otherwise
      // the player you dethroned (and their Pokémon).
      const beatName = opts.npc ? opts.champLabel
        : `${opts.champLabel}\u2019s ${opts.champMon || 'champion'}`;
      const text = buildSummaryText({
        kind: 'throne', tierLabel: opts.tier.challengeLabel, claimed: beat, beatName,
        monName: lastResult ? lastResult.name : undefined, winPct: pct,
      });
      const ok = await copyToClipboard(text);
      showShareSheet(text, ok);
    };
  }

  function showShareSheet(text, copied) {
    if (toast) toast.remove();
    toast = el('div', { class: 'draft-toast', style: { maxWidth: '420px' } },
      el('div', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', marginBottom: '8px' } }, text),
      el('div', { class: 'draft-toast-btns' },
        el('button', { class: 'btn-primary', style: { padding: '6px 12px', fontSize: '12px' },
          onClick: () => shareWhatsApp(text) }, 'WhatsApp'),
        el('button', { class: 'btn-secondary', style: { padding: '6px 12px', fontSize: '12px' },
          onClick: async () => { const ok = await copyToClipboard(text); flash(ok ? 'Copied!' : 'Copy failed'); } },
          copied ? '\u2713 Copied' : 'Copy'),
        el('button', { class: 'btn-secondary', style: { padding: '6px 12px', fontSize: '12px' },
          onClick: () => { toast.remove(); toast = null; } }, 'Close')));
    root.append(toast);
  }

  // ===== DAILY: submit + results ===========================================
  async function submitDaily() {
    if (!lastResult) return;
    clear(root).append(spinner('Submitting your entry\u2026'));
    try { if (!identity) identity = await lazyIdentity(); if (!firebase) firebase = await lazyFirebase(); } catch { /* offline */ }
    if (identity && firebase) {
      const name = (identity.name || 'Anonymous').slice(0, 16);
      const path = `/draft/daily/${ctx.dateStr}/entries/${identity.uid}`;
      try {
        const already = await firebase.get(path);          // one attempt per identity (rule is immutable)
        if (!already) {
          await firebase.set(path, { name, mon: storedFromResult(lastResult), at: Date.now() });
          const check = await firebase.get(path);          // verify it actually persisted
          if (!check) flash('Heads up: your entry may not have saved. Try Refresh on the results screen.');
        }
      } catch (e) {
        flash('Could not save your entry: ' + ((e && e.message) || e));
      }
    }
    showDailyResults();
  }

  // #9 — Central-Time "yesterday", reusing the same DST-aware date math as today's.
  function yesterdayDateStr() {
    return centralDateStr(new Date(Date.now() - 86400000));
  }

  async function showDailyResults(dateStrOverride) {
    stopPlay();
    const dateStr = dateStrOverride || ctx.dateStr;
    const isHistorical = dateStr !== ctx.dateStr;
    clear(root).append(spinner(isHistorical ? 'Loading yesterday\u2019s results\u2026' : 'Tallying today\u2019s battles\u2026'));
    let entries = {};
    try {
      if (!identity) identity = await lazyIdentity();
      if (!firebase) firebase = await lazyFirebase();
      entries = (await firebase.get(`/draft/daily/${dateStr}/entries`)) || {};
    } catch { entries = {}; }

    const myUid = identity && identity.uid;
    const list = Object.keys(entries)
      .map((uid) => ({ uid, name: entries[uid].name || 'Anonymous', mon: entries[uid].mon }))
      .filter((e) => e.mon && e.mon.baseStats);

    // The "unsaved local build" fallback only makes sense for TODAY — a past
    // day's entries are either saved or simply weren't played, never "pending".
    let provisional = false;
    if (!isHistorical && lastResult && !(myUid && list.some((e) => e.uid === myUid))) {
      list.push({ uid: myUid || '__me__', name: (identity && identity.name) || 'You', mon: storedFromResult(lastResult), _me: true });
      provisional = !(myUid && firebase);
    }

    // The Daily Rival — a deterministic house entry so even the first player has
    // something to measure against (and to battle). Same for everyone, all day.
    if (!list.some((e) => e.uid === '__rival__')) {
      const rival = autoDraft({ species: ctx.species, gen: 2, seed: seedFromString(`dailyrival:${dateStr}`), playerName: 'Daily Rival' });
      list.push({ uid: '__rival__', name: 'Daily Rival', mon: storedFromResult(rival), _rival: true });
    }

    setTimeout(() => {
      const specs = list.map((e) => specFromStored(e.mon));
      const n = list.length;
      const sum = new Array(n).fill(0), games = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const m = runMatch(specs[i], specs[j], { gen: 2, moves: ctx.movestats, chart: ctx.chart, n: BATTLE_N, seed: seedFromString(`${dateStr}:${i}:${j}`) });
          sum[i] += m.challengerWins / m.n; games[i]++;
          sum[j] += m.championWins / m.n;  games[j]++;
        }
      }
      const ranked = list
        .map((e, i) => ({ ...e, avg: games[i] ? sum[i] / games[i] : 0, spec: specs[i] }))
        .sort((a, b) => b.avg - a.avg);
      renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical);
    }, 30);
  }

  function renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical) {
    const myIndex = ranked.findIndex((e) => (myUid && e.uid === myUid) || e._me);
    const me = myIndex >= 0 ? ranked[myIndex] : null;
    const hasOpponents = ranked.length >= 2;

    const shareText = me ? buildSummaryText({
      kind: 'daily', dateStr, monName: me.mon.name,
      rank: hasOpponents ? myIndex + 1 : undefined,
      total: hasOpponents ? ranked.length : undefined,
      winPct: hasOpponents ? me.avg : undefined,
    }) : '';

    const rows = ranked.length
      ? ranked.map((e, i) => {
          const mine = i === myIndex;
          return el('tr', { class: mine ? 'lb-me' : '' },
            el('td', {}, (['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][i]) || String(i + 1)),
            el('td', { style: { fontWeight: mine ? 800 : 400, color: mine ? 'var(--accent-gold)' : '' } }, e.name + (e._me && provisional ? ' (you, unsaved)' : '')),
            el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, e.mon.name),
            el('td', { style: { fontWeight: 700 } }, hasOpponents ? `${(e.avg * 100).toFixed(0)}%` : '\u2014'));
        })
      : [el('tr', {}, el('td', { colspan: '4', style: { textAlign: 'center', color: 'var(--text-dim)' } }, isHistorical ? 'No one played that day.' : 'No entries yet today.'))];

    const myLine = me
      ? (hasOpponents
          ? `You ranked #${myIndex + 1} of ${ranked.length} \u2014 ${(me.avg * 100).toFixed(1)}% average win rate.`
          : 'You\u2019re the first to play today! Win rates appear once others enter \u2014 check back with Refresh.')
      : (isHistorical ? 'You didn\u2019t play that day.' : null);

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center' } }, isHistorical ? '\uD83D\uDCC5 Yesterday\u2019s Results' : '\uD83C\uDFAE Daily Results'),
          el('div', { class: 'battle-vs', style: { marginBottom: '8px' } }, dateStr + ' \u00b7 Central Time'),
          provisional ? el('div', { class: 'battle-offline' }, '\u26A0\uFE0F Couldn\u2019t save your entry (offline). Ranking shown locally.') : null,
          myLine ? el('div', { class: 'daily-myline' }, myLine) : null,
          el('div', { class: 'lb-board' },
            el('table', { class: 'lb-table' },
              el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', {}, 'Build'), el('th', {}, 'Win%'))),
              el('tbody', {}, ...rows))),
          el('div', { class: 'summary-actions' },
            me ? el('button', { class: 'btn-primary', onClick: async () => { const ok = await copyToClipboard(shareText); showShareSheet(shareText, ok); } }, '\uD83D\uDCE4 Share') : null,
            el('button', { class: 'btn-secondary', onClick: () => showDailyResults(dateStr) }, '\u21BB Refresh'),
            isHistorical
              ? el('button', { class: 'btn-secondary', onClick: () => showDailyResults(ctx.dateStr) }, '\u2192 Today\u2019s Results')
              : el('button', { class: 'btn-secondary', onClick: () => showDailyResults(yesterdayDateStr()) }, '\uD83D\uDCC5 See Yesterday\u2019s Results'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  return { destroy() { stopPlay(); if (toast) { toast.remove(); toast = null; } clear(mount); } };
}

export default createDraftBattle;
