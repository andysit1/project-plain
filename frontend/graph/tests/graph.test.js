import test from 'node:test'
import assert from 'node:assert/strict'
import {
    fakeCanvas, getElement, resetElements, setPanel, pointerEvent, frameQueue
} from './helpers/dom-stub.js'
import Graph from '../components/graph.js'
import { Rect, State } from '../components/node.js'
import { GRID, snap } from '../utils/placement.js'

const DRAG_THRESHOLD = 4

function makeGraph (opts) {
    resetElements()
    frameQueue.length = 0
    const canvas = fakeCanvas(opts)
    const graph = new Graph(canvas)
    return { graph, canvas }
}

const addState = (graph, id, x, y) => {
    const s = new State(id, 'n' + id, new Rect(x, y, 150, 75))
    graph.states.push(s)
    return s
}

const onGrid = (v) => Math.abs(v % GRID) === 0

// --- camera -----------------------------------------------------------------

test('with the default camera, screen and world coordinates agree', () => {
    const { graph } = makeGraph()
    assert.deepEqual(graph.screenToWorld({ x: 120, y: 80 }), { x: 120, y: 80 })
})

test('screenToWorld undoes a pan and a zoom', () => {
    const { graph } = makeGraph()
    graph.camera = { x: -100, y: 50, k: 2 }
    const world = graph.screenToWorld({ x: 300, y: 250 })
    assert.deepEqual(world, { x: 200, y: 100 })
    // re-project and land back where we started
    assert.deepEqual({ x: world.x * 2 - 100, y: world.y * 2 + 50 }, { x: 300, y: 250 })
})

test('the view centre follows the camera', () => {
    const { graph } = makeGraph({ width: 800, height: 600 })
    assert.deepEqual(graph.viewCenter(), { x: 400, y: 300 })
    graph.camera = { x: -200, y: 0, k: 1 }
    assert.deepEqual(graph.viewCenter(), { x: 600, y: 300 })
})

test('the floating properties panel is reported as a world-space obstacle', () => {
    const { graph } = makeGraph()
    setPanel({ left: 10, top: 20, width: 200, height: 100 })
    const blocked = graph.obstacles()
    assert.equal(blocked.length, 1)
    assert.deepEqual(blocked[0].rect, { x: 10, y: 20, w: 200, h: 100 })
})

test('a zero-sized panel is not treated as an obstacle', () => {
    const { graph } = makeGraph()
    setPanel({ left: 0, top: 0, width: 0, height: 0 })
    assert.deepEqual(graph.obstacles(), [])
})

test('obstacles are converted into world space under zoom', () => {
    const { graph } = makeGraph()
    graph.camera = { x: 0, y: 0, k: 2 }
    setPanel({ left: 0, top: 0, width: 200, height: 100 })
    assert.deepEqual(graph.obstacles()[0].rect, { x: 0, y: 0, w: 100, h: 50 })
})

// --- hit testing ------------------------------------------------------------

test('the topmost node wins when two overlap', () => {
    const { graph } = makeGraph()
    const under = addState(graph, 1, 0, 0)
    const over = addState(graph, 2, 10, 10)
    assert.equal(graph.stateAt(50, 50), over, 'the node drawn last should take the click')
    assert.equal(graph.stateAt(5, 5), under)
})

test('empty space returns no node', () => {
    const { graph } = makeGraph()
    addState(graph, 1, 0, 0)
    assert.equal(graph.stateAt(900, 900), null)
})

// --- selection --------------------------------------------------------------

test('selecting a node fills the properties panel with that node', () => {
    const { graph } = makeGraph()
    const a = addState(graph, 41, 0, 0)
    graph.select(a)
    assert.equal(graph.select_active, a)
    assert.equal(getElement('node-id').value, 41)
    assert.equal(getElement('node-name').value, 'n41')
})

test('selecting a second node shows the new node, not the previous one', () => {
    // The panel used to be updated with the outgoing selection.
    const { graph } = makeGraph()
    const a = addState(graph, 1, 0, 0)
    const b = addState(graph, 2, 300, 0)
    graph.select(a)
    graph.select(b)
    assert.equal(graph.select_active, b)
    assert.equal(graph.previous_select_active, a)
    assert.equal(getElement('node-id').value, 2, 'the panel showed the previous selection')
})

test('re-selecting the same node does not overwrite the previous selection', () => {
    const { graph } = makeGraph()
    const a = addState(graph, 1, 0, 0)
    const b = addState(graph, 2, 300, 0)
    graph.select(a)
    graph.select(b)
    graph.select(b)
    assert.equal(graph.previous_select_active, a, 'a repeated click lost the transition source')
})

test('resetting selectors clears the panel', () => {
    const { graph } = makeGraph()
    graph.select(addState(graph, 1, 0, 0))
    graph.reset_selectors()
    assert.equal(graph.select_active, null)
    assert.equal(graph.previous_select_active, null)
    assert.equal(getElement('node-id').value, '')
})

