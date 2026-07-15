/**
 * @file        js/modes/draftbattle.js
 * @version     1.15.9
 * @updated     2026-07-14
 * @changelog
 *   1.15.9 — Elite-4 Gauntlet Results page now has a "Draft Again" button
 *            (between "Elite 4 Status" and "Main Menu"), starting a fresh
 *            free-play draft with the same random seed + 3/3 rerolls as the
 *            normal entry — so the results screen offers all four actions:
 *            My Build, Elite 4 Status, Draft Again, Main Menu. (The renderer
 *            also already narrates the sim 2.12.0 "use" events for status/
 *            weather/self-buff moves via the existing 'use' case, so no new
 *            event handling was needed for that fix.)
 *   1.15.8 — Simplified-moves (sim.js 2.11.0): narrates Substitute — 'sub'
 *            ("put up a substitute!"), 'sub-damage' ("the substitute took the
 *            hit"), 'sub-break' ("substitute broke!"). Note the sim still logs
 *            the computed 'damage' event before routing to the sub; the
 *            'sub-damage'/'sub-break' line clarifies where it actually landed.
 *   1.15.7 — Simplified-moves batch (sim.js 2.10.0): narrates Mist
 *            ('mist'/'mist-block'/'mist-end') and Weather ('weather-start'/
 *            'weather-end' with rain/sun/sand copy), plus 'sandstorm' added to
 *            STATUS_LABELS so the per-turn chip line reads "hurt by the
 *            sandstorm". Same drop-through guard as prior batches.
 *   1.15.6 — Simplified-moves batch: narrates trapping moves (sim.js 2.9.0) —
 *            'trap' ("was trapped by Wrap!") + 'trap-end' ("broke free!"), and
 *            'trap' added to STATUS_LABELS so the per-turn chip line reads
 *            "hurt by the trap". Bone Rush/Low Kick/Return reuse existing
 *            multihit/flinch/damage lines — no new event types there.
 *   1.15.5 — Battle-log playback narrates the rampage moves (sim.js 2.8.0):
 *            'rampage-start' ("became enraged with Outrage!") and 'rampage-end'
 *            ("rampage ended — it became confused from fatigue!"). Without the
 *            latter, the self-confusion would appear to come from nowhere.
 *   1.15.4 — Battle-log playback narrates Snore's 'asleep-acts' event (sim.js
 *            2.7.0) — "used Snore while fast asleep!" — so a Snore turn shows
 *            up instead of looking like a skipped/asleep turn.
 *   1.15.3 — Battle-log playback narrates the Tier-2 batch from sim.js 2.6.0:
 *            Nightmare (start/chip/end — added 'nightmare' to STATUS_LABELS so
 *            the chip line reads "hurt by a nightmare"), Safeguard (raise/
 *            block/expiry), Lock-On (aim + can't-miss), and the Fury Cutter/
 *            Rollout 'ramp' power-building line. Same recurring bug class as
 *            1.15.2/1.15.1: new sim event types must get real lines or they
 *            hit default:continue and silently vanish from the log.
 *   1.15.2 — Battle-log playback now narrates the Tier-1 batch from sim.js
 *            2.5.0: Endure ("braced itself" / "endured the hit" — also
 *            corrects the renderer's own shadow HP to exactly 1, since the
 *            preceding 'damage' event still logs the full would-be-lethal
 *            amount), Protect/Detect ("protected itself" / blocked-move
 *            line), and Haze ("All stat changes were removed!"). Same
 *            recurring bug class as 1.15.1/1.7.0: these were complete no-ops
 *            before, so there was nothing to drop; now that they do
 *            something, they need real lines or they hit default:continue.
 *   1.15.1 — Battle-log playback now narrates Reflect / Light Screen (and
 *            their expiry), matching sim.js 2.3.0 adding those moves. Without
 *            this the renderer's default:continue would silently drop them, so
 *            a screen would halve damage correctly but show nothing on screen.
 *            Also added accuracy/evasion to STAT_LABELS so sim.js 2.4.0's
 *            accuracy/evasion stage changes narrate ("accuracy fell", etc.).
 *   1.15.0 — Three requested changes:
 *             \u2022 Narrowed the Elite-4 stat bands: Will 425-450 (unchanged),
 *               Koga 455-480 (was 475-500), Bruno 485-510 (was 525-550),
 *               Lance 515-540 (was 575-600) \u2014 the inter-tier gap dropped
 *               from 50 to 30 BST (~40% narrower total Will-to-Lance span:
 *               175 \u2192 115). Verified via a 24-build sample: the "beat Will,
 *               lose to Koga" cliff dropped from 42% to 12.5% of outcomes,
 *               and full sweeps roughly doubled (~8% \u2192 ~17%) \u2014 stats still
 *               matter but no longer dominate as hard as the type-matchup
 *               lottery, matching what was asked for. See CHANGE_TRACKER for
 *               the full analysis this decision was based on.
 *             \u2022 Throne History screen: each entry now has an \uD83D\uDD0D Inspect
 *               button (matching the Daily Draft's pattern) showing that
 *               historical champion's types/stats/moves read-only. Added
 *               `moves` to the thronehistory push payload (previously
 *               missing entirely) so Inspect has something to show for new
 *               entries going forward.
 *   1.14.0 — Two fixes from a bug report:
 *             \u2022 Fixed #14a's cascade: it compared `holderUid` (same
 *               PLAYER), not mon identity, so a player who already held a
 *               higher throne with one mon was incorrectly blocked from
 *               claiming a DIFFERENT, lower throne with a genuinely
 *               different mon ("you already own the highest spot" — but the
 *               intended rule, confirmed with the reporter, is "a single
 *               POKEMON can only hold one spot, but a player can hold as many
 *               as they want"). Now compares the mon's own name + exact base
 *               stats (effectively unique per draft) instead of who's
 *               playing. Verified two ways: the exact reported scenario now
 *               succeeds, and the cascade still correctly triggers when it's
 *               genuinely the same mon.
 *             \u2022 Sharing UX: shareDraftedMon() and shareGauntletResult() both
 *               tried shareMonCardImage() (Web Share API with a canvas-
 *               rendered PNG) first. On any browser without full file-share
 *               support this silently downloaded that PNG as a side effect
 *               — an unexplained file appearing — and on mobile handed off
 *               to the OS's native image-share sheet instead of this app's
 *               own consistent WhatsApp/Copy/Close toast (used for
 *               everything else: daily results, room invites). Both are now
 *               text-only, using the same shareSheetEl (dom.js) pattern as
 *               online.js/race.js's room sharing — draftbattle.js's own
 *               local showShareSheet() was itself the original it was
 *               extracted from, but still had its own duplicate; now calls
 *               the shared one instead. shareMonCardImage/buildMonCardPlan/
 *               drawMonCardToCanvas remain in share.js, still exported and
 *               tested, just no longer called from here — available again
 *               if an explicit, separate "save as image" feature is ever
 *               wanted.
 *   1.13.1 — Fixed: startDraft() never passed `playerName` to DraftSession at
 *           all, so every drafted mon's name defaulted to the literal string
 *           "Player" ("Player's Feraligatr") regardless of who was actually
 *           playing — affected free-play, the daily, gauntlet share text,
 *           and the daily results table alike, since they all read the same
 *           `result.name`. Now resolved identity IN PARALLEL with the
 *           existing data fetches (movelist/movestats/draftpool/typechart),
 *           so the correct name is available from the very first card with
 *           no added latency (bounded by whichever fetch is slowest, and
 *           identity resolution is typically much faster than four JSON
 *           fetches) — deliberately NOT a background correction after the
 *           fact, which would race a fast draft completion (confirmed this
 *           the hard way: an earlier version of this fix used exactly that
 *           approach and a test completing the draft via a tight scripted
 *           loop reached "Draft Complete" before the identity promise
 *           resolved, still showing "Player's").
 *   1.13.0 — Daily Draft: individual head-to-head matchups, on-demand battle
 *           replay, and a read-only "inspect" view, plus the Daily Rival ->
 *           Cal rename.
 *             \u2022 showDailyResults() now RETAINS each pair's full runMatch()
 *               result (win counts AND a sample battle log) instead of
 *               discarding everything but the aggregate average win% \u2014 the
 *               data needed for individual matchups + replay was already
 *               being computed here, just thrown away afterward.
 *             \u2022 New \uD83D\uDCCA "Matchups" button (any row, including Cal's \u2014 "no
 *               self-battling" falls out naturally since the all-pairs
 *               computation never pairs a player against themselves) opens
 *               renderDailyMatchups(): every OTHER entrant, this player's
 *               specific win/loss + win% against each, with a \u25B6 Watch button
 *               that replays the ALREADY-COMPUTED sample log via the existing
 *               renderBattle() UI \u2014 zero re-simulation.
 *             \u2022 Found and fixed while building this: renderBattle()'s "You
 *               win!"/"You fell short" verdict was hardcoded to the "a"
 *               (challenger) side, which is fine for the gauntlet (the
 *               player's own mon is ALWAYS "a" there) but wrong for daily
 *               matchups, where a<b is determined by original computation
 *               order, not by who's watching \u2014 viewing a matchup from the
 *               side that happened to be "b" would show the WRONG verdict.
 *               Added an explicit `viewingSide` option (defaults to 'a', so
 *               every existing caller is completely unaffected) and pass the
 *               correct side from renderDailyMatchups.
 *             \u2022 New \uD83D\uDD0D "Inspect" button (any row) opens renderMonInspect(): a
 *               read-only view of that entrant's drafted types/stats/moves \u2014
 *               the same core visual as the Draft Complete screen, but
 *               without its draft-in-progress action buttons (Submit/
 *               Challenge/Share), since this is for inspecting someone
 *               ELSE's build.
 *             \u2022 "Daily Rival" renamed to "Cal" (display text + the
 *               `playerName` passed to autoDraft only \u2014 the underlying seed
 *               key and internal uid are deliberately unchanged, so nobody's
 *               daily results shift because of a display rename).
 *   1.12.1 — #1: daily results' Share button now passes playerName (with a
 *           stable Player_NNNNN fallback) and a dailyChallengeLink() deep
 *           link into buildSummaryText, matching the exact spec'd format.
 *   1.12.0 — #14/#15: replaced the old "challenge one throne at a time, claim,
 *           share, repeat" flow with a single Elite-4 GAUNTLET. "Challenge the
 *           Elite 4" (from Draft Complete or the status grid) now auto-battles
 *           Will→Koga→Bruno→Lance→All-Time in strict order — ALWAYS starting
 *           fresh at Will, so a new build can dethrone even the player's own
 *           earlier champions — stopping at the first loss or after clearing
 *           All-Time. One results screen (a row per matchup with an on-demand
 *           "▶ Watch" replay reusing the existing battle-log playback UI, plus
 *           a placement message), one Claim (of the highest spot reached —
 *           still goes through the existing #14a cascade/#12 write-
 *           verification unchanged), one Share. The status grid (throneCard/
 *           renderThrones) is now pure status display (holder + History) with
 *           a single gauntlet-entry button — no more per-tier unlock gating,
 *           since the gauntlet no longer needs one (see below); the #12/#13
 *           persisted progress rank is repurposed as a non-gating "🏅 Your
 *           best" badge. startBattle() (only ever used by the old per-tier
 *           flow) was removed as dead code.
 *           #14: added a "📤 Share My Pokémon" button to Draft Complete —
 *           renders a canvas card (name/types/stats/moves, via lib/share.js's
 *           new drawMonCardToCanvas) and shares it (Web Share API with an
 *           image file where supported, falling back to a PNG download +
 *           copied caption). The gauntlet's consolidated Share reuses the same
 *           card image alongside the new "took the Nth spot" placement text.
 *   1.11.0 — #10: "View Results" (daily-gate) and "← Results" (post-battle)
 *           buttons passed their bare onClick handler directly, so the click
 *           MouseEvent was received as showDailyResults's dateStrOverride
 *           argument — treated as a truthy historical date, which is why
 *           re-opening results showed YESTERDAY's instead of today's. Both
 *           now wrap the call so no argument is passed.
 *           #12/#13: the Elite-4 unlock gate was based on "do you currently,
 *           physically hold the previous tier's throne" — but the #14a
 *           one-throne cascade AND every tier's own cadence reset both
 *           legitimately vacate a throne the player already beat, silently
 *           relocking everything above it. Unlock is now gated on a separate,
 *           monotonic "highest tier ever reached" value persisted at
 *           /draft/progress/{uid} (see draft.js's isTierUnlocked/
 *           nextProgressRank) that a later vacate can't erase. claimThrone()
 *           also now VERIFIES both the throne write and the progress write
 *           with a follow-up read (mirroring submitDaily's existing pattern)
 *           instead of reporting success on an unconfirmed write — directly
 *           addresses "doesn't correctly let you claim the spot."
 *           Also: added params._getFirebase/_getIdentity test-injection hooks
 *           (the same seam race.js/online.js already use) so throne/daily
 *           logic can be exercised against a real fake Firebase in tests
 *           instead of only the "offline" no-op path.
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

import { el, clear, statSpreadEl, shareSheetEl } from '../lib/dom.js';
import {
  DraftSession, autoDraft, autoDraftScaled, resolveThroneCascade, TIER_RANK, nextProgressRank,
  buildSpeciesList, buildLearnsetMap, runMatch, toRealStats,
} from '../lib/draft-adapter.js';
import {
  centralDateStr, centralPeriodKey, seedFromDate, seedFromString, buildSummaryText,
  copyToClipboard, shareWhatsApp, draftBattleLink, dailyChallengeLink, stablePlayerFallbackName,
} from '../lib/share.js';

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spc: 'Spc', spa: 'SpA', spd: 'SpD', spe: 'Spe', acc: 'accuracy', eva: 'evasiveness' };
const STATUS_LABELS = { par: 'paralyzed', brn: 'burned', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen', leechseed: 'Leech Seed', curse: 'the curse', nightmare: 'a nightmare', trap: 'the trap', sandstorm: 'the sandstorm' };
const TIERS = [
  { key: 'day',   cadence: 'Day',      npc: 'Will',     icon: '\u2460', stage: 1, statBand: [425, 450] }, // ①
  { key: 'week',  cadence: 'Week',     npc: 'Koga',     icon: '\u2461', stage: 2, statBand: [455, 480] }, // ②
  { key: 'month', cadence: 'Month',    npc: 'Bruno',    icon: '\u2462', stage: 3, statBand: [485, 510] }, // ③
  { key: 'year',  cadence: 'Year',     npc: 'Lance',    icon: '\u2463', stage: 4, statBand: [515, 540] }, // ④
  { key: 'all',   cadence: 'All Time', npc: 'Champion', icon: '\uD83D\uDC51', stage: null, statBand: null }, // 👑 — no band defined; NPC fallback stays a natural, unscaled auto-draft
].map((t) => ({
  ...t,
  // card on the Elite-4 grid: "1 – Will" … "4 – Lance", "All Time – Champion"
  cardLabel: t.stage ? `${t.stage} \u2013 ${t.npc}` : 'All Time \u2013 Champion',
  // battle / history screen: "Elite 4 – Stage 1" … or "Greatest Pokémon of All Time"
  challengeLabel: t.stage ? `Elite 4 \u2013 Stage ${t.stage}` : 'Greatest Pok\u00e9mon of All Time',
  label: `${t.cadence} \u2013 ${t.npc}`,   // legacy fallback
}));
const TIER_KEYS_IN_ORDER = TIERS.map((t) => t.key);  // #12/#13 — used to map a progress rank back to a tier for the "personal best" badge
const BATTLE_N = 501;          // SPEC-locked sample count

export function createDraftBattle({ mount, config, data, params = {}, onExit }) {
  const root = el('div', { class: 'draft-root' });
  clear(mount).appendChild(root);
  root.append(el('div', { class: 'draft-loading' }, 'Loading draft data\u2026'));

  const variant = params.variant || 'freeplay';
  const isDaily = variant === 'daily';

  // Testable: params._getFirebase / params._getIdentity inject fakes (same seam
  // race.js and online.js already use) — falls back to the real lazy CDN import
  // in production. This lets throne/daily logic (#10/#12/#13) be exercised
  // against a real fake Firebase instead of only the "offline" no-op path.
  const lazyFirebase = params._getFirebase || (() => import('../lib/firebase.js').then((m) => m.getFirebase()));
  const lazyIdentity = params._getIdentity || (() => import('../lib/identity.js').then((m) => m.getIdentity()));

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
    // #1 (bug fix): resolved HERE, in parallel with the data fetches above,
    // rather than only lazily on-demand later — so free-play's playerName is
    // correct from the very first card, at no added latency (bounded by
    // whichever fetch is slowest, and identity resolution is typically much
    // faster than four JSON fetches). Previously startDraft() never resolved
    // identity at all, so a freshly-drafted mon's name always defaulted to
    // the literal string "Player" regardless of who was actually playing.
    !identity ? lazyIdentity().then((id) => { identity = id; }).catch(() => null) : Promise.resolve(),
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
    // #1 (bug): playerName was never passed here at all, so every drafted
    // mon's name defaulted to the literal string "Player" ("Player's
    // Feraligatr") regardless of who was actually playing. identity is now
    // resolved above, in parallel with the data fetches, before this ever
    // runs (for BOTH free-play and the daily flow, which already resolved it
    // even earlier) — so this is never racing a background correction
    // against how fast someone drafts.
    const session = new DraftSession({ species: ctx.species, gen: 2, seed, rerolls, playerName: (identity && identity.name) || 'Player' });
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
            el('button', { class: 'btn-primary', onClick: () => showDailyResults() }, 'View Results'),
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
      : [el('button', { class: 'btn-primary', onClick: runGauntlet }, '\u2694\uFE0F Challenge the Elite 4'),
         // #14 — share a card image of this exact build (name → types → stats → moves).
         el('button', { class: 'btn-secondary', onClick: () => shareDraftedMon(result) }, '\uD83D\uDCE4 Share My Pok\u00e9mon'),
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

  // #14 — share a card image (canvas-rendered: name/types/stats/moves) of the
  // player's current build, via the Web Share API where available, falling
  // back to a PNG download + a copied caption.
  async function shareDraftedMon(result) {
    // Previously tried shareMonCardImage() first (Web Share API with a
    // canvas-rendered PNG), which on any browser without full file-share
    // support fell back to silently DOWNLOADING that PNG as a side effect --
    // an unexpected file appearing with no clear reason -- and on mobile
    // handed off to the OS's native image-share sheet instead of this app's
    // own consistent WhatsApp/Copy/Close toast (used for everything else:
    // daily results, room invites, the gauntlet's own consolidated share).
    // Text-only now, matching that same pattern everywhere, with enough
    // detail (types + moves) to stand on its own without the image.
    const typesLine = (result.types || []).filter(Boolean).join(' / ') || '\u2014';
    const text = [
      'Check out my drafted Pok\u00e9mon!',
      `${result.name} (${typesLine})`,
      (result.moves || []).join(', '),
      draftBattleLink(),
    ].filter(Boolean).join('\n');
    const ok = await copyToClipboard(text);
    showShareSheet(text, ok);
  }

  // ===== THRONE (free-play) =================================================
  async function showThrones() {
    stopPlay();
    clear(root).append(spinner('Summoning the champions\u2026'));
    let raw = null, connected = true, myProgressRank = 0;
    try {
      if (!firebase) firebase = await lazyFirebase();
      if (!identity) identity = await lazyIdentity();
      raw = await firebase.get('/draft/throne');   // null simply means "no one has claimed yet"
      // #12/#13 — a player's UNLOCK progress is tracked separately from who
      // currently, physically holds each throne (see isTierUnlocked's doc
      // comment in draft.js for why: vacate-by-cascade and vacate-by-reset
      // both erase "current holder" without erasing what the player earned).
      const p = await firebase.get(`/draft/progress/${identity.uid}`);
      myProgressRank = typeof p === 'number' ? p : 0;
    } catch { connected = false; raw = null; }
    const thrones = TIERS.map((tier) => resolveThrone(tier, raw && raw[tier.key]));
    renderThrones(thrones, !connected || !firebase, myProgressRank);
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

  function renderThrones(thrones, offline, myProgressRank = 0) {
    const haveBuild = !!lastResult;
    const bestTier = myProgressRank > 0 ? TIERS[Math.max(0, TIER_KEYS_IN_ORDER.findIndex((k) => TIER_RANK[k] === myProgressRank))] : null;
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '6px' } }, '\u2694\uFE0F The Elite 4'),
          el('p', { class: 'sf-intro', style: { textAlign: 'center' } },
            '\u201CChallenge the Elite 4\u201D battles Will, Koga, Bruno, Lance, and the All-Time Champion in order, '
            + 'stopping at your first loss \u2014 every run starts fresh at Will, so a new Pok\u00e9mon can dethrone even your own past champions. '
            + 'Each spot empties to a fresh champion at its own reset \u2014 Day at midnight Central, Week end of Sunday, Month on the 1st, Year on Jan 1; All-Time never resets.'),
          offline ? el('div', { class: 'battle-offline' }, '\u26A0\uFE0F Offline \u2014 showing practice champions; claims won\u2019t be saved.') : null,
          bestTier ? el('div', { class: 'sf-intro', style: { textAlign: 'center' } }, `\uD83C\uDFC5 Your best: ${bestTier.cardLabel}`) : null,
          !haveBuild ? el('div', { class: 'sf-intro', style: { textAlign: 'center', color: 'var(--text-dim)' } }, 'Draft a team first to challenge them.') : null,
          haveBuild ? el('div', { class: 'summary-actions', style: { marginBottom: '10px' } },
            el('button', { class: 'btn-primary', onClick: runGauntlet }, '\u2694\uFE0F Challenge the Elite 4')) : null,
          el('div', { class: 'draft-throne-grid' },
            ...thrones.map((t) => throneCard(t))),
          el('div', { class: 'summary-actions' },
            haveBuild ? el('button', { class: 'btn-secondary', onClick: () => renderBuild(lastResult) }, '\u2190 My Build') : null,
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main Menu')))));
  }

  function throneCard(t) {
    const monName = t.mon.species || t.mon.name;
    return el('div', { class: 'throne-card' },
      el('div', { class: 'throne-tier' }, `${t.tier.icon} ${t.tier.cardLabel}`),
      el('div', { class: 'throne-holder' }, (t.npc ? '' : '\uD83D\uDC51 ') + t.holderName),
      el('div', { class: 'throne-mon' }, ...(t.mon.types || []).map((ty) => el('span', { class: `type-pill type-${ty.toLowerCase()}`, style: { fontSize: '9px', marginRight: '3px' } }, ty))),
      el('div', { class: 'throne-mon', style: { color: 'var(--text-dim)' } }, monName),
      el('div', { class: 'throne-card-btns' },
        el('button', { class: 'btn-secondary', style: { padding: '7px 10px', fontSize: '11px' },
          onClick: () => showThroneHistory(t.tier) }, 'History')));
  }

  // ===== ELITE 4 GAUNTLET (#15) ==============================================
  // Replaces the old "challenge one throne, claim, share, repeat" loop: the
  // player's CURRENT build auto-battles Will → Koga → Bruno → Lance →
  // All-Time in strict order, ALWAYS starting fresh at Will (so a new
  // Pokémon can dethrone even the player's own earlier champions), stopping
  // at the first loss or after clearing All-Time. One results screen, one
  // claim (of the highest spot reached), one share.
  const ORDINALS = ['1st', '2nd', '3rd', '4th', 'Champion'];

  async function runGauntlet() {
    if (!lastResult) { flash('Draft a team first.'); return; }
    stopPlay();
    clear(root).append(spinner('Challenging the Elite 4\u2026'));
    let raw = null;
    try {
      if (!firebase) firebase = await lazyFirebase();
      if (!identity) identity = await lazyIdentity();
      raw = await firebase.get('/draft/throne');
    } catch { raw = null; }
    const thrones = TIERS.map((tier) => resolveThrone(tier, raw && raw[tier.key]));
    const challengerSpec = specFromResult(lastResult);
    // defer so the spinner paints before the (synchronous) sim burst
    setTimeout(() => {
      const rows = [];
      let highestIndex = -1;
      for (let i = 0; i < TIERS.length; i++) {
        const t = thrones[i];
        const champSpec = specFromStored(t.mon);
        // Same seed formula a direct one-off challenge would have used, so the
        // outcome of "my mon vs this tier's current champion" is consistent
        // regardless of how the player got to that matchup.
        const seed = seedFromString(`${challengerSpec.name}|${champSpec.name}|${t.tier.key}`);
        const res = runMatch(challengerSpec, champSpec, { gen: 2, moves: ctx.movestats, chart: ctx.chart, n: BATTLE_N, seed });
        const pb = buildPlayback(res.sampleLog, challengerSpec, champSpec);
        const beat = res.challengerBeatsChampion;
        rows.push({ throne: t, champSpec, res, pb, beat });
        if (beat) highestIndex = i; else break;
      }
      renderGauntletResults(rows, highestIndex, challengerSpec);
    }, 30);
  }

  function renderGauntletResults(rows, highestIndex, challengerSpec) {
    stopPlay();
    const reachedAny = highestIndex >= 0;
    const placementLabel = reachedAny ? ORDINALS[highestIndex] : null;

    const rowEls = rows.map((row) => {
      const pct = (row.res.challengerWinPct * 100).toFixed(1);
      const oppLabel = row.throne.npc ? row.throne.holderName : `${row.throne.holderName}\u2019s ${row.throne.mon.species || row.throne.mon.name}`;
      return el('tr', {},
        el('td', {}, `${row.throne.tier.icon} ${row.throne.tier.cardLabel}`),
        el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, oppLabel),
        el('td', { style: { fontWeight: 700, color: row.beat ? '#29cc66' : '#e06060' } }, row.beat ? `\u2705 Won (${pct}%)` : `\u274C Lost (${pct}%)`),
        el('td', {}, el('button', { class: 'btn-secondary', style: { padding: '5px 10px', fontSize: '11px' },
          onClick: () => renderGauntletRow(row, challengerSpec, () => renderGauntletResults(rows, highestIndex, challengerSpec)) }, '\u25B6 Watch')));
    });

    const summaryMsg = reachedAny
      ? `\uD83C\uDFC6 You took the ${placementLabel} spot on the Elite 4!`
      : `You fell to ${rows[0].throne.tier.npc}.`;

    async function doClaim() {
      const row = rows[highestIndex];
      const r = await claimThrone(row.throne.tier, {
        defeatedUid: row.throne.holderUid, defeatedMon: row.throne.mon, champLabel: row.throne.holderName,
      });
      if (r.ok && r.keptHigherTier) {
        const keptLabel = TIERS.find((t) => t.key === r.keptHigherTier)?.cardLabel || r.keptHigherTier;
        flash(`You already hold a higher Elite 4 spot (${keptLabel}) \u2014 great run, but that spot stays as-is.`);
      } else if (r.ok && r.vacatedTier) {
        const vacatedLabel = TIERS.find((t) => t.key === r.vacatedTier)?.cardLabel || r.vacatedTier;
        const vacateMsg = r.bumpedName ? `${r.bumpedName} was bumped down to the ${vacatedLabel} spot.` : `The ${vacatedLabel} spot is now open for a fresh challenger.`;
        flash(`\uD83D\uDC51 You took the ${placementLabel} spot! (${vacateMsg})`);
      } else if (r.ok) {
        flash(`\uD83D\uDC51 You took the ${placementLabel} spot!`);
      } else {
        flash(r.msg || 'Could not claim the spot.');
      }
    }

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '6px' } }, '\u2694\uFE0F Elite 4 Gauntlet Results'),
          el('div', { class: 'lb-board' },
            el('table', { class: 'lb-table' },
              el('thead', {}, el('tr', {}, el('th', {}, 'Tier'), el('th', {}, 'Opponent'), el('th', {}, 'Result'), el('th', {}, ''))),
              el('tbody', {}, ...rowEls))),
          el('div', { class: 'summary-score', style: { textAlign: 'center', margin: '10px 0' } }, summaryMsg),
          reachedAny ? el('div', { class: 'summary-actions', style: { marginBottom: '8px' } },
            el('button', { class: 'btn-primary', onClick: doClaim }, `\uD83D\uDC51 Claim the ${placementLabel} spot`)) : null,
          el('div', { class: 'summary-actions' },
            reachedAny ? el('button', { class: 'btn-secondary', onClick: shareGauntletResult(placementLabel) }, '\uD83D\uDCE4 Share') : null,
            el('button', { class: 'btn-secondary', onClick: () => renderBuild(lastResult) }, '\u2190 My Build'),
            el('button', { class: 'btn-secondary', onClick: showThrones }, 'Elite 4 Status'),
            el('button', { class: 'btn-secondary', onClick: () => startDraft(((Math.random() * 2 ** 31) | 0), { pokemon: 3, moves: 3 }) }, '\uD83D\uDD01 Draft Again'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, 'Main Menu')))));
  }

  function renderGauntletRow(row, challengerSpec, onBack) {
    renderBattle(challengerSpec, row.champSpec, row.res, row.pb, {
      mode: 'gauntletRow', title: `\u2694\uFE0F ${row.throne.tier.challengeLabel}`, onBack,
    });
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
          el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, monLabel(e.mon)),
          el('td', {},
            (e.mon && typeof e.mon === 'object' && e.mon.name)
              ? el('button', { class: 'btn-secondary', style: { padding: '4px 8px', fontSize: '13px', lineHeight: 1 }, title: `Inspect ${e.mon.name}`,
                  onClick: () => renderMonInspect(e.mon, { title: `${e.name || 'Player'}\u2019s Pok\u00e9mon`, onBack: () => showThroneHistory(tier) }) },
                  '\uD83D\uDD0D')
              : null)))
      : [el('tr', {}, el('td', { colspan: '4', style: { textAlign: 'center', color: 'var(--text-dim)' } }, 'No champions yet \u2014 be the first.'))];
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center' } }, `${tier.icon} ${tier.challengeLabel} \u2014 Champions`),
          el('div', { class: 'lb-board' },
            el('table', { class: 'lb-table' },
              el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Player'), el('th', {}, 'Pok\u00e9mon'), el('th', {}, ''))),
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
    // #12 — verify the throne write actually landed before reporting success to
    // the player (mirrors submitDaily's existing post-write verification). A
    // silent write failure previously still showed "You took the spot!" while
    // nothing was actually saved — which is exactly what "doesn't unlock Koga"
    // looks like from the outside.
    async function verifiedSetThrone() {
      await fb.set(`/draft/throne/${tier.key}`, rec);
      const check = await fb.get(`/draft/throne/${tier.key}`);
      return !!(check && check.holderUid === id.uid && check.period === rec.period);
    }
    // #12/#13 — persist the monotonic "highest tier ever reached" progress
    // value (see isTierUnlocked/nextProgressRank in draft.js) and verify it
    // the same way, so a partial failure here can't silently strand a player
    // with earned progress that doesn't actually unlock anything.
    async function verifiedSaveProgress() {
      let current = 0;
      try { const p = await fb.get(`/draft/progress/${id.uid}`); current = typeof p === 'number' ? p : 0; } catch { current = 0; }
      const next = nextProgressRank(current, tier.key, TIER_RANK);
      await fb.set(`/draft/progress/${id.uid}`, next);
      const check = await fb.get(`/draft/progress/${id.uid}`);
      return check === next;
    }
    try {
      // #14a — a single POKÉMON (not player) can only hold ONE Elite-4 spot
      // at a time. A player is free to hold as many thrones as they want,
      // as long as each is held by a DIFFERENT mon — the previous check
      // here compared `holderUid`, which meant simply being the same
      // PLAYER on two different thrones (with two entirely different,
      // independently-drafted mons) incorrectly triggered the "keep the
      // higher one" cascade, blocking a legitimate claim. Identity is
      // compared by the mon's own name + exact base stats (effectively
      // unique per draft — an independent draft coincidentally producing
      // the same species name AND all six random stats is astronomically
      // unlikely), not by who's playing.
      // The DECISION (who ends up where) is a pure function so it's fully
      // unit-testable; this just performs the resulting reads/writes.
      const sameMon = (a, b) => !!a && !!b && a.name === b.name && JSON.stringify(a.baseStats) === JSON.stringify(b.baseStats);
      let existingThrones = null;
      try { existingThrones = await fb.get('/draft/throne'); } catch { existingThrones = null; }
      const otherKey = existingThrones
        ? Object.keys(existingThrones).find((k) => k !== tier.key && existingThrones[k] && sameMon(existingThrones[k].mon, rec.mon))
        : null;

      if (otherKey) {
        const decision = resolveThroneCascade({
          newTierKey: tier.key, oldTierKey: otherKey, tierRank: TIER_RANK,
          defeatedUid: opts.defeatedUid, defeatedMon: opts.defeatedMon, champLabel: opts.champLabel,
        });
        if (decision.action === 'claimNewVacateOld') {
          if (!(await verifiedSetThrone())) return { ok: false, msg: 'Could not verify the throne was saved. Please try again.' };
          if (!(await verifiedSaveProgress())) return { ok: false, msg: 'Could not verify your progress was saved. Please try again.' };
          if (decision.bump) {
            await fb.set(`/draft/throne/${decision.vacatedTier}`, {
              mon: decision.bump.mon, holderUid: decision.bump.holderUid,
              holderName: decision.bump.holderName.slice(0, 16),
              takenAt: Date.now(), period: centralPeriodKey(decision.vacatedTier),
            });
          } else {
            await fb.set(`/draft/throne/${decision.vacatedTier}`, null);
          }
          try { await fb.push(`/draft/thronehistory/${tier.key}`, { name: rec.holderName, mon: { name: lastResult ? lastResult.name : (rec.mon && rec.mon.name) || '', types: (rec.mon && rec.mon.types) || [], baseStats: (rec.mon && rec.mon.baseStats) || [], moves: (rec.mon && rec.mon.moves) || [] }, at: rec.takenAt, period: rec.period }); } catch { /* history is best-effort */ }
          return { ok: true, vacatedTier: decision.vacatedTier, bumpedName: decision.bump ? decision.bump.holderName : null };
        }
        // keepOld — player already holds a HIGHER throne; this one reverts to vacant.
        await fb.set(`/draft/throne/${tier.key}`, null);
        return { ok: true, keptHigherTier: decision.keptTier };
      }

      if (!(await verifiedSetThrone())) return { ok: false, msg: 'Could not verify the throne was saved. Please try again.' };
      if (!(await verifiedSaveProgress())) return { ok: false, msg: 'Could not verify your progress was saved. Please try again.' };
      try { await fb.push(`/draft/thronehistory/${tier.key}`, { name: rec.holderName, mon: { name: lastResult ? lastResult.name : (rec.mon && rec.mon.name) || '', types: (rec.mon && rec.mon.types) || [], baseStats: (rec.mon && rec.mon.baseStats) || [], moves: (rec.mon && rec.mon.moves) || [] }, at: rec.takenAt, period: rec.period }); } catch { /* history is best-effort */ }
      return { ok: true };
    } catch (e) { return { ok: false, msg: 'Save failed: ' + (e.message || e) }; }
  }

  // ===== BATTLE =============================================================
  // (startBattle was removed here — the gauntlet computes each matchup
  // directly via runMatch/buildPlayback; see runGauntlet above. buildPlayback
  // and renderBattle below are still used, for the gauntlet's per-row "Watch"
  // on-demand replay.)

  function buildPlayback(sample, aSpec, bSpec) {
    const maxA = aSpec.stats.hp, maxB = bSpec.stats.hp;
    let hpA = maxA, hpB = maxB, turn = 0;
    const sideOf = (nm) => (nm === aSpec.name ? 'a' : nm === bSpec.name ? 'b' : null);
    const dmg = (nm, amt) => { const s = sideOf(nm); if (s === 'a') hpA = Math.max(0, hpA - amt); else if (s === 'b') hpB = Math.max(0, hpB - amt); };
    const heal = (nm, amt) => { const s = sideOf(nm); if (s === 'a') hpA = Math.min(maxA, hpA + amt); else if (s === 'b') hpB = Math.min(maxB, hpB + amt); };
    const setHp = (nm, val) => { const s = sideOf(nm); if (s === 'a') hpA = val; else if (s === 'b') hpB = val; };
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
        case 'reflect': line = `${e.target} raised Reflect \u2014 physical damage halved.`; break;
        case 'lightscreen': line = `${e.target} raised Light Screen \u2014 special damage halved.`; break;
        case 'reflect-end': line = `${e.target}\u2019s Reflect wore off.`; break;
        case 'lightscreen-end': line = `${e.target}\u2019s Light Screen wore off.`; break;
        case 'crash': dmg(e.target, e.amount); line = `${e.target} kept going and crashed! (${e.amount})`; break;
        case 'fail': line = 'But it failed!'; break;
        case 'boost': {
          const label = STAT_LABELS[e.stat] || e.stat;
          const mag = Math.abs(e.delta) >= 2 ? ' sharply' : '';
          line = `${e.target}\u2019s ${label}${mag} ${e.delta > 0 ? 'rose' : 'fell'}!`;
          break;
        }
        // Tier-1 batch (sim.js 2.5.0) — Endure/Protect/Detect/Haze were
        // previously complete no-ops with no log events at all, so there was
        // nothing for the renderer to drop; now that they do something, they
        // need their own lines or they'd hit default:continue same as before.
        case 'endure-ready': line = `${e.target} braced itself!`; break;
        case 'endure': setHp(e.target, 1); line = `${e.target} endured the hit!`; break;
        case 'protect-ready': line = `${e.target} protected itself!`; break;
        case 'protect-block': line = `${e.target}\u2019s Protect blocked ${e.source}\u2019s ${e.move}!`; break;
        case 'haze': line = 'All stat changes were removed!'; break;
        // Tier-2 batch (sim.js 2.6.0) — new event types; without these they'd
        // hit default:continue and vanish from the on-screen log.
        case 'nightmare': line = `${e.target} began having a nightmare!`; break;
        case 'nightmare-end': line = `${e.target}\u2019s nightmare ended.`; break;
        case 'safeguard': line = `${e.target} is protected by Safeguard!`; break;
        case 'safeguard-block': line = `${e.target} is protected by Safeguard!`; break;
        case 'safeguard-end': line = `${e.target}\u2019s Safeguard wore off.`; break;
        case 'lockon': line = `${e.source} took aim at ${e.target}!`; break;
        case 'lockon-hit': line = `${e.source} is locked on \u2014 this attack can\u2019t miss!`; break;
        case 'ramp': line = `${e.move} is building power! (${e.bp})`; break;
        case 'asleep-acts': line = `${e.target} used ${e.move} while fast asleep!`; break;
        case 'rampage-start': line = `${e.source} became enraged with ${e.move}!`; break;
        case 'rampage-end': line = `${e.target}\u2019s rampage ended \u2014 it became confused from fatigue!`; break;
        case 'trap': line = `${e.target} was trapped by ${e.move}!`; break;
        case 'trap-end': line = `${e.target} broke free!`; break;
        case 'mist': line = `${e.target} shrouded itself in mist!`; break;
        case 'mist-block': line = `${e.target} is protected by Mist \u2014 its stats can\u2019t be lowered!`; break;
        case 'mist-end': line = `${e.target}\u2019s Mist faded.`; break;
        case 'weather-start': line = { rain: 'It started to rain!', sun: 'The sunlight got bright!', sand: 'A sandstorm kicked up!' }[e.weather] || 'The weather changed!'; break;
        case 'weather-end': line = { rain: 'The rain stopped.', sun: 'The sunlight faded.', sand: 'The sandstorm subsided.' }[e.weather] || 'The weather cleared.'; break;
        case 'sub': line = `${e.target} put up a substitute!`; break;
        case 'sub-damage': line = `The substitute took the hit for ${e.target}!`; break;
        case 'sub-break': line = `${e.target}\u2019s substitute broke!`; break;
        default: continue;
      }
      if (line != null) frames.push({ hpA, hpB, turn, line });
    }
    return { frames, maxA, maxB };
  }

  function renderBattle(aSpec, bSpec, res, pb, opts) {
    stopPlay();
    let idx = 0;
    // Every existing caller (gauntlet, individual throne challenges) always
    // has the player's OWN mon as "a" (the challenger), so this defaults to
    // 'a' and is completely unaffected. The new daily-matchups "Watch" button
    // is the first caller where the player being viewed can legitimately be
    // EITHER side of the stored pairing (i<j determines a/b, not who's
    // watching) — passing viewingSide:'b' there is what makes "You win!"
    // correctly reflect the entry actually being viewed, not whichever side
    // happened to be "a" when the pair was originally computed.
    const viewingSide = opts.viewingSide === 'b' ? 'b' : 'a';
    const beat = viewingSide === 'a' ? res.challengerBeatsChampion : !res.challengerBeatsChampion;
    const pct = viewingSide === 'a' ? res.challengerWinPct : 1 - res.challengerWinPct;

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
        if (opts.mode === 'gauntletRow' || opts.mode === 'dailyRow') {
          // #15 — individual gauntlet matchups (and now daily matchups) are
          // viewed on demand from a results screen; claiming/sharing happens
          // ONCE there, not per-battle. dailyRow's onBack returns to the
          // matchups list it was opened from (not straight to daily results),
          // so "Back" doesn't lose the player's place.
          after.append(el('button', { class: 'btn-secondary', onClick: opts.onBack }, '\u2190 Back to Results'));
        } else if (opts.mode === 'daily') {
          after.append(el('button', { class: 'btn-secondary', onClick: () => showDailyResults() }, '\u2190 Results'));
        }
      }
      controls.append(after);
    }

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center', marginBottom: '4px', fontSize: '13px' } },
            opts.title || (opts.mode === 'gauntletRow' ? `\u2694\uFE0F ${opts.tier.challengeLabel}` : '\u2694\uFE0F Battle')),
          stage, verdict,
          el('div', { class: 'battle-log' }, logBox),
          controls)));
    paint();
  }

  // #15 — ONE share after a full gauntlet run (not per-victory): the placement
  // text PLUS the same drafted-mon card image from #14, in one action.
  function shareGauntletResult(placementLabel) {
    return async () => {
      const text = buildSummaryText({
        kind: 'gauntlet', placementLabel, monName: lastResult ? lastResult.name : undefined,
        link: draftBattleLink('thrones'),
      });
      const ok = await copyToClipboard(text);
      showShareSheet(text, ok);
    };
  }

  function showShareSheet(text, copied) {
    if (toast) toast.remove();
    toast = shareSheetEl(text, {
      copied,
      onWhatsApp: () => shareWhatsApp(text),
      onCopy: async () => { const ok = await copyToClipboard(text); showShareSheet(text, ok); },
      onClose: () => { if (toast) { toast.remove(); toast = null; } },
    });
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

    // Cal — a deterministic house entry so even the first player has
    // something to measure against (and to battle). Same for everyone, all day.
    // (Internal seed key/uid deliberately left as "dailyrival"/"__rival__" —
    // this is purely a display-name rename, not a change to which mon is
    // drafted, so nobody's daily results shift because of it.)
    if (!list.some((e) => e.uid === '__rival__')) {
      const rival = autoDraft({ species: ctx.species, gen: 2, seed: seedFromString(`dailyrival:${dateStr}`), playerName: 'Cal' });
      list.push({ uid: '__rival__', name: 'Cal', mon: storedFromResult(rival), _rival: true });
    }

    setTimeout(() => {
      const specs = list.map((e) => specFromStored(e.mon));
      const n = list.length;
      const sum = new Array(n).fill(0), games = new Array(n).fill(0);
      // Each pair's full runMatch() result (win counts AND a sample battle
      // log) was already being computed here to get the average win% —
      // just discarded afterward. Retained now, per player, oriented from
      // THAT player's own perspective (myWinPct/iWon), so the results screen
      // can show individual head-to-head results and replay any of them
      // WITHOUT re-simulating anything.
      const matchupsByIndex = list.map(() => []);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const m = runMatch(specs[i], specs[j], { gen: 2, moves: ctx.movestats, chart: ctx.chart, n: BATTLE_N, seed: seedFromString(`${dateStr}:${i}:${j}`) });
          sum[i] += m.challengerWins / m.n; games[i]++;
          sum[j] += m.championWins / m.n;  games[j]++;
          matchupsByIndex[i].push({ oppUid: list[j].uid, oppName: list[j].name, oppMonName: list[j].mon.name, myWinPct: m.challengerWinPct, iWon: m.challengerBeatsChampion, aSpec: specs[i], bSpec: specs[j], res: m });
          matchupsByIndex[j].push({ oppUid: list[i].uid, oppName: list[i].name, oppMonName: list[i].mon.name, myWinPct: 1 - m.challengerWinPct, iWon: !m.challengerBeatsChampion, aSpec: specs[i], bSpec: specs[j], res: m });
        }
      }
      const ranked = list
        .map((e, i) => ({ ...e, avg: games[i] ? sum[i] / games[i] : 0, spec: specs[i], matchups: matchupsByIndex[i] }))
        .sort((a, b) => b.avg - a.avg);
      renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical);
    }, 30);
  }

  function renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical) {
    const myIndex = ranked.findIndex((e) => (myUid && e.uid === myUid) || e._me);
    const me = myIndex >= 0 ? ranked[myIndex] : null;
    const hasOpponents = ranked.length >= 2;

    // #1 — share text now leads with a deep link into today's Daily Challenge
    // and shows the PLAYER's name (falling back to a stable "Player_NNNNN"
    // if they haven't set one, so it doesn't change on every share) instead
    // of the drafted mon's name.
    const shareText = me ? buildSummaryText({
      kind: 'daily', dateStr,
      playerName: (identity && identity.name) || stablePlayerFallbackName(myUid),
      rank: hasOpponents ? myIndex + 1 : undefined,
      total: hasOpponents ? ranked.length : undefined,
      winPct: hasOpponents ? me.avg : undefined,
      link: dailyChallengeLink(),
    }) : '';

    const rows = ranked.length
      ? ranked.map((e, i) => {
          const mine = i === myIndex;
          return el('tr', { class: mine ? 'lb-me' : '' },
            el('td', {}, (['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][i]) || String(i + 1)),
            el('td', { style: { fontWeight: mine ? 800 : 400, color: mine ? 'var(--accent-gold)' : '' } }, e.name + (e._me && provisional ? ' (you, unsaved)' : '')),
            el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, e.mon.name),
            el('td', { style: { fontWeight: 700 } }, hasOpponents ? `${(e.avg * 100).toFixed(0)}%` : '\u2014'),
            el('td', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
              hasOpponents ? el('button', { class: 'btn-secondary', style: ACTION_BTN_STYLE, title: `${e.name}'s matchups`,
                onClick: () => renderDailyMatchups(e, dateStr, isHistorical, () => renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical)) }, '\uD83D\uDCCA') : null,
              el('button', { class: 'btn-secondary', style: ACTION_BTN_STYLE, title: `Inspect ${e.mon.name}`,
                onClick: () => renderMonInspect(e.mon, { title: `${e.name}\u2019s Pok\u00e9mon`, onBack: () => renderDailyResults(ranked, myUid, provisional, dateStr, isHistorical) }) }, '\uD83D\uDD0D')));
        })
      : [el('tr', {}, el('td', { colspan: '5', style: { textAlign: 'center', color: 'var(--text-dim)' } }, isHistorical ? 'No one played that day.' : 'No entries yet today.'))];

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
              el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', {}, 'Build'), el('th', {}, 'Win%'), el('th', {}, ''))),
              el('tbody', {}, ...rows))),
          el('div', { class: 'summary-actions' },
            me ? el('button', { class: 'btn-primary', onClick: async () => { const ok = await copyToClipboard(shareText); showShareSheet(shareText, ok); } }, '\uD83D\uDCE4 Share') : null,
            el('button', { class: 'btn-secondary', onClick: () => showDailyResults(dateStr) }, '\u21BB Refresh'),
            isHistorical
              ? el('button', { class: 'btn-secondary', onClick: () => showDailyResults(ctx.dateStr) }, '\u2192 Today\u2019s Results')
              : el('button', { class: 'btn-secondary', onClick: () => showDailyResults(yesterdayDateStr()) }, '\uD83D\uDCC5 See Yesterday\u2019s Results'),
            el('button', { class: 'btn-secondary', onClick: () => onExit && onExit() }, '\u2190 Main Menu')))));
  }

  const ACTION_BTN_STYLE = { padding: '4px 8px', fontSize: '13px', lineHeight: 1 };

  // Per-player head-to-head breakdown: every OTHER entrant (including Cal),
  // with this player's specific win/loss + win% against each one, and an
  // on-demand replay reusing the sample battle log already computed in
  // showDailyResults() — no re-simulation. Available for ANY row (including
  // your own and Cal's), which is what makes it "available for the daily
  // rival" for free rather than needing special-case code; "no self-battling"
  // falls out naturally since the all-pairs computation never pairs a player
  // against themselves.
  function renderDailyMatchups(entry, dateStr, isHistorical, onBack) {
    stopPlay();
    const rows = entry.matchups.length
      ? entry.matchups.map((mu) => el('tr', {},
          el('td', {}, mu.oppName),
          el('td', { style: { color: 'var(--text-dim)', fontSize: '11px' } }, mu.oppMonName),
          el('td', { style: { fontWeight: 700, color: mu.iWon ? '#29cc66' : '#e06060' } }, `${mu.iWon ? 'Won' : 'Lost'} \u00b7 ${(mu.myWinPct * 100).toFixed(0)}%`),
          el('td', {}, el('button', { class: 'btn-secondary', style: ACTION_BTN_STYLE,
            onClick: () => renderBattle(mu.aSpec, mu.bSpec, mu.res, buildPlayback(mu.res.sampleLog, mu.aSpec, mu.bSpec),
              { mode: 'dailyRow', title: `${entry.name} vs ${mu.oppName}`, viewingSide: entry.spec === mu.aSpec ? 'a' : 'b', onBack: () => renderDailyMatchups(entry, dateStr, isHistorical, onBack) }) },
            '\u25B6 Watch'))))
      : [el('tr', {}, el('td', { colspan: '4', style: { textAlign: 'center', color: 'var(--text-dim)' } }, 'No other entries to compare against yet.'))];

    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-result', style: { textAlign: 'center' } }, `\uD83D\uDCCA ${entry.name}\u2019s Matchups`),
          el('div', { class: 'battle-vs', style: { marginBottom: '8px' } }, `${entry.mon.name} \u00b7 ${dateStr}${isHistorical ? ' (Yesterday)' : ''}`),
          el('div', { class: 'lb-board' },
            el('table', { class: 'lb-table' },
              el('thead', {}, el('tr', {}, el('th', {}, 'Opponent'), el('th', {}, 'Their Build'), el('th', {}, 'Result'), el('th', {}, ''))),
              el('tbody', {}, ...rows))),
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: onBack }, '\u2190 Back to Results')))));
  }

  // Read-only "inspect" card for ANY drafted mon (yours, another player's, or
  // Cal's) \u2014 the same core visual as renderBuild()'s Draft Complete screen
  // (types, stat spread, moves), but without the draft-specific action
  // buttons (Submit/Challenge/Share), since this is for INSPECTING someone
  // else's build, not continuing your own draft.
  function renderMonInspect(mon, opts = {}) {
    stopPlay();
    const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    const statVals = statKeys.map((k) => (mon.baseStats && mon.baseStats[k]) || 0);
    clear(root).append(
      el('div', { class: 'summary-container' },
        el('div', { class: 'summary-card' },
          el('div', { class: 'summary-header' },
            el('div', { class: 'summary-result' }, opts.title || `\uD83D\uDD0D ${mon.name}`),
            el('div', { class: 'summary-mon' }, mon.name)),
          el('div', { class: 'type-pills' },
            ...(mon.types || []).filter(Boolean).map((t) => el('span', { class: `type-pill type-${t.toLowerCase()}` }, t))),
          statSpreadEl(statVals.join('/')),
          el('div', { class: 'draft-complete-moves' },
            el('div', { class: 'draft-section-title', style: { marginTop: '12px' } }, 'Moves'),
            el('div', { class: 'draft-move-grid' },
              ...(mon.moves || []).map((m) => el('div', { class: 'draft-move-chip drafted' }, m)))),
          mon.species ? el('div', { class: 'summary-meta' }, el('div', {}, `Based on: ${mon.species}`)) : null,
          el('div', { class: 'summary-actions' },
            el('button', { class: 'btn-secondary', onClick: opts.onBack }, '\u2190 Back')))));
  }

  return { destroy() { stopPlay(); if (toast) { toast.remove(); toast = null; } clear(mount); } };
}

export default createDraftBattle;
