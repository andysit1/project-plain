// Minimal browser stubs so the canvas modules can be exercised under `node --test`.
// Importing this module installs the globals; import it BEFORE any module under test.

const elements = new Map()

export function fakeCtx () {
    const calls = []
    const record = name => (...args) => { calls.push([name, ...args]) }
    return {
        calls,
        setTransform: record('setTransform'),
        fillRect: record('fillRect'),
        beginPath: record('beginPath'),
        moveTo: record('moveTo'),
        lineTo: record('lineTo'),
        quadraticCurveTo: record('quadraticCurveTo'),
        closePath: record('closePath'),
        stroke: record('stroke'),
        fill: record('fill'),
        fillText: record('fillText'),
        // deterministic 6px-per-character metrics, enough to drive fitText
        measureText: (text) => ({ width: String(text).length * 6 })
    }
}

export function fakeCanvas ({ width = 800, height = 600, left = 0, top = 0 } = {}) {
    const ctx = fakeCtx()
    const captured = new Set()
    return {
        ctx,
        captured,
        clientWidth: width,
        clientHeight: height,
        width,
        height,
        style: {},
        listeners: {},
        getContext: () => ctx,
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height
        }),
        addEventListener (type, fn) { (this.listeners[type] ||= []).push(fn) },
        setPointerCapture (id) { captured.add(id) },
        releasePointerCapture (id) { captured.delete(id) },
        hasPointerCapture (id) { return captured.has(id) }
    }
}

export function setElement (id, el) { elements.set(id, el); return el }
export function getElement (id) { return elements.get(id) }
export function resetElements () {
    elements.clear()
    setElement('textOverlay', { innerHTML: '' })
    setElement('node-id', { value: '' })
    setElement('node-name', { value: '' })
}

// A floating panel like the real #mydiv properties window, in screen coordinates.
export function setPanel ({ left, top, width, height }) {
    return setElement('mydiv', {
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height
        })
    })
}

// requestAnimationFrame stores the callback instead of running it, so constructing a
// Graph does not start an endless render loop inside the test process.
export const frameQueue = []

globalThis.window = globalThis.window || {}
globalThis.window.devicePixelRatio = 1
globalThis.requestAnimationFrame = (fn) => { frameQueue.push(fn); return frameQueue.length }
globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: (selector) => {
        if (!selector.startsWith('#')) { return [] }
        const el = elements.get(selector.slice(1))
        return el ? [el] : []
    },
    addEventListener: () => {}
}

resetElements()

// A pointer/wheel event shaped the way the Graph handlers read it.
export function pointerEvent (x, y, extra = {}) {
    return { clientX: x, clientY: y, pointerId: 1, preventDefault () {}, ...extra }
}