test('clearing the graph empties the states and the selection', () => {
    const { graph } = makeGraph()
    graph.select(addState(graph, 1, 0, 0))
    graph.clear()
    assert.deepEqual(graph.states, [])
    assert.deepEqual(graph.transitions, [])
    assert.equal(graph.select_active, null)
})

// --- pressing and dragging nodes --------------------------------------------

test('pressing a node selects it and brings it to the front', () => {
    const { graph } = makeGraph()
    const first = addState(graph, 1, 0, 0)
    const second = addState(graph, 2, 400, 0)
    graph.onMouseDown(pointerEvent(50, 50))
    assert.equal(graph.select_active, first)
    assert.equal(graph.states.at(-1), first, 'the pressed node was not raised')
    assert.equal(graph.states.length, 2, 'raising the node duplicated or dropped one')
    assert.ok(graph.states.includes(second))
})

test('a press with no movement leaves the node exactly where it was', () => {
    const { graph } = makeGraph()
    const s = addState(graph, 1, 100, 100)
    graph.onMouseDown(pointerEvent(150, 130))
    graph.onMouseMove(pointerEvent(150 + DRAG_THRESHOLD - 1, 130))
    assert.equal(graph.drag.moved, false)
    assert.deepEqual([s.rect.x, s.rect.y], [100, 100], 'a click nudged the node')
    graph.onMouseUp(pointerEvent(150 + DRAG_THRESHOLD - 1, 130))
    assert.deepEqual([s.rect.x, s.rect.y], [100, 100])
})

test('a drag past the threshold moves the node with the pointer', () => {
    const { graph } = makeGraph()
    const s = addState(graph, 1, 100, 100)
    graph.onMouseDown(pointerEvent(150, 130))
    graph.onMouseMove(pointerEvent(230, 210))
    assert.equal(graph.drag.moved, true)
    assert.deepEqual([s.rect.x, s.rect.y], [180, 180], 'the node did not follow the pointer')
})

test('releasing a drag snaps the node onto the grid', () => {
    const { graph } = makeGraph()
    const s = addState(graph, 1, 100, 100)
    graph.onMouseDown(pointerEvent(150, 130))
    graph.onMouseMove(pointerEvent(233, 217))
    graph.onMouseUp(pointerEvent(233, 217))
    assert.ok(onGrid(s.rect.x))
    assert.ok(onGrid(s.rect.y))
    assert.equal(s.rect.x, snap(183))
    assert.equal(s.rect.y, snap(187))
    assert.equal(graph.drag, null)
})

test('a drag keeps the grab point under the pointer while zoomed in', () => {
    const { graph } = makeGraph()
    graph.camera = { x: 0, y: 0, k: 2 }
    const s = addState(graph, 1, 100, 100)
    // world (150, 130) is screen (300, 260) at k = 2
    graph.onMouseDown(pointerEvent(300, 260))
    graph.onMouseMove(pointerEvent(400, 360))   // 100 screen px is 50 world px
    assert.deepEqual([s.rect.x, s.rect.y], [150, 150])
})

test('the pointer is captured on press and released on the matching release', () => {
    const { graph, canvas } = makeGraph()
    addState(graph, 1, 0, 0)
    graph.onMouseDown(pointerEvent(50, 50))
    assert.ok(canvas.hasPointerCapture(1))
    graph.onMouseUp(pointerEvent(50, 50))
    assert.ok(!canvas.hasPointerCapture(1))
})

test('a release with no active gesture is harmless', () => {
    const { graph } = makeGraph()
    graph.onMouseUp(pointerEvent(10, 10))
    assert.equal(graph.drag, null)
    assert.equal(graph.pan, null)
})

test('a move with no active drag does not throw', () => {
    const { graph } = makeGraph()
    addState(graph, 1, 0, 0)
    graph.onMouseMove(pointerEvent(60, 60))
    assert.equal(graph.drag, null)
})

// --- panning and deselecting ------------------------------------------------

test('dragging empty space pans the camera', () => {
    const { graph } = makeGraph()
    graph.onMouseDown(pointerEvent(400, 300))
    graph.onMouseMove(pointerEvent(450, 330))
    assert.deepEqual([graph.camera.x, graph.camera.y], [50, 30])
})

test('panning does not move any node', () => {
    const { graph } = makeGraph()
    const s = addState(graph, 1, 0, 0)
    graph.onMouseDown(pointerEvent(700, 500))   // empty space
    graph.onMouseMove(pointerEvent(760, 540))
    assert.deepEqual([s.rect.x, s.rect.y], [0, 0])
})

test('clicking empty space clears the selection', () => {
    const { graph } = makeGraph()
    graph.select(addState(graph, 1, 0, 0))
    graph.onMouseDown(pointerEvent(700, 500))
    graph.onMouseUp(pointerEvent(700, 500))
    assert.equal(graph.select_active, null)
    assert.equal(getElement('node-id').value, '')
})

