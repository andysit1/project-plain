



//make changes to not use sockets..
//figure out the diagram structure/design before altering

const NODE_CORNER_RADIUS = 8
const NODE_COLOR = '#552222'
const NODE_BORDER_COLOR = '#555555'
const NODE_HIGHLIGHT_COLOR = '#777777'
const NODE_TEXT_FONT = '12px Calibri'
const NODE_TEXT_COLOR = '#CCCCCC'
const NODE_ACTIVE_COLOR = '#556699'
const NODE_SELECT_COLOR = '#FFA500'
const LINE_COLOR = '#555555'
const LINE_THICKNESS = 5
const LINE_SEPARATION = 16
const LINE_HIGHLIGHT = '#888888'
const LINE_TEXT_FONT = '12px Calibri'
const LAYER_ENTER_COLOR = '#559966'

let graph
let nestedGroups






class Graph {
    constructor (canvas) {
        this.canvas = canvas
        this.width = canvas.width
        this.height = canvas.height
        this.states = []
        this.transitions = []
        this.nestedGroups = []

        this.select_active = null
        this.previous_select_active = null

        this.subscribeEvents()
        this.repaint = true
        requestAnimationFrame(() => this.animation())
    }

    // swap the nodes, states, and transitions
    swap_layer(layer){

    }

    clear () {
        this.states = []
        this.transitions = []
        this.repaint = true
    }

    //method to dom events
    subscribeEvents () {
        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e))
        this.canvas.addEventListener('mouseup', e => this.onMouseUp(e))
        this.canvas.addEventListener('mousedown', e => this.onMouseDown(e))
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
        this.drawScene()
        }

        requestAnimationFrame(() => this.animation())
    }

    //draws the selected graph node! keeps select until diff is chosen
    drawSelect () {
        if (!this.select_active) { return }

        const ctx = this.canvas.getContext('2d')
        this.select_active.fillNodePath(ctx, 8)
        ctx.lineWidth = 3
        ctx.strokeStyle = NODE_SELECT_COLOR
        ctx.stroke()
    }

    drawScene () {
        this.width = this.canvas.width = this.canvas.clientWidth
        this.height = this.canvas.height = this.canvas.clientHeight

        const ctx = this.canvas.getContext('2d')

        this.drawBackground(ctx)
        
        for (const state of this.states) { state.drawActive(ctx) }

        for (const trans of this.transitions) { trans.draw(ctx) }

        for (const state of this.states) { state.draw(ctx) }

        for (const trans of this.transitions) { trans.drawHover(ctx) }
        

        this.drawSelect()

    }

    drawBackground (ctx) {
        ctx.fillStyle = '#121212'
        ctx.fillRect(0, 0, this.width, this.height)

        ctx.lineWidth = 1
        ctx.strokeStyle = '#242424'
        this.renderGrid(ctx, 25)

        ctx.strokeStyle = '#363636'
        this.renderGrid(ctx, 100)
    }

    eventPos (event) {
        const elem = this.canvas
        let top = 0
        let left = 0

        if (elem.getClientRects().length) {
        const rect = elem.getBoundingClientRect()
        const win = elem.ownerDocument.defaultView

        top = rect.top + win.pageYOffset
        left = rect.left + win.pageXOffset
        }

        return {
        x: event.pageX - left,
        y: event.pageY - top
        }
    }

    renderGrid (ctx, step) {
        for (let x = 0; x < this.width; x += step) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, this.height)
        ctx.closePath()
        ctx.stroke()
        }

        for (let y = 0; y < this.height; y += step) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(this.width, y)
        ctx.closePath()
        ctx.stroke()
        }
    }

    onMouseMove (event) {
        event.preventDefault()
        const { x, y } = this.eventPos(event)

        this.updateDrag(x, y)
        this.updateHover(x, y)
    }

    updateDrag (x, y) {
        if (!this.drag) { return }

        this.drag.target.rect.x = x - this.drag.mouseX + this.drag.startX
        this.drag.target.rect.y = y - this.drag.mouseY + this.drag.startY
        this.repaint = true
    }

    updateHover (x, y) {
        const mousePos = { x: x, y: y }

        for (const state of this.states) {
            const mousedOver = state.isInBounds(x, y)
            
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
        const { x, y } = this.eventPos(event)
        
        //grabs the state in mouse position!
        let targetState
        for (const state of this.states) {
        if (state.isInBounds(x, y)) { targetState = state }
        }

        if (!targetState) { return }
        

        //added for graph obj to know the state which is selected..
        if (this.select_active !=  null){
            this.previous_select_active = this.select_active
        }
        this.select_active = targetState
        
        this.drag = {
        target: targetState,
        startX: targetState.rect.x,
        startY: targetState.rect.y,
        mouseX: x,
        mouseY: y
        }
    }

    onMouseUp (event) {
        event.preventDefault()
        this.drag = null
    }
}


export default Graph