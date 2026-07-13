/**
 * @file        js/lib/firebase.js
 * @version     1.1.0
 * @updated     2026-07-12
 * @changelog
 *   1.1.0 — Added serverNow()/serverTimeOffset(): subscribes to Firebase's
 *           `.info/serverTimeOffset` and exposes a server-aligned clock so
 *           every client agrees on "now" regardless of local clock skew.
 *           Backs the cross-device countdown fixes in race.js and online.js
 *           (rematch countdowns, round transitions, RTG turn timers) — each
 *           device was previously counting down against its own clock.
 *   1.0.0 — Lazy Firebase loader. Imports the Firebase SDK from CDN only when
 *           first called; caches the result so every subsequent call is free.
 *           Returns a thin helpers object so callers never import Firebase SDK
 *           directly — the SDK URL lives in one place and is easy to update.
 *
 * Usage:  const fb = await getFirebase();
 *         await fb.set('/players/uid123', { name: 'Ash' });
 *         fb.onValue('/players/uid123', snap => console.log(snap.val()));
 */

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDN_X2X0TKBgyPECgxi79PYplMpmZQcWRo',
  authDomain:        'pkguess.firebaseapp.com',
  databaseURL:       'https://pkguess-default-rtdb.firebaseio.com',
  projectId:         'pkguess',
  storageBucket:     'pkguess.firebasestorage.app',
  messagingSenderId: '216591702199',
  appId:             '1:216591702199:web:37c54d951601e7888e5532',
};

// CDN versions — bump both together when upgrading
const FB_VERSION = '10.12.2';
const FB_CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

let _cached = null;

export async function getFirebase() {
  if (_cached) return _cached;

  const [
    { initializeApp, getApps },
    { getDatabase, ref, set, update, get, push, onValue, onDisconnect, serverTimestamp },
    { getAuth, signInAnonymously, onAuthStateChanged },
  ] = await Promise.all([
    import(`${FB_CDN}/firebase-app.js`),
    import(`${FB_CDN}/firebase-database.js`),
    import(`${FB_CDN}/firebase-auth.js`),
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  const db  = getDatabase(app);
  const auth = getAuth(app);

  // Server-clock alignment. Firebase exposes the estimated difference between
  // the client's clock and the server's at the special path `.info/
  // serverTimeOffset`. Subscribing keeps it live (it refines as the SDK
  // measures round-trip latency). `serverNow()` then gives every client the
  // SAME notion of "now" regardless of how wrong its own device clock is —
  // this is what makes cross-device countdowns (Cycling Road rematch, online
  // round transitions, RTG turn timers) actually agree instead of each device
  // counting down against its own skewed local clock.
  let _serverOffset = 0;
  try {
    onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
      const v = snap.val();
      if (typeof v === 'number' && isFinite(v)) _serverOffset = v;
    });
  } catch { /* offline / unsupported — serverNow() just falls back to Date.now() */ }

  // Thin helpers — always work with string paths, return Promises
  _cached = {
    // write helpers
    set:    (path, val) => set(ref(db, path), val),
    update: (path, val) => update(ref(db, path), val),
    push:   (path, val) => push(ref(db, path), val),
    // read helper (resolves once)
    get:    async (path) => {
      const snap = await get(ref(db, path));
      return snap.exists() ? snap.val() : null;
    },
    // real-time listener (returns unsubscribe fn)
    onValue: (path, cb) => onValue(ref(db, path), (snap) => cb(snap.exists() ? snap.val() : null)),
    // presence helper
    onDisconnectSet: (path, val) => onDisconnect(ref(db, path)).set(val),
    // server timestamp
    serverTimestamp,
    // server-aligned clock: Date.now() corrected by the measured offset to
    // Firebase's server, so every client agrees on "now". Falls back to a
    // plain local clock (offset 0) until the first offset reading arrives.
    serverNow: () => Date.now() + _serverOffset,
    serverTimeOffset: () => _serverOffset,
    // auth object (for identity.js)
    auth,
    signInAnonymously: () => signInAnonymously(auth),
    onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
  };

  return _cached;
}
