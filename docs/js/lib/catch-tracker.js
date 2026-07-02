/**
 * @file        docs/js/lib/catch-tracker.js
 * @version     1.0.0
 * @updated     2026-06-28
 * @changelog
 *   1.0.0 — New. Extracted from pokedex.js/safari.js's duplicated inline
 *           localStorage logic so every guess mode (Single, Safari, Hotseat,
 *           Online) marks Caught/Seen through ONE implementation — #17 was
 *           partly a consequence of single.js and multiplayer.js never
 *           calling this at all (only Safari did), so a correct guess there
 *           silently never touched the Pokédex tracker. Same storage key as
 *           before ('pokeGuess_catchTracker') so no existing player data is
 *           lost by this refactor.
 *
 *           Status values: 'caught' | 'seen' | (absent = never encountered).
 *           Caught implies Seen conceptually (#17a) — enforced by ALWAYS
 *           calling markSeen() first and having markCaught() upgrade over an
 *           existing 'seen', never the reverse (markSeen never downgrades an
 *           existing 'caught').
 */

const CATCH_KEY = 'pokeGuess_catchTracker';

function load() {
  try { return JSON.parse(localStorage.getItem(CATCH_KEY) || '{}'); } catch { return {}; }
}
function save(d) {
  try { localStorage.setItem(CATCH_KEY, JSON.stringify(d)); } catch { /* ignore (private mode, quota, etc.) */ }
}

/** Raw status for a name: 'caught' | 'seen' | null. */
export function getCatchStatus(name) {
  if (!name) return null;
  return load()[String(name).toLowerCase()] || null;
}

/** The full { lowercaseName: 'caught'|'seen' } map, for list/filter screens. */
export function loadCatchMap() {
  return load();
}

/**
 * Mark a Pokémon as caught (a correct guess in Single/Safari/Hotseat/Online).
 * Caught always wins over any prior Seen (#17a — caught implies seen).
 */
export function markCaught(name) {
  if (!name) return;
  const d = load();
  d[String(name).toLowerCase()] = 'caught';
  save(d);
}

/**
 * Mark a Pokémon as seen-but-not-caught (points ran out, or someone else
 * guessed it first in multiplayer — #17b). Never downgrades an existing
 * 'caught' — once caught, always caught.
 */
export function markSeen(name) {
  if (!name) return;
  const d = load();
  if (d[String(name).toLowerCase()] === 'caught') return;
  d[String(name).toLowerCase()] = 'seen';
  save(d);
}

/** Manual override from the Pokédex detail screen: 'caught' | 'seen' | 'unseen'. */
export function setCatchStatus(name, status) {
  if (!name) return;
  const d = load();
  const key = String(name).toLowerCase();
  if (status === 'unseen') delete d[key]; else d[key] = status;
  save(d);
}
