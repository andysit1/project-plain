
import { updateWindow } from "./info_window.js"
import { GRID, snap } from "../utils/placement.js"

const NODE_SELECT_COLOR = '#FFA500'
const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag

class Graph {
    constructor (canvas) {
        this.canvas = canvas
        this.width = canvas.width
        this.height = canvas.height
        this.dpr = window.devicePixelRatio || 1
        this.states = []
        this.transitions = []
        this.nestedGroups = []

        // camera: screen = world * k + (x, y). Lets nodes live anywhere, not just on-screen.
        this.camera = { x: 0, y: 0, k: 1 }

        this.select_active = null
        this.previous_select_active = null
        this.current_layer = 1
        this.drag = null
        this.pan = null
        this.subscribeEvents()
        this.repaint = true
        requestAnimationFrame(() => this.animation())
    }

    reset_selectors(){
        this.previous_select_active = null
        this.select_active = null
        updateWindow(null)
    }

    clear () {
        this.states = []
        this.transitions = []
        this.reset_selectors()
        this.repaint = true
    }

    // World-space point at the middle of the visible canvas; new nodes are placed near here.
    viewCenter () {
        return this.screenToWorld({ x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 })
    }

    // World-space rects covered by floating UI (the properties panel), so placement avoids them
    obstacles () {
        const out = []
        const canvasBox = this.canvas.getBoundingClientRect()
        for (const el of document.querySelectorAll('#mydiv')) {
            const r = el.getBoundingClientRect()
            if (!r.width || !r.height) { continue }
            const a = this.screenToWorld({ x: r.left - canvasBox.left, y: r.top - canvasBox.top })
            const b = this.screenToWorld({ x: r.right - canvasBox.left, y: r.bottom - canvasBox.top })
            out.push({ rect: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } })
        }
        return out
    }

    screenToWorld (p) {
        const c = this.camera
        return { x: (p.x - c.x) / c.k, y: (p.y - c.y) / c.k }
    }

    //method to dom events (subscribed once; pointer capture keeps drags alive outside the canvas)
    subscribeEvents () {
        this.canvas.style.touchAction = 'none'
        this.canvas.addEventListener('pointermove', e => this.onMouseMove(e))
        this.canvas.addEventListener('pointerup', e => this.onMouseUp(e))
        this.canvas.addEventListener('pointercancel', e => this.onMouseUp(e))
        this.canvas.addEventListener('pointerdown', e => this.onMouseDown(e))
        this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false })
    }

    needsRepaint () {
        if (this.repaint) { return true }

        if (this.canvas.clientWidth !== this.width ||
                this.canvas.clientHeight !== this.height) { return true }

        return false
    }

    animation () {
        if (this.needsRepaint()) {
            this.repaint = false
            try {
                this.drawScene()
            } catch (err) {
                console.error('drawScene failed', err) // never let one bad frame kill the loop
            }
        }

        requestAnimationFrame(() => this.animation())
    }

    drawLayerCounter(){
        const layerLayout = document.getElementById('textOverlay')
        layerLayout.innerHTML = this.current_layer
    }

    //draws the selected graph node! keeps select until diff is chosen
    drawSelect (ctx) {
        if (!this.select_active) { return }

        this.select_active.fillNodePath(ctx, 8)
        ctx.lineWidth = 3
        ctx.strokeStyle = NODE_SELECT_COLOR
        ctx.stroke()
    }

    drawScene () {
        this.width = this.canvas.clientWidth
        this.height = this.canvas.clientHeight
        this.dpr = window.devicePixelRatio || 1
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

        for (const state of this.states) { state.drawActive(ctx) }

        for (const trans of this.transitions) { trans.draw(ctx) }

        for (const state of this.states) { state.draw(ctx) }

        for (const trans of this.transitions) { trans.drawHover(ctx) }

        this.drawSelect(ctx)
        this.drawLayerCounter()
    }

    drawBackground (ctx) {
        ctx.lineWidth = 1 / this.camera.k
        ctx.strokeStyle = '#242424'
        this.renderGrid(ctx, GRID)

        ctx.strokeStyle = '#363636'
        this.renderGrid(ctx, GRID * 4)
    }

    // pointer position relative to the canvas, in screen pixels
    eventPos (event) {
        const rect = this.canvas.getBoundingClientRect()
        return { x: event.clientX - rect.left, y: event.clientY - rect.top }
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

    // topmost node under a world point (last drawn wins, matching what the user sees)
    stateAt (x, y) {
        for (let i = this.states.length - 1; i >= 0; i--) {
            if (this.states[i].isInBounds(x, y)) { return this.states[i] }
        }
        return null
    }

    select (state) {
        if (state === this.select_active) { return }
        if (this.select_active) { this.previous_select_active = this.select_active }
        this.select_active = state
        updateWindow(state) // show the node that is now selected, not the previous one
        this.repaint = true
    }

    onMouseMove (event) {
        event.preventDefault()
        const screen = this.eventPos(event)
        const { x, y } = this.screenToWorld(screen)

        if (this.pan) {
            this.camera.x = this.pan.camX + screen.x - this.pan.sx
            this.camera.y = this.pan.camY + screen.y - this.pan.sy
            this.repaint = true
            return
        }
        this.updateDrag(x, y, screen)
        this.updateHover(x, y)
    }

    updateDrag (x, y, screen) {
        if (!this.drag) { return }
        if (!this.drag.moved && Math.hypot(screen.x - this.drag.sx, screen.y - this.drag.sy) < DRAG_THRESHOLD) { return }
        this.drag.moved = true

        this.drag.target.rect.x = x - this.drag.mouseX + this.drag.startX
        this.drag.target.rect.y = y - this.drag.mouseY + this.drag.startY
        this.repaint = true
    }

    updateHover (x, y) {
        const mousePos = { x: x, y: y }
        const hovered = this.stateAt(x, y)

        for (const state of this.states) {
            const mousedOver = state === hovered

            if (mousedOver !== state.highlight) {
                state.highlight = mousedOver
                this.repaint = true
            }
        }

        for (const trans of this.transitions) {
            const mousedOver = trans.isInBounds(x, y)

            if (mousedOver !== trans.highlight) {
                trans.highlight = mousedOver
                this.repaint = true
            }

            if (mousedOver) {
                trans.mousePos = mousePos
                this.repaint = true
            }
        }
    }

    onMouseDown (event) {
        event.preventDefault()
        this.canvas.setPointerCapture(event.pointerId)
        const screen = this.eventPos(event)
        const { x, y } = this.screenToWorld(screen)

        const targetState = this.stateAt(x, y)

        if (!targetState) {
            // empty space: start panning; a click without movement deselects on release
            this.pan = { sx: screen.x, sy: screen.y, camX: this.camera.x, camY: this.camera.y }
            return
        }

        this.select(targetState)

        // bring the grabbed node to the front so it draws over what it's dragged across
        this.states.splice(this.states.indexOf(targetState), 1)
        this.states.push(targetState)

        this.drag = {
            target: targetState,
            startX: targetState.rect.x,
            startY: targetState.rect.y,
            mouseX: x,
            mouseY: y,
            sx: screen.x,
            sy: screen.y,
            moved: false
        }
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
            if (clicked && this.select_active) {
                this.select_active = null
                updateWindow(null)
                this.repaint = true
            }
            return
        }
        if (this.drag?.moved) {
            // snap to the grid so hand-placed layouts line up
            this.drag.target.rect.x = snap(this.drag.target.rect.x)
            this.drag.target.rect.y = snap(this.drag.target.rect.y)
            this.repaint = true
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
        this.repaint = true
    }
}


export default Graph
