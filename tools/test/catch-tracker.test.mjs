/**
 * @file tools/test/catch-tracker.test.mjs
 * @version 1.0.0
 * Unit tests for docs/js/lib/catch-tracker.js (#17): the shared Caught/Seen
 * store every guess mode + the Pokédex now go through. Uses a tiny fake
 * localStorage (no DOM needed) so this runs in the zero-dep suite.
 */

import { markCaught, markSeen, getCatchStatus, loadCatchMap, setCatchStatus } from '../../docs/js/lib/catch-tracker.js';

async function withFakeLocalStorage(fn) {
  const store = {};
  const fake = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const had = 'localStorage' in globalThis;
  const prev = had ? globalThis.localStorage : undefined;
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
  try { return await fn(); }
  finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true });
    else delete globalThis.localStorage;
  }
}

export default async function (t) {
  await withFakeLocalStorage(async () => {    t.section('catch-tracker.js — basic get/mark (#17)');
    {
      t.eq(getCatchStatus('Nonexistent'), null, 'an untouched name has no status');
      markSeen('Pidgey');
      t.eq(getCatchStatus('Pidgey'), 'seen', 'markSeen sets status to seen');
      markCaught('Pidgey');
      t.eq(getCatchStatus('Pidgey'), 'caught', 'markCaught upgrades seen -> caught');
    }

    t.section('catch-tracker.js — caught implies seen; caught never downgrades (#17a)');
    {
      markCaught('Abra');
      t.eq(getCatchStatus('Abra'), 'caught', 'markCaught sets caught directly');
      markSeen('Abra'); // simulate: player "sees" it again in a later game, e.g. Safari
      t.eq(getCatchStatus('Abra'), 'caught', 'markSeen never downgrades an existing caught status');
    }

    t.section('catch-tracker.js — case-insensitive keys');
    {
      markCaught('GENGAR');
      t.eq(getCatchStatus('gengar'), 'caught', 'lookups are case-insensitive');
      t.eq(getCatchStatus('Gengar'), 'caught', 'lookups are case-insensitive (mixed case)');
    }

    t.section('catch-tracker.js — loadCatchMap reflects every mark');
    {
      const map = loadCatchMap();
      t.eq(map['pidgey'], 'caught', 'map includes Pidgey as caught');
      t.eq(map['abra'], 'caught', 'map includes Abra as caught');
      t.eq(map['gengar'], 'caught', 'map includes Gengar as caught');
    }

    t.section('catch-tracker.js — setCatchStatus: manual override incl. "unseen" removes the entry');
    {
      setCatchStatus('Onix', 'seen');
      t.eq(getCatchStatus('Onix'), 'seen', 'manual override to seen works');
      setCatchStatus('Onix', 'caught');
      t.eq(getCatchStatus('Onix'), 'caught', 'manual override to caught works');
      setCatchStatus('Onix', 'unseen');
      t.eq(getCatchStatus('Onix'), null, 'manual override to unseen clears the entry entirely');
      t.ok(!('onix' in loadCatchMap()), 'the cleared entry is gone from the map, not just null');
    }
  });
}
