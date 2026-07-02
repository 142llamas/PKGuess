/**
 * @file        docs/js/lib/identity-ui.js
 * @version     1.0.0
 * @updated     2026-06-28
 * @changelog
 *   1.0.0 — New. Fixes #16: previously the ONLY identity UI in the whole app
 *           was a one-shot toast on first load that called the unchecked
 *           `setName()` — no PIN option was ever surfaced, ANYONE could take
 *           an already-claimed name with zero warning, and once dismissed the
 *           toast never came back (no way to later protect or re-link a
 *           name). This module is the real, persistent identity UI:
 *             • a small header pill (always visible) showing the current name
 *               that opens a panel to change it, protect it with a PIN, or
 *               re-link a previously-claimed name on a new device;
 *             • name changes are collision-checked against /nameclaims before
 *               being applied — a name already claimed by someone else is
 *               blocked with a clear message, not silently allowed.
 *           Renders as plain HTML/DOM via lib/dom.js — no framework.
 */

import { el, clear } from './dom.js';

/**
 * Render (or re-render) the small always-visible profile pill into `container`.
 * Call again after a name change to refresh the label.
 * @param {HTMLElement} container
 * @param {object} id  the identity object from getIdentity()
 */
export function renderProfilePill(container, id) {
  clear(container);
  const label = id.name ? `\uD83D\uDC64 ${id.name}` : '\uD83D\uDC64 Set your name';
  container.appendChild(el('button', {
    class: 'profile-pill' + (id.name ? '' : ' profile-pill-empty'),
    onClick: () => openIdentityPanel(id, () => renderProfilePill(container, id)),
  }, label));
}

/**
 * Open the identity management modal.
 * @param {object} id  the identity object from getIdentity()
 * @param {() => void} [onChange]  called after any successful name change (so the caller can refresh its own display)
 */
export function openIdentityPanel(id, onChange) {
  if (document.getElementById('identity-panel-overlay')) return; // already open

  const overlay = el('div', { class: 'identity-overlay', id: 'identity-panel-overlay' });
  const panel = el('div', { class: 'identity-panel' });
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  async function render() {
    clear(panel);
    panel.appendChild(el('div', { class: 'identity-panel-head' },
      el('h3', {}, '\uD83C\uDFAE Your Identity'),
      el('button', { class: 'identity-close-btn', onClick: close }, '\u2715')));

    let status = { claimed: false, isMine: false };
    if (id.name) { try { status = await id.getClaimStatus(); } catch { /* offline — show unprotected state */ } }

    panel.appendChild(el('div', { class: 'identity-section' },
      el('div', { class: 'identity-label' }, 'Display name'),
      el('div', { class: 'identity-current-name' }, id.name || '(not set)'),
      status.claimed && status.isMine
        ? el('div', { class: 'identity-status protected' }, '\uD83D\uDD12 Protected by your PIN \u2014 safe to reuse on other devices')
        : id.name
          ? el('div', { class: 'identity-status unprotected' }, '\u26A0\uFE0F Not protected \u2014 anyone else could also use this exact name')
          : null));

    panel.appendChild(nameSection());
    if (id.name && !(status.claimed && status.isMine)) panel.appendChild(claimSection());
    panel.appendChild(reclaimSection());
  }

  function feedbackEl() { return el('div', { class: 'identity-feedback' }); }
  function showFeedback(node, msg, ok) {
    node.textContent = msg;
    node.className = 'identity-feedback ' + (ok ? 'ok' : 'error');
  }

  function nameSection() {
    const input = el('input', { class: 'mp-name-input identity-input', type: 'text', maxlength: '16', placeholder: 'Display name', value: id.name || '' });
    const fb = feedbackEl();
    const btn = el('button', { class: 'btn-primary', style: { marginTop: '8px' } }, id.name ? 'Change name' : 'Save name');
    btn.addEventListener('click', async () => {
      const n = input.value.trim();
      if (!n) { showFeedback(fb, 'Enter a name first.', false); return; }
      btn.disabled = true;
      try {
        const check = await id.checkNameClaim(n);
        if (check.claimed && !check.isMine) {
          showFeedback(fb, `"${n}" is already claimed by someone else. Pick a different name, or use "Re-link a name" below if this is actually you on a new device.`, false);
          return;
        }
        await id.setName(n);
        showFeedback(fb, `\u2705 Name set to "${n}".`, true);
        onChange && onChange();
        await render();
      } catch (e) {
        showFeedback(fb, e.message || 'Could not save your name.', false);
      } finally {
        btn.disabled = false;
      }
    });
    return el('div', { class: 'identity-section' },
      el('div', { class: 'identity-label' }, 'Set or change your name'),
      input, btn, fb);
  }

  function claimSection() {
    const pinInput = el('input', { class: 'mp-name-input identity-input', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '4-digit PIN' });
    const fb = feedbackEl();
    const btn = el('button', { class: 'btn-primary', style: { marginTop: '8px' } }, '\uD83D\uDD12 Protect this name');
    btn.addEventListener('click', async () => {
      if (!id.name) { showFeedback(fb, 'Set a name first.', false); return; }
      const pin = pinInput.value.trim();
      if (!/^\d{4}$/.test(pin)) { showFeedback(fb, 'PIN must be exactly 4 digits.', false); return; }
      btn.disabled = true;
      try {
        await id.claimName(id.name, pin);
        showFeedback(fb, '\u2705 Name protected. Use this name + PIN to re-link on another device.', true);
        onChange && onChange();
        await render();
      } catch (e) {
        showFeedback(fb, e.message || 'Could not protect this name.', false);
      } finally {
        btn.disabled = false;
      }
    });
    return el('div', { class: 'identity-section' },
      el('div', { class: 'identity-label' }, 'Protect your name with a PIN'),
      el('p', { class: 'identity-hint' }, 'Optional, but recommended \u2014 stops anyone else from using this exact name, and lets you bring it with you to another device.'),
      pinInput, btn, fb);
  }

  function reclaimSection() {
    const nameInput = el('input', { class: 'mp-name-input identity-input', type: 'text', maxlength: '16', placeholder: 'Your claimed name' });
    const pinInput = el('input', { class: 'mp-name-input identity-input', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '4-digit PIN', style: { marginTop: '6px' } });
    const fb = feedbackEl();
    const btn = el('button', { class: 'btn-secondary', style: { marginTop: '8px' } }, '\uD83D\uDD01 Re-link this name to this device');
    btn.addEventListener('click', async () => {
      const n = nameInput.value.trim();
      const pin = pinInput.value.trim();
      if (!n || !/^\d{4}$/.test(pin)) { showFeedback(fb, 'Enter your claimed name and its 4-digit PIN.', false); return; }
      btn.disabled = true;
      try {
        await id.reclaimName(n, pin);
        showFeedback(fb, `\u2705 "${n}" is now linked to this device.`, true);
        onChange && onChange();
        await render();
      } catch (e) {
        showFeedback(fb, e.message || 'Could not re-link that name.', false);
      } finally {
        btn.disabled = false;
      }
    });
    return el('div', { class: 'identity-section' },
      el('div', { class: 'identity-label' }, 'Played on another device before?'),
      el('p', { class: 'identity-hint' }, 'Enter a name you\u2019ve previously protected with a PIN to bring it to THIS device (e.g. after clearing your browser, or on a new phone).'),
      nameInput, pinInput, btn, fb);
  }

  render();
}
