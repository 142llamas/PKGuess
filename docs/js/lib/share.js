/**
 * @file        js/lib/share.js
 * @version     1.5.1
 * @updated     2026-07-09
 * @changelog
 *   1.5.1 — Fixed a grammar clash: "See if you can beat my Ash's Kangaskhan"
 *           has two possessives fighting each other. monName is generally
 *           "{playerName}'s {species}"; the gauntlet/throne "my {mon}"
 *           phrases now strip that prefix, reading "beat my Kangaskhan"
 *           instead. Other uses of monName (e.g. "My Elite 4 challenger: X")
 *           aren't a possessive clash and are untouched.
 *   1.5.0 — Added roomJoinLink(modeId, gen, code) (a deep link that pre-fills
 *           a room-join code when opened) and buildRoomInviteText({gameLabel,
 *           details, link}) — back online.js's and race.js's new room-
 *           sharing "Share Room" button.
 *   1.4.0 — #1: daily share text now leads with a deep link into the Daily
 *           Challenge (dailyChallengeLink), and its 2nd line shows the
 *           PLAYER's name (falling back to a stable "Player_NNNNN" via the
 *           new stablePlayerFallbackName, derived from their uid so it
 *           doesn't change on every share) instead of the drafted mon's name
 *           — matches the exact spec'd 4-line format ("PokeGuess Daily Draft
 *           – {date} / {name} / Ranked {x} of {y} / {pct}% Overall Win
 *           Rate"). throne/gauntlet kinds keep their link trailing (unchanged
 *           placement, just no longer using one shared trailing-only code
 *           path so daily's leading link doesn't affect them).
 *   1.3.0 — #14/#15: added the drafted-mon share-card infrastructure —
 *           TYPE_COLORS/typeColor/typeTextColor (mirrors styles.css's .type-*
 *           colors, kept in sync manually since canvas can't read CSS),
 *           buildMonCardPlan (pure layout data, fully unit-testable),
 *           drawMonCardToCanvas (draws a plan onto an injected 2D context —
 *           real in the browser, a recording fake in tests, since jsdom has
 *           no canvas 2D implementation and this project avoids adding a
 *           canvas-polyfill dependency), draftBattleLink (deep link back into
 *           Draft Battle for share text), canvasToPngBlob, and
 *           shareMonCardImage (Web Share API with an image file, falling back
 *           to a PNG download + clipboard text copy). buildSummaryText gained
 *           a 'gauntlet' kind for the new consolidated post-climb share
 *           (#15) and an optional trailing `link` line (used by both kinds).
 *   1.2.0 — Throne share: "challenged X and won/lost with my Y"; no -build / no Player’s (#14e).
 *   1.1.0 — Share text is now plain ASCII ("I beat ___"), no win-meter and
 *           no emoji — fixes unrenderable glyphs in shared messages (#9/#10).
 *   1.0.0 — Central-Time date/period helpers, deterministic seeds, and the
 *           summary-card text + WhatsApp/clipboard share used by Draft Battle
 *           (throne) and the Daily Challenge (SPEC §8b).
 *           • centralDateParts/centralDateStr use Intl with America/Chicago, so
 *             they are DST-correct (CDT in summer, CST in winter) — unlike a
 *             fixed -6h offset.
 *           • centralPeriodKey gives the reset bucket per throne tier
 *             (day|week|month|year|all). A throne whose stored period != the
 *             current period is treated as vacated.
 *           • seedFromDate/seedFromString are stable 32-bit hashes so every
 *             player derives the same daily draft + the same NPC throne champion.
 *
 * Pure logic + browser share. No DOM created on import.
 */

const pad = (n) => String(n).padStart(2, '0');

/** CT date/time parts as numbers. DST-correct via the IANA zone. */
export function centralDateParts(date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const p = {};
    for (const part of fmt.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value;
    let hour = parseInt(p.hour, 10);
    if (hour === 24) hour = 0; // some engines emit '24' for midnight
    return {
      year: parseInt(p.year, 10), month: parseInt(p.month, 10), day: parseInt(p.day, 10),
      hour, minute: parseInt(p.minute, 10), second: parseInt(p.second, 10),
    };
  } catch {
    // Fallback: fixed CST (-6h) if Intl/zone is unavailable.
    const ms = date.getTime() + (date.getTimezoneOffset() - 360) * 60000;
    const d = new Date(ms);
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
    };
  }
}

