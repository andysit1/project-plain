// Minimal DOM stub for exercising frontend/graph/index.js and info_window.js under `node --test`.
// No jsdom dependency: just enough of the Element/Document surface those two files touch.

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.textContent = ''
    this.hidden = false
    this.dataset = {}
    this.onclick = null
    this._listeners = {}
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn)
  }

  removeEventListener(type, fn) {
    if (!this._listeners[type]) return
    this._listeners[type] = this._listeners[type].filter(f => f !== fn)
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  replaceChildren(...nodes) {
    this.children = nodes
  }

  setAttribute(name, value) {
    if (name === 'data-id') this.dataset.id = value
    else this[name] = value
  }

  click() {
    for (const fn of this._listeners.click || []) fn()
    this.onclick?.()
  }
}

// Every id from shared/dom.md (plus the close button index.html also declares).
const KNOWN_IDS = [
  'canvas', 'status-conn', 'status-counts', 'status-rebuild', 'files-mode-notice',
  'inspector', 'inspector-close', 'inspector-name', 'inspector-sig', 'inspector-loc',
  'inspector-callers', 'inspector-callees', 'open-in-editor',
]

/** Creates a fresh fake `document` plus a lookup of its pre-seeded elements. */
export function createFakeDom() {
  const elements = new Map()
  for (const id of KNOWN_IDS) elements.set(id, new FakeElement(id === 'canvas' ? 'canvas' : 'div'))
  elements.get('inspector').hidden = true
  elements.get('files-mode-notice').hidden = true

  const doc = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
  }

  return { doc, elements }
}

export { FakeElement }
