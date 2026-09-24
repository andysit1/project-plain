// Canvas host: fixed camera, HiDPI, pan/zoom, picking, drag, culling and repaint scheduling.
// Draws whatever Drawables (groups, edges, nodes) are handed to it via setScene(); it has no
// opinion about what a node or edge *is* — that's T6/T7/T8. Selection/move/camera notifications
// go out through subscriber callbacks (onSelect/onMove/onCamera) instead of touching the DOM
// directly, so T10 (the app shell) owns the inspector wiring.

import { GRID, CULL_MARGIN, LABEL_MIN_ZOOM, DIM_ALPHA } from '../../../shared/contracts.js'

const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag
const CAMERA_DEBOUNCE_MS = 300

const snap = v => Math.round(v / GRID) * GRID

// axis-aligned rect intersection, both args {x,y,w,h}
function rectsIntersect (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

class Graph {
    constructor (canvas) {
        this.canvas = canvas
        this.width = canvas.width
        this.height = canvas.height
        this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1

        this.scene = { groups: [], edges: [], nodes: [] }
        this.selectedId = null
        this.highlightIds = null // Set<id> drawn at full strength; everything else at DIM_ALPHA

        // camera: screen = world * k + (x, y). Lets nodes live anywhere, not just on-screen.
        this.camera = { x: 0, y: 0, k: 1 }

        this.drag = null
        this.pan = null
        this.dirty = true
        this.stats = { drawCalls: 0 }

        this._selectCbs = new Set()
        this._moveCbs = new Set()
        this._cameraCbs = new Set()
        this._activateCbs = new Set()
        this._cameraTimer = null

        this.subscribeEvents()
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => this.animation())
        }
    }

    // ---------------------------------------------------------------- scene

    // Keeps the current selection alive across a scene swap when the same id still exists.
    setScene (scene) {
        const groups = (scene && scene.groups) || []
        const edges = (scene && scene.edges) || []
        const nodes = (scene && scene.nodes) || []
        this.scene = { groups, edges, nodes }

        const keep = this.selectedId != null ? nodes.find(n => n.id === this.selectedId) : null
        this.applySelection(keep || null)
        this.applyHighlight()
        this.dirty = true
    }

    // ---------------------------------------------------------------- highlight (drill-down)

    // ids (iterable) = nodes to draw at full strength, plus every edge touching one of them;
    // the rest is drawn at DIM_ALPHA. null clears it. Survives setScene (ids are re-applied).
    setHighlight (ids) {
        this.highlightIds = ids ? new Set(ids) : null
        this.applyHighlight()
    }

    highlighted () { return this.highlightIds ? [...this.highlightIds] : [] }

    applyHighlight () {
        const set = this.highlightIds
        for (const n of this.scene.nodes) { n.dimmed = !!set && !set.has(n.id) }
        for (const e of this.scene.edges) {
            const d = e.data || {}
            e.dimmed = !!set && !(set.has(d.from) || set.has(d.to))
        }
        for (const g of this.scene.groups) { g.dimmed = !!set }
        this.dirty = true
    }

    // ---------------------------------------------------------------- camera

    setCamera ({ x, y, k }) {
        this.camera = { x, y, k }
        this.dirty = true
        this.scheduleCameraNotify()
    }

    onCamera (cb) { this._cameraCbs.add(cb); return () => this._cameraCbs.delete(cb) }

    scheduleCameraNotify () {
        if (this._cameraTimer) { clearTimeout(this._cameraTimer) }
        this._cameraTimer = setTimeout(() => {
            this._cameraTimer = null
            const c = { ...this.camera }
            for (const cb of this._cameraCbs) { cb(c) }
        }, CAMERA_DEBOUNCE_MS)
    }

    // World-space point at the middle of the visible canvas.
    viewCenter () {
        return this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 })
    }

    screenToWorld (p) {
        const c = this.camera
        return { x: (p.x - c.x) / c.k, y: (p.y - c.y) / c.k }
    }

    // Fits every drawable's bounds() (plus a screen-px margin) into the canvas.
    fitToContent (margin = 40) {
        this.fitTo([...this.scene.groups, ...this.scene.nodes, ...this.scene.edges], margin)
    }

    // Fits only the nodes with these ids; returns false (camera untouched) when none exist.
    fitToIds (ids, { margin = 60, maxK = 1.5 } = {}) {
        const set = new Set(ids)
        const list = this.scene.nodes.filter(n => set.has(n.id))
        if (!list.length) { return false }
        this.fitTo(list, margin, maxK)
        return true
    }

    fitTo (all, margin = 40, maxK = 3) {
        if (all.length === 0) { return }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const d of all) {
            const b = d.bounds()
            minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
            maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
        }
        const w = Math.max(1, maxX - minX)
        const h = Math.max(1, maxY - minY)
        const cw = this.canvas.clientWidth
        const ch = this.canvas.clientHeight

        let k = Math.min((cw - 2 * margin) / w, (ch - 2 * margin) / h)
        k = Math.max(0.2, Math.min(maxK, k))

        const cx = minX + w / 2
        const cy = minY + h / 2
        const x = cw / 2 - cx * k
        const y = ch / 2 - cy * k
        this.setCamera({ x, y, k })
    }

    // ---------------------------------------------------------------- selection / picking

    onSelect (cb) { this._selectCbs.add(cb); return () => this._selectCbs.delete(cb) }
    onMove (cb) { this._moveCbs.add(cb); return () => this._moveCbs.delete(cb) }
    // double-click on a node: cb(node, { altKey })
    onActivate (cb) { this._activateCbs.add(cb); return () => this._activateCbs.delete(cb) }

    select (id) {
        const node = this.scene.nodes.find(n => n.id === id) || null
        this.applySelection(node)
    }

    // Sets node.selected / edge.highlight to match `node` (or clears everything on null),
    // firing onSelect subscribers only when the selected id actually changes.
    // info.pointer = true when a mouse press made the selection (it may be the first half of a
    // double-click), so subscribers can defer UI that would cover the spot under the cursor.
    applySelection (node, info = {}) {
        const newId = node ? node.id : null
        for (const n of this.scene.nodes) { n.selected = (n === node) }
        for (const e of this.scene.edges) {
            const d = e.data || {}
            e.highlight = !!node && (d.from === newId || d.to === newId)
        }
        const changed = newId !== this.selectedId
        this.selectedId = newId
        this.dirty = true
        if (changed) { for (const cb of this._selectCbs) { cb(node || null, info) } }
    }

    // topmost node under a world point (last drawn wins, matching what the user sees)
    nodeAt (x, y) {
        const nodes = this.scene.nodes
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (nodes[i].hitTest(x, y)) { return nodes[i] }
        }
        return null
    }

    // ---------------------------------------------------------------- dom events

    subscribeEvents () {
        this.canvas.style.touchAction = 'none'
        this.canvas.addEventListener('pointermove', e => this.onMouseMove(e))
        this.canvas.addEventListener('pointerup', e => this.onMouseUp(e))
        this.canvas.addEventListener('pointercancel', e => this.onMouseUp(e))
        this.canvas.addEventListener('pointerdown', e => this.onMouseDown(e))
        this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false })
        this.canvas.addEventListener('dblclick', e => this.onDoubleClick(e))
    }

    onDoubleClick (event) {
        event.preventDefault?.()
        const { x, y } = this.screenToWorld(this.eventPos(event))
        const node = this.nodeAt(x, y)
        if (!node) { return }
        for (const cb of this._activateCbs) { cb(node, { altKey: !!event.altKey }) }
    }

    // pointer position relative to the canvas, in screen pixels
    eventPos (event) {
        const rect = this.canvas.getBoundingClientRect()
        return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    onMouseDown (event) {
        event.preventDefault()
        this.canvas.setPointerCapture?.(event.pointerId)
        const screen = this.eventPos(event)
        const { x, y } = this.screenToWorld(screen)

        const node = this.nodeAt(x, y)
        if (!node) {
            // empty space: start panning; a click without movement deselects on release
            this.pan = { sx: screen.x, sy: screen.y, camX: this.camera.x, camY: this.camera.y }
            return
        }

        this.applySelection(node, { pointer: true })

        // bring the grabbed node to the front so it draws over what it's dragged across
        const i = this.scene.nodes.indexOf(node)
        if (i !== -1) { this.scene.nodes.splice(i, 1); this.scene.nodes.push(node) }

        const b = node.bounds()
        this.drag = {
            node,
            startX: b.x,
            startY: b.y,
            lastX: b.x,
            lastY: b.y,
            mouseX: x,
            mouseY: y,
            sx: screen.x,
            sy: screen.y,
            moved: false
        }
    }

    onMouseMove (event) {
        event.preventDefault()
        const screen = this.eventPos(event)
        const { x, y } = this.screenToWorld(screen)

        if (this.pan) {
            this.camera.x = this.pan.camX + screen.x - this.pan.sx
            this.camera.y = this.pan.camY + screen.y - this.pan.sy
            this.dirty = true
            this.scheduleCameraNotify()
            return
        }
        this.updateDrag(x, y, screen)
    }

    updateDrag (x, y, screen) {
        if (!this.drag) { return }
        if (!this.drag.moved && Math.hypot(screen.x - this.drag.sx, screen.y - this.drag.sy) < DRAG_THRESHOLD) { return }
        this.drag.moved = true

        const nx = x - this.drag.mouseX + this.drag.startX
        const ny = y - this.drag.mouseY + this.drag.startY
        this.drag.lastX = nx
        this.drag.lastY = ny
        this.drag.node.moveTo(nx, ny)
        this.dirty = true
    }

    onMouseUp (event) {
        event.preventDefault()
        if (this.canvas.hasPointerCapture?.(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId)
        }
        if (this.pan) {
            const screen = this.eventPos(event)
            const clicked = Math.hypot(screen.x - this.pan.sx, screen.y - this.pan.sy) < DRAG_THRESHOLD
            this.pan = null
            if (clicked) { this.applySelection(null) }
            return
        }
        if (this.drag?.moved) {
            // snap to the grid so hand-placed layouts line up
            const node = this.drag.node
            const sx = snap(this.drag.lastX)
            const sy = snap(this.drag.lastY)
            node.moveTo(sx, sy)
            this.dirty = true
            for (const cb of this._moveCbs) { cb(node, { x: sx, y: sy }) }
        }
        this.drag = null
    }

    onWheel (event) {
        event.preventDefault()
        const screen = this.eventPos(event)
        const c = this.camera
        const k = Math.min(3, Math.max(0.2, c.k * Math.exp(-event.deltaY * 0.0015)))
        // zoom around the cursor
        c.x = screen.x - ((screen.x - c.x) * k) / c.k
        c.y = screen.y - ((screen.y - c.y) * k) / c.k
        c.k = k
        this.dirty = true
        this.scheduleCameraNotify()
    }

    // ---------------------------------------------------------------- render loop

    needsRepaint (now) {
        if (this.dirty) { return true }
        if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) { return true }
        return this.scene.nodes.some(n => typeof n.isAnimating === 'function' && n.isAnimating(now))
    }

    // Drives one frame synchronously (no rAF needed), for tests and the real render loop alike.
    renderFrame (now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
        if (!this.needsRepaint(now)) { return }
        this.dirty = false
        try {
            this.drawScene()
        } catch (err) {
            console.error('drawScene failed', err) // never let one bad frame kill the loop
        }
    }

    animation () {
        this.renderFrame()
        requestAnimationFrame(() => this.animation())
    }

    // world rect currently on screen, expanded by CULL_MARGIN
    visibleWorldRect () {
        const a = this.screenToWorld({ x: 0, y: 0 })
        const b = this.screenToWorld({ x: this.canvas.clientWidth, y: this.canvas.clientHeight })
        return {
            x: a.x - CULL_MARGIN,
            y: a.y - CULL_MARGIN,
            w: (b.x - a.x) + 2 * CULL_MARGIN,
            h: (b.y - a.y) + 2 * CULL_MARGIN
        }
    }

    drawList (ctx, view, list, visible) {
        for (const d of list) {
            if (!rectsIntersect(d.bounds(), visible)) { continue } // culled
            if (d.dimmed) { ctx.globalAlpha = DIM_ALPHA }
            d.draw(ctx, view)
            if (d.dimmed) { ctx.globalAlpha = 1 }
            this.stats.drawCalls++
        }
    }

    drawScene () {
        this.width = this.canvas.clientWidth
        this.height = this.canvas.clientHeight
        this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
        // back the canvas with device pixels so text and lines stay sharp on HiDPI screens
        this.canvas.width = Math.round(this.width * this.dpr)
        this.canvas.height = Math.round(this.height * this.dpr)

        const ctx = this.canvas.getContext('2d')
        const c = this.camera
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        ctx.fillStyle = '#121212'
        ctx.fillRect(0, 0, this.width, this.height)

        // everything below is drawn in world coordinates
        ctx.setTransform(this.dpr * c.k, 0, 0, this.dpr * c.k, this.dpr * c.x, this.dpr * c.y)
        this.drawBackground(ctx)

        this.stats.drawCalls = 0
        const view = { k: c.k, showLabels: c.k >= LABEL_MIN_ZOOM }
        const visible = this.visibleWorldRect()

        this.drawList(ctx, view, this.scene.groups, visible)
        this.drawList(ctx, view, this.scene.edges, visible)
        this.drawList(ctx, view, this.scene.nodes, visible)
    }

    drawBackground (ctx) {
        ctx.lineWidth = 1 / this.camera.k
        ctx.strokeStyle = '#242424'
        this.renderGrid(ctx, GRID)

        ctx.strokeStyle = '#363636'
        this.renderGrid(ctx, GRID * 4)
    }

    // grid lines across the visible world area only
    renderGrid (ctx, step) {
        if (step * this.camera.k < 6) { return } // too dense to be useful when zoomed out
        const a = this.screenToWorld({ x: 0, y: 0 })
        const b = this.screenToWorld({ x: this.width, y: this.height })
        ctx.beginPath()
        for (let x = Math.floor(a.x / step) * step; x < b.x; x += step) {
            ctx.moveTo(x, a.y); ctx.lineTo(x, b.y)
        }
        for (let y = Math.floor(a.y / step) * step; y < b.y; y += step) {
            ctx.moveTo(a.x, y); ctx.lineTo(b.x, y)
        }
        ctx.stroke()
    }
}

export default Graph
