import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeCanvas, getElement, resetElements, setPanel, frameQueue } from './helpers/dom-stub.js'
import Graph from '../components/graph.js'
import { GraphManager } from '../components/graph_handler.js'
import { TransitionGroupManager } from '../components/th.js'
import { NODE_GAP } from '../utils/placement.js'

const NODE_WIDTH = 150
const NODE_HEIGHT = 75

// Stands in for the Layers class in index.js: the same fields GraphManager reaches for,
// backed by the real TransitionGroupManager so removal logic is genuinely exercised.
class FakeLayer {
    constructor () {
        this.ts_manager = new TransitionGroupManager()
        this.states = []
        this.transition = []
        this.nested_group = []
    }

    updateTransitionsAndNestedGroups () {
        const [transitions, groups] = this.ts_manager.listTransitionsAndNestedGroupsInArray()
        this.transition = transitions
        this.nested_group = groups
    }
}

// Stands in for LayerEngine.
class FakeEngine {
    constructor (canvas) {
        this.graph = new Graph(canvas)
        this.layers = [new FakeLayer()]
        this.loads = 0
        this.displays = 0
    }

    get_current_layer () { return this.layers[0] }

    load_layer (layer) {
        this.loads++
        this.graph.states = layer.states
        this.graph.transitions = layer.transition
        this.graph.nestedGroups = layer.nested_group
        this.graph.repaint = true
    }

    display () { this.displays++ }
}

function setup () {
    resetElements()
    frameQueue.length = 0
    const engine = new FakeEngine(fakeCanvas({ width: 800, height: 600 }))
    const manager = new GraphManager(engine)
    // the manager holds a reference to graph.states, so share the layer's array with it
    engine.load_layer(engine.get_current_layer())
    return { engine, manager, layer: engine.get_current_layer(), graph: engine.graph }
}

function clashes (a, b, gap = NODE_GAP) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
           a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

// --- adding nodes -----------------------------------------------------------

test('adding a node puts it on the canvas at the default size', () => {
    const { manager, graph } = setup()
    manager.addNode()
    assert.equal(graph.states.length, 1)
    assert.equal(graph.states[0].rect.w, NODE_WIDTH)
    assert.equal(graph.states[0].rect.h, NODE_HEIGHT)
})

test('a new node is selected and shown in the properties panel', () => {
    const { manager, graph } = setup()
    manager.addNode()
    const added = graph.states[0]
    assert.equal(graph.select_active, added)
    assert.equal(getElement('node-name').value, 'Node')
    assert.equal(getElement('node-id').value, added.id)
})

test('a new node lands near the middle of the view', () => {
    const { manager, graph } = setup()
    manager.addNode()
    const r = graph.states[0].rect
    assert.ok(Math.abs(r.x + r.w / 2 - 400) <= 25, 'node was not centred horizontally')
    assert.ok(Math.abs(r.y + r.h / 2 - 300) <= 25, 'node was not centred vertically')
})

test('ten added nodes never stack on top of each other', () => {
    // The old version placed every node at the same spot.
    const { manager, graph } = setup()
    for (let i = 0; i < 10; i++) { manager.addNode() }
    assert.equal(graph.states.length, 10)
    for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < 10; j++) {
            assert.ok(!clashes(graph.states[i].rect, graph.states[j].rect),
                'nodes ' + i + ' and ' + j + ' overlap')
        }
    }
})

test('every added node gets a distinct id', () => {
    const { manager, graph } = setup()
    for (let i = 0; i < 6; i++) { manager.addNode() }
    const ids = graph.states.map(s => s.id)
    assert.equal(new Set(ids).size, ids.length, 'an id was reused')
})

test('an id is not reissued after a node is deleted', () => {
    const { manager, graph } = setup()
    manager.addNode()
    manager.addNode()
    const survivingId = graph.states[0].id
    graph.select(graph.states[1])
    manager.deleteNode()
    manager.addNode()
    const ids = graph.states.map(s => s.id)
    assert.equal(new Set(ids).size, ids.length, 'the deleted id came back and collided')
    assert.ok(graph.states.some(s => s.id === survivingId))
})

test('a new node avoids the floating properties panel', () => {
    const { manager, graph } = setup()
    setPanel({ left: 250, top: 150, width: 400, height: 350 })   // covers the view centre
    manager.addNode()
    const panel = { x: 250, y: 150, w: 400, h: 350 }
    assert.ok(!clashes(graph.states[0].rect, panel), 'the node was placed under the panel')
})

