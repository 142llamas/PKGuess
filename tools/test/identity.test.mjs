/**
 * @file tools/test/identity.test.mjs 
 * @version 1.0.0
 * Unit tests for docs/js/lib/identity.js (#16): name claim / collision
 * detection / cross-device reclaim. Uses a fake in-memory Firebase (async
 * auth + a tiny key-value db) injected via getIdentity({firebase}) — see
 * identity.js's _resetIdentityCacheForTests / firebase-override, added
 * specifically so this pure-ish logic could be tested without a real
 * Firebase project, matching the SPEC §1.6 "pure logic is unit-tested" rule.
 */
import { _resetIdentityCacheForTests, getIdentity } from '../../docs/js/lib/identity.js';

// ---- fake Firebase (auth + tiny key-value db) ------------------------------
function makeFakeFirebase(uid, sharedTree) {
  const tree = sharedTree || {};
  const parts = (p) => p.split('/').filter(Boolean);
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  function snap(path) { let n = tree; for (const k of parts(path)) { if (n == null) return null; n = n[k]; } return clone(n); }
  function setDeep(path, val) {
    const ks = parts(path); let n = tree;
    for (let i = 0; i < ks.length - 1; i++) { if (typeof n[ks[i]] !== 'object' || n[ks[i]] == null) n[ks[i]] = {}; n = n[ks[i]]; }
    n[ks[ks.length - 1]] = clone(val);
  }
  return {
    // Real Firebase's onAuthStateChanged always fires on a later tick, never
    // synchronously — identity.js's `const unsub = onAuthStateChanged(cb)`
    // pattern relies on that, so the fake must match it.
    onAuthStateChanged(cb) { Promise.resolve().then(() => cb(null)); return () => {}; },
    async signInAnonymously() { return { user: { uid } }; },
    async get(p) { return snap(p); },
    async set(p, v) { setDeep(p, v); return true; },
    async update(p, o) { const cur = snap(p) || {}; setDeep(p, { ...cur, ...o }); return true; },
  };
}

async function freshIdentity(uid, sharedTree) {
  _resetIdentityCacheForTests();
  return getIdentity({ firebase: makeFakeFirebase(uid, sharedTree) });
}

export default async function (t) {
  t.section('identity.js — setName: basic rename works');
  {
    const id = await freshIdentity('uidA');
    t.eq(id.name, '', 'starts with no name');
    await id.setName('Ash');
    t.eq(id.name, 'Ash', 'name updated after setName');
  }

  t.section('identity.js — checkNameClaim: unclaimed name reports claimed:false');
  {
    const id = await freshIdentity('uidB');
    const status = await id.checkNameClaim('NobodyHasThisName');
    t.eq(status.claimed, false, 'an unclaimed name is not reported as claimed');
    t.eq(status.isMine, false, 'isMine is false for an unclaimed name');
  }

  t.section('identity.js — claimName: protects a name; checkNameClaim reflects it (#16)');
  {
    const shared = {};
    const id = await freshIdentity('uidC', shared);
    await id.setName('KevDawg');
    await id.claimName('KevDawg', '1234');
    const status = await id.checkNameClaim('KevDawg');
    t.eq(status.claimed, true, 'the name is now reported as claimed');
    t.eq(status.isMine, true, 'isMine is true for the claiming identity');
    const my = await id.getClaimStatus();
    t.eq(my.claimed, true, 'getClaimStatus reflects the current name\u2019s claim');
    t.eq(my.isMine, true, 'getClaimStatus: isMine true for the owner');
  }

  t.section('identity.js — claimName: a SECOND identity cannot claim an already-claimed name (#16)');
  {
    const shared = {};
    const idA = await freshIdentity('uidD', shared);
    await idA.setName('KevDawg');
    await idA.claimName('KevDawg', '1234');

    const idB = await freshIdentity('uidE', shared);
    let threw = false, msg = '';
    try { await idB.claimName('KevDawg', '9999'); } catch (e) { threw = true; msg = e.message; }
    t.ok(threw, 'claiming a name already claimed by someone else throws');
    t.ok(/already claimed/i.test(msg), `error message explains why (got: "${msg}")`);

    const statusForB = await idB.checkNameClaim('KevDawg');
    t.eq(statusForB.claimed, true, 'B sees the name as claimed');
    t.eq(statusForB.isMine, false, 'B correctly sees isMine=false (it is NOT their claim)');
  }

  t.section('identity.js — reclaimName: the SAME human can re-link name+PIN on a new device (#16)');
  {
    const shared = {};
    const device1 = await freshIdentity('uidF-device1', shared);
    await device1.setName('KevDawg');
    await device1.claimName('KevDawg', '4242');

    // Simulate a brand-new device: fresh uid, no local knowledge of the claim.
    const device2 = await freshIdentity('uidF-device2', shared);
    t.eq(device2.name, '', 'a fresh identity on a new device starts with no name');
    await device2.reclaimName('KevDawg', '4242');
    t.eq(device2.name, 'KevDawg', 'reclaimName re-links the name on the new device');
    const status = await device2.checkNameClaim('KevDawg');
    t.eq(status.isMine, true, 'the new device is now recognized as the rightful owner');
  }

  t.section('identity.js — reclaimName: wrong PIN is rejected (#16)');
  {
    const shared = {};
    const device1 = await freshIdentity('uidG-device1', shared);
    await device1.setName('Misty');
    await device1.claimName('Misty', '1111');

    const device2 = await freshIdentity('uidG-device2', shared);
    let threw = false, msg = '';
    try { await device2.reclaimName('Misty', '0000'); } catch (e) { threw = true; msg = e.message; }
    t.ok(threw, 'reclaiming with the WRONG pin throws');
    t.ok(/pin/i.test(msg), `error message mentions the PIN (got: "${msg}")`);
    t.eq(device2.name, '', 'the wrong-PIN device never got the name');
  }

  t.section('identity.js — claimName: re-claiming your OWN already-claimed name is idempotent');
  {
    const shared = {};
    const id = await freshIdentity('uidH', shared);
    await id.setName('Brock');
    await id.claimName('Brock', '5555');
    let threw = false;
    try { await id.claimName('Brock', '5555'); } catch { threw = true; }
    t.ok(!threw, 're-claiming your own name with the same PIN does not throw');
  }
}
