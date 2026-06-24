/**
 * @file        docs/js/main.js
 * @version     1.0.0
 * @updated     2026-06-23
 * @changelog
 *   1.0.0 — Initial app shell. Loads config.json (falls back to a built-in
 *           default so the skeleton runs before Phase 2 generates data),
 *           renders the mode-select screen from modes.js, routes on the URL
 *           hash #/<mode>/<gen>, lazy-imports the chosen controller, fetches
 *           data/genN.json, and calls controller({ mount, config, data, onExit }).
 *           Every failure path renders a friendly placeholder with a way back,
 *           so a half-built site never shows a blank screen.
 * ---------------------------------------------------------------------------
 * Paths are relative to index.html so the site works from a GitHub Pages
 * project subpath (https://user.github.io/<repo>/). No absolute '/...' paths.
 */

import { el, mount, clear } from './lib/dom.js';
import { MODES, getMode, resolveFactory } from './modes.js';

const APP_VERSION = '1.0.0';

// Minimal config the shell can run on before data/config.json exists (Phase 2).
const DEFAULT_CONFIG = {
  title: 'PokéGuess',
  gens: [1, 2],
  genLabels: { 1: 'Gen 1', 2: 'Gen 2' },
};

let CONFIG = DEFAULT_CONFIG;
let appRoot = null;
let activeController = null;

init();

async function init() {
  appRoot = document.getElementById('app');
  if (!appRoot) {
    document.body.appendChild(el('div', { id: 'app' }));
    appRoot = document.getElementById('app');
  }
  CONFIG = await loadConfig();
  window.addEventListener('hashchange', route);
  route();
}

async function loadConfig() {
  try {
    const res = await fetch('./data/config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`config ${res.status}`);
    const json = await res.json();
    return { ...DEFAULT_CONFIG, ...json };
  } catch {
    // Expected before Phase 2; the shell stays fully usable on defaults.
    return DEFAULT_CONFIG;
  }
}

/** Parse '#/<mode>/<gen>' -> { modeId, gen } (gen optional). */
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  if (!raw) return { modeId: null, gen: null };
  const [modeId, genStr] = raw.split('/');
  const gen = genStr ? Number(genStr) : null;
  return { modeId: modeId || null, gen: Number.isFinite(gen) ? gen : null };
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  teardownActive();
  const { modeId, gen } = parseHash();

  if (!modeId) { renderMenu(); return; }

  const mode = getMode(modeId);
  if (!mode) { renderNotFound(modeId); return; }

  const useGen = gen && mode.gens.includes(gen) ? gen : mode.gens[0];

  if (!mode.enabled) { renderComingSoon(mode); return; }

  await launchMode(mode, useGen);
}

function teardownActive() {
  if (activeController && typeof activeController.destroy === 'function') {
    try { activeController.destroy(); } catch { /* ignore */ }
  }
  activeController = null;
}

// ---- screens ---------------------------------------------------------------

function screenShell(...children) {
  const wrap = el('div', { class: 'shell' }, ...children);
  mount(appRoot, wrap);
  return wrap;
}

function renderMenu() {
  const groups = {};
  for (const m of MODES) (groups[m.group] ||= []).push(m);

  screenShell(
    el('header', { class: 'shell-header' },
      el('h1', { class: 'shell-title' }, CONFIG.title || 'PokéGuess'),
      el('p', { class: 'shell-tagline' }, 'Mystery Pokémon · Gen 1 & 2 · Draft Battle'),
    ),
    ...Object.entries(groups).map(([group, modes]) =>
      el('section', { class: 'mode-group' },
        el('h2', { class: 'mode-group-title' }, group),
        el('div', { class: 'mode-grid' },
          ...modes.map((m) => modeCard(m)),
        ),
      ),
    ),
    el('footer', { class: 'shell-footer' }, `Build skeleton v${APP_VERSION}`),
  );
}

function modeCard(mode) {
  const genButtons = mode.gens.map((g) =>
    el('button', {
      class: 'gen-btn',
      disabled: !mode.enabled,
      onClick: () => navigate(`#/${mode.id}/${g}`),
    }, CONFIG.genLabels?.[g] || `Gen ${g}`),
  );

  return el('div', { class: `mode-card${mode.enabled ? '' : ' is-disabled'}` },
    el('div', { class: 'mode-card-icon' }, mode.icon),
    el('div', { class: 'mode-card-body' },
      el('h3', { class: 'mode-card-label' }, mode.label),
      el('p', { class: 'mode-card-blurb' }, mode.blurb),
      el('div', { class: 'mode-card-gens' }, ...genButtons),
    ),
    mode.enabled ? null : el('span', { class: 'mode-card-badge' }, 'Coming soon'),
  );
}

function backBar(message) {
  return el('div', { class: 'placeholder' },
    message,
    el('button', { class: 'gen-btn', onClick: () => navigate('#/') }, 'Back to menu'),
  );
}

function renderComingSoon(mode) {
  screenShell(
    el('header', { class: 'shell-header' },
      el('h1', { class: 'shell-title' }, mode.label),
    ),
    backBar(el('p', { class: 'placeholder-text' },
      `${mode.label} isn't wired up yet — it lands in a later build phase.`)),
  );
}

function renderNotFound(modeId) {
  screenShell(
    el('header', { class: 'shell-header' }, el('h1', { class: 'shell-title' }, 'Not found')),
    backBar(el('p', { class: 'placeholder-text' }, `No mode called "${modeId}".`)),
  );
}

async function launchMode(mode, gen) {
  screenShell(el('div', { class: 'placeholder' },
    el('p', { class: 'placeholder-text' }, `Loading ${mode.label} (Gen ${gen})…`)));

  let mod, data;
  try {
    mod = await mode.load();
  } catch (err) {
    screenShell(
      el('header', { class: 'shell-header' }, el('h1', { class: 'shell-title' }, mode.label)),
      backBar(el('p', { class: 'placeholder-text' },
        `Couldn't load this mode's code yet (${String(err.message || err)}).`)),
    );
    return;
  }

  try {
    data = await fetchGenData(gen);
  } catch (err) {
    screenShell(
      el('header', { class: 'shell-header' }, el('h1', { class: 'shell-title' }, mode.label)),
      backBar(el('p', { class: 'placeholder-text' },
        `Gen ${gen} data isn't available yet (${String(err.message || err)}). ` +
        `It is produced by the data pipeline in Phase 2.`)),
    );
    return;
  }

  const factory = resolveFactory(mod);
  const surface = clear(appRoot);
  activeController = factory({
    mount: surface,
    config: CONFIG,
    data,
    onExit: () => navigate('#/'),
  }) || null;
}

async function fetchGenData(gen) {
  const res = await fetch(`./data/gen${gen}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`gen${gen}.json ${res.status}`);
  return res.json();
}
