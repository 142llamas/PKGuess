/**
 * @file        js/lib/identity.js
 * @version     1.1.0
 * @updated     2026-06-24
 * @changelog
 *   1.1.0 — checkNameClaim()/getClaimStatus() so the UI can warn before letting a name collide with someone else’s PIN claim (#16). getIdentity() accepts an optional {firebase} override + _resetIdentityCacheForTests() for unit testing.
 *   1.0.0 — Anonymous Firebase Auth + persistent display name + optional 4-digit
 *           PIN name-claim for cross-device re-linking (SPEC §9).
 *           • Anonymous sign-in fires automatically on first call; uid is stable
 *             for the life of the browser profile (or until cleared).
 *           • Display name stored at /players/{uid} = { name, createdAt }.
 *           • Claim: /nameclaims/{nameLower} = { uid, pinHash } — lets the same
 *             human re-link their name on a new device by entering name+PIN.
 *           • One-attempt daily key uses uid, resolved here (SPEC §9 "one attempt
 *             per identity").
 *
 * Usage:  const id = await getIdentity();
 *         console.log(id.uid, id.name);
 *         await id.setName('Ash');
 *         await id.claimName('Ash', '1234');   // set pin-claim
 *         await id.reclaimName('Ash', '1234'); // re-link on new device
 */

import { getFirebase } from './firebase.js';

const STORAGE_KEY = 'pokeGuess_identity';

// Cheap non-cryptographic hash sufficient for a 4-digit PIN anti-squatting guard
function hashPin(name, pin) {
  const s = name.toLowerCase() + '|' + pin;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

let _cached = null;

/**
 * TEST-ONLY. Clears the module-level identity cache so a test can simulate a
 * second distinct identity (e.g. a different uid) in the same process. Real
 * app code never calls this — one identity per browser session is correct.
 */
export function _resetIdentityCacheForTests() { _cached = null; }

export async function getIdentity(opts = {}) {
  if (_cached) return _cached;

  const fb = opts.firebase || await getFirebase();

  // Sign in anonymously (idempotent — returns existing user if already signed in)
  const user = await new Promise((resolve) => {
    const unsub = fb.onAuthStateChanged((u) => {
      unsub();
      if (u) { resolve(u); return; }
      fb.signInAnonymously().then((cred) => resolve(cred.user));
    });
  });

  const uid = user.uid;

  // Load or create player record
  let playerRec = await fb.get(`/players/${uid}`);
  if (!playerRec) {
    const createdAt = Date.now();
    playerRec = { name: '', createdAt };
    await fb.set(`/players/${uid}`, playerRec);
  }

  // Also cache name locally so it's instant on reload
  const localName = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').name || ''; } catch { return ''; }
  };
  const saveName = (n) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ uid, name: n })); } catch { /* ignore */ }
  };

  const name = () => playerRec.name || localName() || '';

  const identity = {
    uid,
    get name() { return name(); },

    /** Update the display name (no PIN — simple rename). */
    async setName(newName) {
      const n = String(newName || '').trim().slice(0, 16);
      if (!n) throw new Error('Name cannot be empty');
      await fb.set(`/players/${uid}`, { ...playerRec, name: n });
      playerRec = { ...playerRec, name: n };
      saveName(n);
    },

    /** Create a PIN-protected name claim so this name can be re-linked later. */
    async claimName(name, pin) {
      const n = String(name || '').trim().slice(0, 16);
      const p = String(pin || '').trim();
      if (!n) throw new Error('Name required');
      if (!/^\d{4}$/.test(p)) throw new Error('PIN must be exactly 4 digits');
      const key = n.toLowerCase().replace(/\s+/g, '');
      const existing = await fb.get(`/nameclaims/${key}`);
      if (existing && existing.uid !== uid) throw new Error('That name is already claimed by someone else');
      const pinHash = hashPin(n, p);
      await fb.set(`/nameclaims/${key}`, { uid, pinHash });
      await identity.setName(n);
    },

    /**
     * Look up whether `name` is currently claimed by anyone, WITHOUT exposing
     * the PIN hash (#16). Callers use this before letting a player set a name
     * outright, so a name already protected by someone else's PIN can't be
     * silently reused by a second person.
     * @returns {{claimed:boolean, isMine:boolean}}
     */
    async checkNameClaim(name) {
      const n = String(name || '').trim().slice(0, 16);
      if (!n) return { claimed: false, isMine: false };
      const key = n.toLowerCase().replace(/\s+/g, '');
      let claim = null;
      try { claim = await fb.get(`/nameclaims/${key}`); } catch { return { claimed: false, isMine: false }; }
      if (!claim) return { claimed: false, isMine: false };
      return { claimed: true, isMine: claim.uid === uid };
    },

    /** Re-link a claimed name on a new device using name + PIN. */
    async reclaimName(name, pin) {
      const n = String(name || '').trim().slice(0, 16);
      const p = String(pin || '').trim();
      if (!n || !/^\d{4}$/.test(p)) throw new Error('Name and 4-digit PIN required');
      const key = n.toLowerCase().replace(/\s+/g, '');
      const claim = await fb.get(`/nameclaims/${key}`);
      if (!claim) throw new Error('No claim found for that name');
      if (claim.pinHash !== hashPin(n, p)) throw new Error('Incorrect PIN');
      // Transfer claim to this device's uid
      await fb.set(`/nameclaims/${key}`, { uid, pinHash: claim.pinHash });
      await fb.set(`/players/${uid}`, { name: n, createdAt: Date.now() });
      playerRec = { ...playerRec, name: n };
      saveName(n);
    },

    /** Is the CURRENT name protected by a PIN, and is it protected by ME? */
    async getClaimStatus() {
      return identity.checkNameClaim(name());
    },
  };

  _cached = identity;
  return identity;
}
