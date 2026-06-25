/**
 * @file        docs/js/modes.js
 * @version     1.1.0
 * @updated     2026-06-23
 * @changelog
 *   1.1.0 — Split Draft into two menu entries: Draft Battle (free-play, random,
 *           throne) and Daily Challenge (same seeded draft for everyone, one
 *           attempt/day). Both lazy-load the SAME draftbattle.js controller and
 *           differ only by `params.variant` ('freeplay' | 'daily'), which the
 *           shell passes through to the factory.
 *   1.0.0 — Initial mode registry. One entry per screen controller. `enabled`
 *           gates what the menu offers while modes are still being ported, so
 *           the shell is testable before every controller exists. `load()` is a
 *           lazy dynamic import (modes never bundle into the shell). Guess modes
 *           support gens [1,2]; Draft is gen 2 only (engine stays gen-aware).
 * ---------------------------------------------------------------------------
 * IMPORTANT (per SPEC §5): Gen 1 Guess and Gen 2 Guess are NOT separate modes —
 * they are the same controllers driven by a different data/genN.json. So gen is
 * a parameter of a mode, never a separate registry entry. The controller split
 * question (one controller vs gen-specific) is resolved in Phase 3; the registry
 * does not change either way.
 *
 * Each load() resolves to a module exposing a factory:
 *   export function createXxx({ mount, config, data, onExit }) -> { destroy() }
 * The shell calls `mod.default ?? mod[the single exported factory]`.
 */

/** @typedef {Object} ModeDef
 *  @property {string} id        URL token, e.g. 'single'
 *  @property {string} label     Human label for the menu
 *  @property {string} icon      Emoji/glyph shown on the card
 *  @property {string} blurb     One-line description (menu copy)
 *  @property {boolean} enabled  If false, menu shows it as "coming soon"
 *  @property {number[]} gens    Generations this mode supports
 *  @property {() => Promise<any>} load  Lazy import of the controller module
 *  @property {string} [group]   Menu grouping label
 */

/** @type {ModeDef[]} */
export const MODES = [
  {
    id: 'single', label: 'Single Player', icon: '🎯', group: 'Guess',
    blurb: 'Spend a point budget on clues, then name the mystery Pokémon.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/single.js'),
  },
  {
    id: 'pokedex', label: 'Pokédex', icon: '📖', group: 'Reference',
    blurb: 'Browse and quiz yourself on every Pokémon and its clue data.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/pokedex.js'),
  },
  {
    id: 'safari', label: 'Safari Zone', icon: '🏕️', group: 'Guess',
    blurb: 'One shared budget across many Pokémon — score is how many you catch.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/safari.js'),
  },
  {
    id: 'victoryroad', label: 'Victory Road', icon: '🏔️', group: 'Guess',
    blurb: 'Endless streak gauntlet — higher tiers reveal fewer clues.',
    enabled: false, gens: [1, 2],
    load: () => import('./modes/victoryroad.js'),
  },
  {
    id: 'multiplayer', label: 'Multiplayer', icon: '👥', group: 'Guess',
    blurb: 'Pass-and-play hot seat, or take it online with timed turns.',
    enabled: false, gens: [1, 2],
    load: () => import('./modes/multiplayer.js'),
  },
  {
    id: 'leaderboard', label: 'Leaderboard', icon: '🏆', group: 'Reference',
    blurb: 'Top scores per generation and mode.',
    enabled: false, gens: [1, 2],
    load: () => import('./modes/leaderboard.js'),
  },
  {
    id: 'draftbattle', label: 'Draft Battle', icon: '⚔️', group: 'Draft',
    blurb: 'Free play: a fresh random draft each time. Battle the thrones. (Gen 2)',
    enabled: false, gens: [2], params: { variant: 'freeplay' },
    load: () => import('./modes/draftbattle.js'),
  },
  {
    id: 'dailychallenge', label: 'Daily Challenge', icon: '📅', group: 'Draft',
    blurb: 'Everyone drafts from the same seeded Pokémon. One attempt a day. (Gen 2)',
    enabled: false, gens: [2], params: { variant: 'daily' },
    load: () => import('./modes/draftbattle.js'),
  },
];

/** Find a mode by id. */
export function getMode(id) {
  return MODES.find((m) => m.id === id) || null;
}

/** Pull the controller factory out of a loaded module, regardless of its name. */
export function resolveFactory(mod) {
  if (typeof mod.default === 'function') return mod.default;
  const fn = Object.values(mod).find((v) => typeof v === 'function');
  if (!fn) throw new Error('mode module exposes no factory function');
  return fn;
}
