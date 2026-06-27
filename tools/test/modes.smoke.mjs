import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com/' });
const { window } = dom;
const def = (k, v) => { try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch {} };
global.window = window; global.document = window.document;
def('navigator', window.navigator); def('Node', window.Node); def('HTMLElement', window.HTMLElement); def('MouseEvent', window.MouseEvent);
def('localStorage', { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } });
global.setTimeout = (fn) => { try { fn(); } catch {} return 0; };

const P = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const gen2 = JSON.parse(readFileSync(P('../../docs/data/gen2.json'), 'utf8'));
const dataFile = (name) => { try { return JSON.parse(readFileSync(P('../../docs/data/' + name), 'utf8')); } catch { return {}; } };
global.fetch = async (url) => {
  const file = String(url).split('/').pop();
  const exists = ['gen1.json', 'gen2.json', 'movelist-gen1.json', 'movelist-gen2.json', 'movestats-gen2.json', 'typechart-gen2.json', 'draftpool-gen2.json'].includes(file);
  return { ok: exists, json: async () => dataFile(file) };
};
const tick = () => new Promise((r) => { let i = 0; const t = () => (i++ < 5 ? Promise.resolve().then(t) : r()); t(); });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const mk = () => { const d = window.document.createElement('div'); window.document.body.appendChild(d); return d; };
const txt = (root) => root.textContent || '';

async function run(name, importPath, factoryName, checks) {
  const mod = await import(importPath);
  const factory = mod[factoryName] || mod.default;
  const mount = mk();
  let ctrl;
  try {
    ctrl = factory({ mount, config: { genLabels: { 1: 'Gen 1', 2: 'Gen 2' } }, data: gen2, params: { gen: 2, modeId: name }, onExit: () => {} });
    await tick();
    checks(mount);
  } catch (e) { fail++; console.log(`  THREW in ${name}: ${e.message}`); }
  try { ctrl && ctrl.destroy && ctrl.destroy(); } catch {}
}

await run('single', '../../docs/js/modes/single.js', 'createSingle', (m) => {
  ok(m.querySelector('.gen-switch'), 'single: gen toggle present');
  ok(txt(m).includes('difficulty') || txt(m).includes('Difficulty'), 'single: difficulty screen rendered');
});

await run('safari', '../../docs/js/modes/safari.js', 'createSafari', (m) => {
  ok(m.querySelector('.gen-switch'), 'safari: gen toggle present');
  ok(txt(m).includes('Enter the Safari Zone'), 'safari: renamed title');
});

await run('victoryroad', '../../docs/js/modes/victoryroad.js', 'createVictoryRoad', (m) => {
  ok(m.querySelector('.gen-switch'), 'victoryroad: gen toggle present');
  ok(txt(m).includes('Victory Road'), 'victoryroad: intro rendered');
});

await run('pokedex', '../../docs/js/modes/pokedex.js', 'createPokedex', (m) => {
  ok(m.querySelector('.gen-switch'), 'pokedex: gen toggle present');
  ok(txt(m).includes('Pok'), 'pokedex: list rendered');
  ok(!m.querySelector('.full-stat-string'), 'pokedex: duplicate stat string removed (list has none)');
  // open first detail
  const row = m.querySelector('.study-row, [class*="study"][role], .study-list > *');
  if (row && row.click) { row.click(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
