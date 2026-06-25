/**
 * @file        js/lib/leaderboard-data.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
 *   1.0.0 — Pure data helpers for leaderboards (no UI, no DOM). Matches the
 *           SPEC §6 interface: submitScore, topEntries, rankEntries.
 *           Schema (SPEC §9):
 *             /leaderboard/{gen}/{mode}/{id} = { uid, name, score, detail, at }
 *           Boards: gen = 'gen1'|'gen2', mode = 'single'|'victoryroad'|'safari'
 *           Draft boards live under /draft/... and are handled by draftbattle.js.
 *
 * Usage:  await submitScore('gen2', 'single', { score: 42, detail: '...' });
 *         const top = await topEntries('gen2', 'single', 10);
 */

import { getFirebase } from './firebase.js';
import { getIdentity } from './identity.js';

const VALID_GENS  = new Set(['gen1', 'gen2']);
const VALID_MODES = new Set(['single', 'victoryroad', 'safari']);

/**
 * Submit a score entry. Silently no-ops if Firebase is unavailable.
 * @param {'gen1'|'gen2'} gen
 * @param {'single'|'victoryroad'|'safari'} mode
 * @param {{ score:number, detail?:string }} entry
 */
export async function submitScore(gen, mode, entry) {
  if (!VALID_GENS.has(gen) || !VALID_MODES.has(mode)) return;
  try {
    const [fb, id] = await Promise.all([getFirebase(), getIdentity()]);
    const name = (id.name || 'Anonymous').slice(0, 16);
    const record = {
      uid:    id.uid,
      name,
      score:  Number(entry.score) || 0,
      detail: String(entry.detail || '').slice(0, 200),
      at:     Date.now(),
    };
    await fb.push(`/leaderboard/${gen}/${mode}`, record);
  } catch (e) {
    console.warn('leaderboard submit failed:', e);
  }
}

/**
 * Read top N entries for a board, sorted by score descending.
 * Returns [] on any error.
 * @param {'gen1'|'gen2'} gen
 * @param {'single'|'victoryroad'|'safari'} mode
 * @param {number} n
 * @returns {Promise<Array<{uid,name,score,detail,at,_key}>>}
 */
export async function topEntries(gen, mode, n = 10) {
  if (!VALID_GENS.has(gen) || !VALID_MODES.has(mode)) return [];
  try {
    const fb = await getFirebase();
    const raw = await fb.get(`/leaderboard/${gen}/${mode}`);
    if (!raw) return [];
    return rankEntries(raw, n);
  } catch (e) {
    console.warn('leaderboard read failed:', e);
    return [];
  }
}

/**
 * Sort a raw {key: entry} object by score descending, return top N as array.
 * Pure function — usable client-side without a DB call.
 * @param {Record<string, {uid,name,score,detail,at}>} obj
 * @param {number} n
 */
export function rankEntries(obj, n = 10) {
  return Object.entries(obj || {})
    .map(([_key, v]) => ({ ...v, _key }))
    .filter((e) => typeof e.score === 'number')
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, n);
}