/** 'YYYY-MM-DD' in Central Time — the daily key (SPEC §9 dateCT). */
export function centralDateStr(date = new Date()) {
  const p = centralDateParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO week number/year from a CT calendar date (Mon-based weeks). */
function isoWeekParts(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (d.getUTCDay() + 6) % 7;          // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);        // shift to the week's Thursday
  const isoYear = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuNum + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return { isoYear, week };
}

/**
 * Reset bucket for a throne tier, in Central Time. Two timestamps share a key
 * iff they fall in the same period — so a throne "vacates" the moment the key
 * rolls over (midnight CT for day, etc.).
 * @param {'day'|'week'|'month'|'year'|'all'} tierKey
 */
export function centralPeriodKey(tierKey, date = new Date()) {
  const p = centralDateParts(date);
  switch (tierKey) {
    case 'day':   return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    case 'week': { const { isoYear, week } = isoWeekParts(p.year, p.month, p.day); return `${isoYear}-W${pad(week)}`; }
    case 'month': return `${p.year}-${pad(p.month)}`;
    case 'year':  return `${p.year}`;
    case 'all':   return 'all';
    default:      return 'all';
  }
}

/** FNV-1a 32-bit string hash → unsigned int (stable across engines). */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic daily seed from a CT date (string or Date). Everyone matches. */
export function seedFromDate(date = new Date()) {
  const str = typeof date === 'string' ? date : centralDateStr(date);
  return seedFromString('daily:' + str);
}

// ---- summary card --------------------------------------------------------


/** Sum a mon's base stats into a single BST (Base Stat Total) number. Accepts
 *  either an object ({hp,atk,...}) or an array of values; ignores non-numeric
 *  entries. Pure, so the draft screens, share text, and E4 stats all compute
 *  BST identically from one place. */
export function baseStatTotal(baseStats) {
  if (!baseStats) return 0;
  const vals = Array.isArray(baseStats) ? baseStats : Object.values(baseStats);
  return vals.reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

/**
 * Build a shareable plain-text summary card.
 * @param {{kind?:'daily'|'throne'|'gauntlet', dateStr?:string, monName?:string,
 *   playerName?:string, winPct?:number, rank?:number, total?:number,
 *   tierLabel?:string, claimed?:boolean, placementLabel?:string, link?:string}} opts
 */
export function buildSummaryText(opts = {}) {
  const { kind = 'daily', dateStr, monName, playerName, winPct, rank, total, tierLabel, claimed, beatName, placementLabel, link, bst } = opts;
  // "beat my Ash's Kangaskhan" / "with my Ash's Kangaskhan" reads wrong —
  // two possessives clashing. monName is generally "{playerName}'s
  // {species}"; strip that prefix specifically for the "my {mon}" phrases
  // below so it reads "beat my Kangaskhan" instead. Other uses of monName
  // (e.g. "My Elite 4 challenger: Ash's Kangaskhan") aren't a possessive
  // clash and are left as-is.
  const speciesOnly = (name) => (name || '').replace(/^.+?'s /, '');
  // " (BST ###)" suffix for the "beat my <mon>" phrasings, when a total is
  // supplied. BST = Base Stat Total (sum of all six base stats).
  const bstSuffix = (bst != null && isFinite(Number(bst))) ? ` (BST ${Number(bst)})` : '';
  const lines = [];
  if (kind === 'gauntlet') {
    // #15 — one consolidated share after a full Elite-4 gauntlet run, instead
    // of a share prompt after every individual throne win.
    lines.push('PokeGuess Draft Battle');
    if (placementLabel && monName) lines.push(`I just took the ${placementLabel} spot on the Elite 4! See if you can beat my ${speciesOnly(monName)}${bstSuffix}`);
    else if (placementLabel) lines.push(`I just took the ${placementLabel} spot on the Elite 4!`);
    else if (monName) lines.push(`My Elite 4 challenger: ${monName}${bstSuffix}`);
    if (link) lines.push(link);
  } else if (kind === 'throne') {
    lines.push('PokeGuess Draft Battle');
    const won = winPct != null ? winPct > 0.5 : !!claimed;
    if (beatName && monName) lines.push(`I challenged ${beatName} and ${won ? 'won' : 'lost'} with my ${speciesOnly(monName)}${bstSuffix}`);
    else if (beatName) lines.push(`I challenged ${beatName} and ${won ? 'won' : 'lost'}`);
    else if (claimed && tierLabel) lines.push(`I claimed ${tierLabel}!`);
    else if (monName) lines.push(`with my ${speciesOnly(monName)}${bstSuffix}`);
    if (winPct != null) lines.push(`(${Math.round(winPct * 100)}% win rate)`);
    if (link) lines.push(link);
  } else {
    // #1 — daily: a leading deep link (so a recipient can jump straight into
    // today's daily draft), then the exact spec'd four lines. Line 2 is the
    // PLAYER's name (not the mon's name) — callers pass a fallback like
    // "Player_1234" via `playerName` when the player hasn't set one.
    if (link) lines.push(link);
    lines.push(`PokeGuess Daily Draft \u2013 ${dateStr || ''}`);
    lines.push(playerName || 'Player');
    if (rank && total) lines.push(`Ranked ${rank} of ${total}`);
    if (winPct != null) lines.push(`${Math.round(winPct * 100)}% Overall Win Rate`);
  }
  return lines.join('\n');
}

// ---- drafted-mon share card (#14) ------------------------------------------
// Mirrors docs/css/styles.css's .type-{name} colors exactly (kept in sync
// manually since canvas can't read CSS classes) so the card LOOKS like the
// rest of the app rather than a generic re-skin.
export const TYPE_COLORS = {
  normal: '#9a9a6a', fire: '#e85020', water: '#2878e8', electric: '#e8c020',
  grass: '#38a838', ice: '#48c8e8', fighting: '#b84820', poison: '#8830a8',
  ground: '#d8b058', flying: '#7890e8', psychic: '#e83878', bug: '#68a020',
  rock: '#a89050', ghost: '#504880', dragon: '#4828c8', dark: '#403028',
  steel: '#a8b0c0',
};
const TYPE_DARK_TEXT = new Set(['electric', 'ice', 'ground', 'steel']);

export function typeColor(type) { return TYPE_COLORS[String(type || '').toLowerCase()] || '#666666'; }
export function typeTextColor(type) { return TYPE_DARK_TEXT.has(String(type || '').toLowerCase()) ? '#222222' : '#ffffff'; }

const STAT_LABELS_FOR_CARD = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/**
 * Pure layout plan for the drafted-mon share card — no canvas/DOM involved,
 * so this half of card-building is fully unit-testable. drawMonCardToCanvas
 * consumes the plan to actually paint pixels.
 * @param {{name:string, types?:string[], baseStats?:object, moves?:string[]}} mon
 */
export function buildMonCardPlan(mon) {
  const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const bs = mon.baseStats || {};
  return {
    title: mon.name || 'Mystery Pok\u00e9mon',
    types: (mon.types || []).filter(Boolean),
    stats: statKeys.map((k) => ({ key: k, label: STAT_LABELS_FOR_CARD[k], value: Number(bs[k]) || 0 })),
    moves: (mon.moves || []).filter(Boolean).slice(0, 4),
  };
}

/**
 * Draw a plan (from buildMonCardPlan) onto a 2D canvas context. `ctx` is
 * dependency-injected — in the browser this is a real CanvasRenderingContext2D
 * from an offscreen <canvas>; tests can pass a lightweight recording fake
 * (canvas 2D contexts aren't implemented by jsdom, and this project
 * deliberately avoids adding a canvas-polyfill dependency just for pixel
 * tests) to verify the RIGHT draw calls happen without needing real pixels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof buildMonCardPlan>} plan
 * @param {{width?:number, height?:number}} [size]
 */
export function drawMonCardToCanvas(ctx, plan, size = {}) {
  const W = size.width || 600, H = size.height || 760;
  // background
  ctx.fillStyle = '#1b1b24';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a3a4a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(plan.title, W / 2, 60);

  // type pills
  const pillY = 90, pillH = 36;
  let pillX = W / 2 - (plan.types.length * 100) / 2;
  for (const t of plan.types) {
    ctx.fillStyle = typeColor(t);
    ctx.fillRect(pillX, pillY, 90, pillH);
    ctx.fillStyle = typeTextColor(t);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(t.toUpperCase(), pillX + 45, pillY + pillH / 2 + 6);
    pillX += 100;
  }

  // stats
  let statY = 170;
  ctx.textAlign = 'left';
  const maxStat = Math.max(1, ...plan.stats.map((s) => s.value));
  for (const s of plan.stats) {
    ctx.fillStyle = '#cccccc';
    ctx.font = '18px sans-serif';
    ctx.fillText(s.label, 40, statY + 18);
    ctx.fillStyle = '#33465a';
    ctx.fillRect(120, statY, W - 200, 20);
    ctx.fillStyle = '#4fa8e8';
    ctx.fillRect(120, statY, Math.round(((W - 200) * s.value) / maxStat), 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(String(s.value), W - 40, statY + 18);
    ctx.textAlign = 'left';
    statY += 34;
  }

  // moves
  let moveY = statY + 30;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Moves', W / 2, moveY);
  moveY += 30;
  for (const m of plan.moves) {
    ctx.fillStyle = '#2a2a38';
    ctx.fillRect(60, moveY, W - 120, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.fillText(m, W / 2, moveY + 26);
    moveY += 50;
  }

  ctx.fillStyle = '#888888';
  ctx.font = '14px sans-serif';
  ctx.fillText('PokeGuess Draft Battle', W / 2, H - 20);
}

/** A stable "Player_NNNNN" fallback display name derived from a uid (#1) — an
 *  anonymous player's shared daily card shows the SAME fallback name every
 *  time they share, rather than a fresh random number each time. */
export function stablePlayerFallbackName(uid) {
  const n = seedFromString('playername:' + (uid || 'anon')) % 100000;
  return `Player_${n}`;
}

/** A stable deep link back into the Daily Challenge, for share text (#1).
 *  Empty string outside a browser (no `location`) rather than throwing. */
export function dailyChallengeLink() {
  try {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#/dailychallenge/2`;
  } catch { return ''; }
}

/** A deep link that pre-fills a room-join code when opened, for online.js's
 *  and race.js's new "Share Room" invites. Empty string outside a browser
 *  (no `location`) rather than throwing.
 *  @param {string} modeId  'online' or 'race'
 *  @param {number} gen
 *  @param {string} code    the room code to pre-fill on the joining end */
export function roomJoinLink(modeId, gen, code) {
  try {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#/${modeId}/${gen}?code=${encodeURIComponent(code)}`;
  } catch { return ''; }
}

/** Room-invite share text for a multiplayer room: "Join my {game}!", a
 *  handful of relevant details (kept short on purpose — not every setting),
 *  then the deep link. Used by online.js and race.js.
 *  @param {{gameLabel:string, details?:string[], link:string}} opts */
export function buildRoomInviteText({ gameLabel, details = [], link }) {
  const lines = [`Join my ${gameLabel} game!`];
  if (details.length) lines.push(details.join(' \u00b7 '));
  if (link) lines.push(link);
  return lines.join('\n');
}

/** A stable deep link back into Draft Battle, for share text (#14/#15). Empty
 *  string outside a browser (no `location`) rather than throwing. */
export function draftBattleLink(view) {
  try {
    const base = `${location.origin}${location.pathname}`;
    return `${base}#/draftbattle/2${view ? '/' + view : ''}`;
  } catch { return ''; }
}

/** Promise wrapper around canvas.toBlob (callback-based in every browser). */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/**
 * Share (or fall back to download + copy) a drafted mon's card image + text.
 * Tries the Web Share API with an image file first (best mobile UX); falls
 * back to triggering a PNG download and copying the text to the clipboard.
 * @returns {Promise<{ shared:boolean, downloaded:boolean, copied:boolean }>}
 */
export async function shareMonCardImage(mon, text, { filename = 'pokeguess-draft.png' } = {}) {
  let canvas;
  try { canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 760; } catch { canvas = null; }
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx) drawMonCardToCanvas(ctx, buildMonCardPlan(mon));

  const blob = canvas && ctx ? await canvasToPngBlob(canvas) : null;

  if (blob && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return { shared: true, downloaded: false, copied: false };
      }
    } catch { /* fall through to the download+copy fallback */ }
  }

  let downloaded = false;
  if (blob) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      downloaded = true;
    } catch { /* download unsupported — text copy still helps */ }
  }
  const copied = await copyToClipboard(text);
  return { shared: false, downloaded, copied };
}

/** Copy text to the clipboard; resolves true on success. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Open a WhatsApp share for the given text. Returns the URL it used. */
export function shareWhatsApp(text) {
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  try { window.open(url, '_blank', 'noopener'); } catch { /* popup blocked */ }
  return url;
}
