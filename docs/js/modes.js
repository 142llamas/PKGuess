/**
 * @file        docs/js/modes.js
 * @version     1.2.0
 * @updated     2026-06-24
 * @changelog
 *   1.2.0 — Reordered groups: Draft first, Guess second, Reference last.
 *   1.1.0 — Split Draft into Draft Battle + Daily Challenge.
 *   1.0.0 — Initial registry.
 */

/** @type {ModeDef[]} */
export const MODES = [
  {
    id: 'draftbattle', label: 'Draft Battle', icon: '⚔️', group: 'Draft',
    blurb: 'Free play: a fresh random draft each time. Battle the thrones. (Gen 2)',
    enabled: true, gens: [2], params: { variant: 'freeplay' },
    load: () => import('./modes/draftbattle.js'),
  },
  {
    id: 'dailychallenge', label: 'Daily Challenge', icon: '📅', group: 'Draft',
    blurb: 'Everyone drafts from the same seeded Pokémon. One attempt a day. (Gen 2)',
    enabled: true, gens: [2], params: { variant: 'daily' },
    load: () => import('./modes/draftbattle.js'),
  },
  {
    id: 'single', label: 'Single Player', icon: '🎯', group: 'Guess',
    blurb: 'Spend a point budget on clues, then name the mystery Pokémon.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/single.js'),
  },
  {
    id: 'safari', label: 'Safari Zone', icon: '🏕️', group: 'Guess',
    blurb: 'One shared budget across many Pokémon — score is how many you catch.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/safari.js'),
  },
  {
    id: 'victoryroad', label: 'Victory Road', icon: '🗻', group: 'Guess',
    blurb: 'Endless streak gauntlet — higher tiers reveal fewer clues.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/victoryroad.js'),
  },
  {
    id: 'multiplayer', label: 'Multiplayer', icon: '👥', group: 'Guess',
    blurb: 'Pass-and-play hot seat, or take it online with timed turns.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/multiplayer.js'),
  },
  {
    id: 'pokedex', label: 'Pokédex', icon: '📖', group: 'Reference',
    blurb: 'Browse and quiz yourself on every Pokémon and its clue data.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/pokedex.js'),
  },
  {
    id: 'leaderboard', label: 'Leaderboard', icon: '🏆', group: 'Reference',
    blurb: 'Top scores per generation and mode.',
    enabled: true, gens: [1, 2],
    load: () => import('./modes/leaderboard.js'),
  },
];

export function getMode(id) { return MODES.find((m) => m.id === id) || null; }

export function resolveFactory(mod) {
  if (typeof mod.default === 'function') return mod.default;
  const fn = Object.values(mod).find((v) => typeof v === 'function');
  if (!fn) throw new Error('mode module exposes no factory function');
  return fn;
}