test('added nodes follow the camera when the view is panned', () => {
    const { manager, graph } = setup()
    graph.camera = { x: -1000, y: -1000, k: 1 }
    manager.addNode()
    const r = graph.states[0].rect
    assert.ok(r.x > 1000 && r.y > 1000, 'the node was placed outside the panned view')
})

// --- deleting nodes ---------------------------------------------------------

test('deleting with nothing selected changes nothing', () => {
    const { manager, engine, graph } = setup()
    manager.addNode()
    graph.reset_selectors()
    const before = engine.loads
    manager.deleteNode()
    assert.equal(graph.states.length, 1)
    assert.equal(engine.loads, before, 'the layer was reloaded for a no-op delete')
})

test('deleting removes the selected node and clears the selection', () => {
    const { manager, graph } = setup()
    manager.addNode()
    manager.addNode()
    const doomed = graph.select_active
    manager.deleteNode()
    assert.equal(graph.states.length, 1)
    assert.ok(!graph.states.includes(doomed))
    assert.equal(graph.select_active, null)
    assert.equal(getElement('node-id').value, '')
})

test('deleting a node also removes the transitions attached to it', () => {
    const { manager, layer, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    manager.addNode(); const c = graph.select_active

    graph.select(a); graph.select(b); manager.makeTransitions()   // a <-> b
    graph.select(a); graph.select(c); manager.makeTransitions()   // a <-> c
    assert.equal(layer.transition.length, 2)

    graph.select(c)
    manager.deleteNode()
    assert.equal(layer.transition.length, 1, 'the deleted node left a dangling transition')
    const survivor = layer.transition[0]
    assert.ok(survivor.parent !== c && survivor.child !== c)
})

test('the graph can still be drawn after a node is deleted', () => {
    const { manager, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a); graph.select(b); manager.makeTransitions()
    graph.select(b)
    manager.deleteNode()
    assert.doesNotThrow(() => graph.drawScene(), 'a stale transition broke rendering')
})

// --- transitions ------------------------------------------------------------

test('a transition needs two different nodes selected', () => {
    const { manager, layer, graph } = setup()
    manager.addNode()
    manager.makeTransitions()                 // only one node ever selected
    assert.equal(layer.transition.length, 0)

    const only = graph.select_active
    graph.select(only)
    manager.makeTransitions()
    assert.equal(layer.transition.length, 0, 'a node was linked to itself')
})

test('selecting two nodes then adding a transition links them', () => {
    const { manager, layer, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a)
    graph.select(b)
    manager.makeTransitions()
    assert.equal(layer.transition.length, 1)
    const t = layer.transition[0]
    assert.deepEqual([t.parent, t.child].sort(), [a, b].sort())
})

test('a second transition between the same nodes joins the existing group', () => {
    const { manager, layer, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a); graph.select(b); manager.makeTransitions()
    graph.select(a); graph.select(b); manager.makeTransitions()
    assert.equal(layer.transition.length, 2)
    assert.equal(layer.nested_group.length, 1, 'a duplicate group was created')
})

test('each transition gets its own id', () => {
    const { manager, layer, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a); graph.select(b); manager.makeTransitions()
    graph.select(a); graph.select(b); manager.makeTransitions()
    const ids = layer.transition.map(t => t.id)
    assert.equal(new Set(ids).size, ids.length, 'two transitions share an id')
})

test('a linked graph renders without error', () => {
    const { manager, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a); graph.select(b); manager.makeTransitions()
    assert.doesNotThrow(() => graph.drawScene())
})

// --- clear and save ---------------------------------------------------------

test('clearing removes the nodes, the transitions and the selection', () => {
    const { manager, layer, graph } = setup()
    manager.addNode(); const a = graph.select_active
    manager.addNode(); const b = graph.select_active
    graph.select(a); graph.select(b); manager.makeTransitions()

    manager.clearGraph()
    assert.equal(graph.states.length, 0)
    assert.equal(layer.transition.length, 0)
    assert.equal(Object.keys(layer.ts_manager.transitions_map.map).length, 0,
        'transition groups outlived the clear')
    assert.equal(graph.select_active, null)
})

test('nodes can be added again after a clear', () => {
    const { manager, graph } = setup()
    manager.addNode()
    manager.clearGraph()
    manager.addNode()
    assert.equal(graph.states.length, 1)
})

test('saving asks the engine to write out the current layer', () => {
    const { manager, engine } = setup()
    manager.addNode()
    manager.saveGraph()
    assert.equal(engine.displays, 1, 'save did not reach the engine')
})

test('the handler methods stay bound when passed as event listeners', () => {
    const { manager, graph } = setup()
    const detached = manager.addNode
    assert.doesNotThrow(() => detached(), 'addNode lost its receiver')
    assert.equal(graph.states.length, 1)
})
