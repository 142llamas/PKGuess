/**
 * @file        docs/js/lib/dom.js
 * @version     1.0.0
 * @updated     2026-06-23
 * @changelog
 *   1.0.0 — Initial shared DOM helpers for the modular build. `el()` is the
 *           single element factory every mode and the shell use; the tiny
 *           helpers (clear, mount, on) de-duplicate boilerplate that the
 *           canonical HTML repeated in every screen.
 * ---------------------------------------------------------------------------
 * Pure, framework-free DOM helpers. No global state, no side effects on import.
 */

/**
 * Create an element.
 *   el('div')                                  -> <div>
 *   el('button', { class:'x', onClick:fn }, 'Go')
 *   el('ul', {}, el('li', {}, 'a'), el('li', {}, 'b'))
 *
 * attrs handling:
 *   - 'class' / 'className'      -> className
 *   - 'dataset'  (object)        -> data-* attributes
 *   - 'style'    (object)        -> inline styles
 *   - onXxx (function)           -> addEventListener('xxx', fn)
 *   - boolean true               -> bare attribute (e.g. disabled:true)
 *   - boolean false / null / undefined -> attribute omitted
 *   - anything else              -> setAttribute(key, value)
 *
 * children: strings/numbers become text nodes; nullish children are skipped;
 * arrays are flattened so callers can spread mapped lists.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) {
        if (dv != null) node.dataset[dk] = dv;
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value; // caller is responsible for trusted content
    } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Remove all children of a node. Returns the node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Clear `target` and append `content` (a node or array of nodes). Returns target. */
export function mount(target, content) {
  clear(target);
  appendChildren(target, Array.isArray(content) ? content : [content]);
  return target;
}

/** Add a listener and return a disposer, so controllers can clean up in destroy(). */
export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}