test('a pan that actually moved keeps the selection', () => {
    const { graph } = makeGraph()
    const a = addState(graph, 1, 0, 0)
    graph.select(a)
    graph.onMouseDown(pointerEvent(700, 500))
    graph.onMouseMove(pointerEvent(760, 540))
    graph.onMouseUp(pointerEvent(760, 540))
    assert.equal(graph.select_active, a, 'panning the canvas dropped the selection')
    assert.equal(graph.pan, null)
})

test('a cancelled pointer ends the gesture', () => {
    const { graph } = makeGraph()
    addState(graph, 1, 0, 0)
    graph.onMouseDown(pointerEvent(50, 50))
    graph.onMouseUp(pointerEvent(50, 50))   // pointercancel is wired to the same handler
    assert.equal(graph.drag, null)
})

// --- hover ------------------------------------------------------------------

test('hover highlights only the node under the pointer', () => {
    const { graph } = makeGraph()
    const a = addState(graph, 1, 0, 0)
    const b = addState(graph, 2, 400, 0)
    graph.onMouseMove(pointerEvent(50, 50))
    assert.equal(a.highlight, true)
    assert.equal(b.highlight, false)
    graph.onMouseMove(pointerEvent(450, 50))
    assert.equal(a.highlight, false)
    assert.equal(b.highlight, true)
})

// --- zoom -------------------------------------------------------------------

test('scrolling up zooms in and scrolling down zooms out', () => {
    const { graph } = makeGraph()
    graph.onWheel(pointerEvent(400, 300, { deltaY: -100 }))
    assert.ok(graph.camera.k > 1)
    const zoomedIn = graph.camera.k
    graph.onWheel(pointerEvent(400, 300, { deltaY: 100 }))
    assert.ok(graph.camera.k < zoomedIn)
})

test('zoom keeps the world point under the cursor fixed', () => {
    const { graph } = makeGraph()
    const cursor = { x: 250, y: 175 }
    const before = graph.screenToWorld(cursor)
    graph.onWheel(pointerEvent(cursor.x, cursor.y, { deltaY: -240 }))
    const after = graph.screenToWorld(cursor)
    assert.ok(Math.abs(after.x - before.x) < 1e-9, 'the cursor drifted horizontally')
    assert.ok(Math.abs(after.y - before.y) < 1e-9, 'the cursor drifted vertically')
})

test('zoom is clamped so the graph cannot be lost', () => {
    const { graph } = makeGraph()
    for (let i = 0; i < 200; i++) { graph.onWheel(pointerEvent(400, 300, { deltaY: -500 })) }
    assert.equal(graph.camera.k, 3)
    for (let i = 0; i < 400; i++) { graph.onWheel(pointerEvent(400, 300, { deltaY: 500 })) }
    assert.equal(graph.camera.k, 0.2)
})

// --- painting ---------------------------------------------------------------

test('drawScene backs the canvas with device pixels', () => {
    const { graph, canvas } = makeGraph({ width: 801, height: 601 })
    globalThis.window.devicePixelRatio = 2
    try {
        graph.drawScene()
        assert.equal(canvas.width, 1602)
        assert.equal(canvas.height, 1202)
    } finally {
        globalThis.window.devicePixelRatio = 1
    }
})

test('drawScene renders the nodes and updates the layer readout', () => {
    const { graph, canvas } = makeGraph()
    addState(graph, 1, 0, 0)
    graph.current_layer = 3
    graph.drawScene()
    assert.equal(getElement('textOverlay').innerHTML, 3)
    assert.ok(canvas.ctx.calls.some(c => c[0] === 'fillText'), 'no node label was painted')
})

test('a selected node is outlined', () => {
    const { graph, canvas } = makeGraph()
    graph.select(addState(graph, 1, 0, 0))
    graph.drawScene()
    assert.ok(canvas.ctx.calls.some(c => c[0] === 'stroke'))
})

test('the fine grid is skipped once it would be too dense to read', () => {
    const { graph } = makeGraph()
    graph.camera = { x: 0, y: 0, k: 0.2 }
    graph.width = 800
    graph.height = 600
    const ctx = graph.canvas.getContext('2d')
    graph.renderGrid(ctx, GRID)             // 25 * 0.2 = 5px, below the cutoff
    assert.equal(ctx.calls.length, 0, 'an unreadably dense grid was still drawn')
    graph.renderGrid(ctx, GRID * 4)         // 100 * 0.2 = 20px, drawn
    assert.ok(ctx.calls.length > 0)
})

test('one failing frame does not stop the render loop', () => {
    const { graph } = makeGraph()
    frameQueue.length = 0
    graph.repaint = true
    graph.drawScene = () => { throw new Error('boom') }
    graph.animation()
    assert.equal(frameQueue.length, 1, 'the loop did not schedule another frame after an error')
})

test('a resized canvas triggers a repaint', () => {
    const { graph, canvas } = makeGraph({ width: 800, height: 600 })
    graph.drawScene()
    graph.repaint = false
    assert.equal(graph.needsRepaint(), false)
    canvas.clientWidth = 1000
    assert.equal(graph.needsRepaint(), true)
})
