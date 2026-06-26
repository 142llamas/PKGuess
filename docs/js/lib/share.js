/**
 * @file        js/lib/share.js
 * @version     1.0.0
 * @updated     2026-06-25
 * @changelog
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

function meter(p) {
  if (p == null || !isFinite(p)) return '';
  const n = Math.max(0, Math.min(10, Math.round(p * 10)));
  return '\uD83D\uDFE9'.repeat(n) + '\u2B1C'.repeat(10 - n); // 🟩 / ⬜
}

/**
 * Build a shareable plain-text summary card.
 * @param {{kind?:'daily'|'throne', dateStr?:string, monName?:string,
 *   winPct?:number, rank?:number, total?:number, tierLabel?:string,
 *   claimed?:boolean}} opts
 */
export function buildSummaryText(opts = {}) {
  const { kind = 'daily', dateStr, monName, winPct, rank, total, tierLabel, claimed } = opts;
  const lines = [];
  if (kind === 'throne') {
    lines.push('\uD83D\uDC51 Pok\u00e9Guess Draft Battle');
    if (claimed && tierLabel) lines.push(`I claimed the ${tierLabel} Throne!`);
    else if (tierLabel) lines.push(`${tierLabel} Throne challenge`);
    if (monName) lines.push(`\uD83E\uDDEC ${monName}`);
    if (winPct != null) lines.push(`\u2694\uFE0F ${Math.round(winPct * 100)}% win vs the champion`);
  } else {
    lines.push(`\uD83C\uDFAE Pok\u00e9Guess Daily${dateStr ? ' \u2014 ' + dateStr : ''}`);
    if (monName) lines.push(`\uD83E\uDDEC ${monName}`);
    if (rank && total) lines.push(`\uD83C\uDFC6 Rank ${rank}/${total}`);
    if (winPct != null) lines.push(`\u2694\uFE0F ${Math.round(winPct * 100)}% avg win rate`);
  }
  const bar = meter(winPct);
  if (bar) lines.push(bar);
  return lines.join('\n');
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
