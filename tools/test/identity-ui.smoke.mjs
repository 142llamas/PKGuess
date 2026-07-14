// identity-ui.js render/interaction smoke (#16). Exercises the real DOM panel
// against a fake identity object (mirrors identity.js's real async contract).
// Run: node tools/test/identity-ui.smoke.mjs
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://e.com/' });
const { window } = dom;
global.window = window; global.document = window.document;
for (const k of ['navigator', 'Node', 'HTMLElement', 'MouseEvent']) try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch {}
global.setTimeout = (f) => { try { f(); } catch {} return 0; };

const tick = () => new Promise((r) => { let i = 0; const t = () => (i++ < 6 ? Promise.resolve().then(t) : r()); t(); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const click = (n) => n && n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const { renderProfilePill, openIdentityPanel } = await import('../../docs/js/lib/identity-ui.js');

// A fake identity mirroring identity.js's real contract (name getter,
// setName/claimName/reclaimName/checkNameClaim/getClaimStatus).
function makeFakeIdentity({ name = '', claims = {} } = {}) {
  let _name = name;
  const uid = 'test-uid';
  return {
    get name() { return _name; },
    async setName(n) { _name = n; },
    async checkNameClaim(n) {
      const c = claims[n.toLowerCase()];
      if (!c) return { claimed: false, isMine: false };
      return { claimed: true, isMine: c.uid === uid };
    },
    async getClaimStatus() { return this.checkNameClaim(_name); },
    async claimName(n, pin) {
      const key = n.toLowerCase();
      if (claims[key] && claims[key].uid !== uid) throw new Error('That name is already claimed by someone else');
      claims[key] = { uid, pin };
      _name = n;
    },
    async reclaimName(n, pin) {
      const key = n.toLowerCase();
      const c = claims[key];
      if (!c) throw new Error('No claim found for that name');
      if (c.pin !== pin) throw new Error('Incorrect PIN');
      claims[key] = { uid, pin };
      _name = n;
    },
  };
}

console.log('— Profile pill: shows a nudge when no name is set, opens the panel —');
{
  const slot = window.document.createElement('div'); window.document.body.appendChild(slot);
  const id = makeFakeIdentity();
  renderProfilePill(slot, id);
  const pill = slot.querySelector('.profile-pill');
  ok(!!pill, 'pill renders');
  ok(pill.classList.contains('profile-pill-empty'), 'pill shows the "empty" nudge state when no name is set');
  click(pill);
  await tick();
  ok(!!window.document.getElementById('identity-panel-overlay'), 'clicking the pill opens the identity panel');
  window.document.getElementById('identity-panel-overlay')?.remove();
}

console.log('— Setting a name updates the pill (via onChange) —');
{
  const slot = window.document.createElement('div'); window.document.body.appendChild(slot);
  const id = makeFakeIdentity();
  renderProfilePill(slot, id);
  click(slot.querySelector('.profile-pill'));
  await tick();
  const panel = window.document.getElementById('identity-panel-overlay');
  const input = panel.querySelector('.identity-input[type="text"]');
  input.value = 'Ash';
  const saveBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Save name'));
  ok(!!saveBtn, 'Save name button present for a nameless identity');
  click(saveBtn);
  await tick();
  ok(id.name === 'Ash', 'setName was actually called with the typed value');
  ok(slot.querySelector('.profile-pill').textContent.includes('Ash'), 'the pill refreshes to show the new name');
  window.document.getElementById('identity-panel-overlay')?.remove();
}

console.log('— Claiming a name shows the protected status —');
{
  const slot = window.document.createElement('div'); window.document.body.appendChild(slot);
  const id = makeFakeIdentity({ name: 'Misty' });
  openIdentityPanel(id, () => renderProfilePill(slot, id));
  await tick();
  const panel = window.document.getElementById('identity-panel-overlay');
  const pinInput = [...panel.querySelectorAll('.identity-input')].find((i) => i.placeholder.includes('PIN'));
  pinInput.value = '1234';
  const claimBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Protect this name'));
  ok(!!claimBtn, 'Protect-this-name button present for an unclaimed name');
  click(claimBtn);
  await tick();
  ok(panel.textContent.includes('Protected by your PIN'), 'panel now shows the protected status after claiming');
  window.document.getElementById('identity-panel-overlay')?.remove();
}

console.log('— Trying to take an already-claimed name is blocked with a clear message —');
{
  const claims = { kevdawg: { uid: 'someone-else', pin: '0000' } };
  const slot = window.document.createElement('div'); window.document.body.appendChild(slot);
  const id = makeFakeIdentity({ name: '', claims });
  openIdentityPanel(id, () => renderProfilePill(slot, id));
  await tick();
  const panel = window.document.getElementById('identity-panel-overlay');
  const nameInput = panel.querySelector('.identity-input[type="text"]');
  nameInput.value = 'KevDawg';
  const saveBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Save name'));
  click(saveBtn);
  await tick();
  ok(id.name === '', 'the name was NOT applied (setName never called through)');
  ok(panel.textContent.includes('already claimed'), 'a clear "already claimed" message is shown instead of silently allowing it (#16)');
  window.document.getElementById('identity-panel-overlay')?.remove();
}

console.log('— Re-linking on a "new device" with the right PIN works —');
{
  const claims = { pikachu: { uid: 'device-1', pin: '4242' } };
  const slot = window.document.createElement('div'); window.document.body.appendChild(slot);
  const id = makeFakeIdentity({ name: '', claims }); // fresh identity = "new device"
  openIdentityPanel(id, () => renderProfilePill(slot, id));
  await tick();
  const panel = window.document.getElementById('identity-panel-overlay');
  const inputs = [...panel.querySelectorAll('.identity-input')];
  const nameInput = inputs.find((i) => i.placeholder === 'Your claimed name');
  const reclaimSectionEl = nameInput.closest('.identity-section');
  const pinInput = [...reclaimSectionEl.querySelectorAll('.identity-input')].find((i) => i.placeholder.includes('PIN'));
  nameInput.value = 'Pikachu';
  pinInput.value = '4242';
  const relinkBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('Re-link'));
  ok(!!relinkBtn, 'Re-link button present');
  click(relinkBtn);
  await tick();
  ok(id.name === 'Pikachu', 'reclaimName was called and the name is now applied');
  window.document.getElementById('identity-panel-overlay')?.remove();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
