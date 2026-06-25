/**
 * @file        js/lib/firebase.js
 * @version     1.0.0
 * @updated     2026-06-24
 * @changelog
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
    // auth object (for identity.js)
    auth,
    signInAnonymously: () => signInAnonymously(auth),
    onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
  };

  return _cached;
}
