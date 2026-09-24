// Minimal fake canvas/ctx + fake Drawables for exercising Graph and applyCeiling under
// `node --test`, without needing a real DOM or rAF loop. Import order doesn't matter here:
// Graph only touches `window`/`requestAnimationFrame` defensively (typeof checks), so we don't
// need to install globals the way frontend/graph/tests/helpers/dom-stub.js does for the old code.

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
        stroke: record('stroke'),
        fill: record('fill'),
        fillText: record('fillText'),
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

// A pointer/wheel event shaped the way Graph's handlers read it.
export function pointerEvent (x, y, extra = {}) {
    return { clientX: x, clientY: y, pointerId: 1, preventDefault () {}, ...extra }
}

export function wheelEvent (x, y, deltaY) {
    return { clientX: x, clientY: y, deltaY, preventDefault () {} }
}

export function fire (canvas, type, event) {
    for (const fn of canvas.listeners[type] || []) { fn(event) }
}

// A stand-in for T6's CodeNode / T7's FolderGroup / T8's CallEdge: anything with bounds()+draw().
export function fakeNode ({ id, x, y, w = 20, h = 20, selected = false, data = {} }) {
    return {
        id,
        data,
        selected,
        x, y, w, h,
        bounds () { return { x: this.x, y: this.y, w: this.w, h: this.h } },
        hitTest (px, py) {
            return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h
        },
        moveTo (nx, ny) { this.x = nx; this.y = ny },
        isAnimating () { return false },
        draw (ctx) { ctx.fillRect(this.x, this.y, this.w, this.h) }
    }
}

export function fakeEdge ({ id, from, to, x, y, w = 20, h = 20 }) {
    return {
        id,
        data: { from, to },
        highlight: false,
        bounds () { return { x, y, w, h } },
        draw (ctx) { ctx.stroke() }
    }
}

export function fakeGroup ({ id, x, y, w, h }) {
    return {
        id,
        bounds () { return { x, y, w, h } },
        draw (ctx) { ctx.fillRect(x, y, w, h) }
    }
}
