import { test } from 'node:test'
import assert from 'node:assert/strict'

import Graph from '../../frontend/graph/components/graph.js'
import { GRID, LABEL_MIN_ZOOM } from '../../shared/contracts.js'
import { fakeCanvas, fakeNode, fakeEdge, fire, pointerEvent, wheelEvent } from './helpers/t9-dom.js'

test('culling: 6000 nodes, view containing ~20 of them draws fewer than 100', () => {
    const canvas = fakeCanvas({ width: 800, height: 600 })
    const graph = new Graph(canvas)

    const nodes = []
    // 20 nodes clustered near the origin -> inside the default view (k=1, camera 0,0)
    for (let i = 0; i < 20; i++) {
        const col = i % 5
        const row = Math.floor(i / 5)
        nodes.push(fakeNode({ id: `near-${i}`, x: col * 40, y: row * 40, w: 20, h: 20 }))
    }
    // 5980 nodes far outside the view + CULL_MARGIN
    for (let i = 0; i < 5980; i++) {
        nodes.push(fakeNode({ id: `far-${i}`, x: 100000 + i * 50, y: 100000, w: 20, h: 20 }))
    }
    assert.equal(nodes.length, 6000)

    graph.setScene({ groups: [], edges: [], nodes })
    graph.renderFrame(0)

    assert.ok(graph.stats.drawCalls > 0, 'expected some nodes to draw')
    assert.ok(graph.stats.drawCalls < 100, `expected < 100 draw calls, got ${graph.stats.drawCalls}`)
})

test('showLabels flips at LABEL_MIN_ZOOM', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)
    const seen = []
    const node = fakeNode({ id: 'n1', x: 0, y: 0 })
    node.draw = (ctx, view) => { seen.push(view.showLabels) }
    graph.setScene({ groups: [], edges: [], nodes: [node] })

    graph.setCamera({ x: 0, y: 0, k: LABEL_MIN_ZOOM - 0.05 })
    graph.renderFrame(0)
    assert.equal(seen[seen.length - 1], false)

    graph.setCamera({ x: 0, y: 0, k: LABEL_MIN_ZOOM })
    graph.renderFrame(0)
    assert.equal(seen[seen.length - 1], true)

    graph.setCamera({ x: 0, y: 0, k: LABEL_MIN_ZOOM + 0.5 })
    graph.renderFrame(0)
    assert.equal(seen[seen.length - 1], true)
})

test('picking selects the top (last-drawn) node under the cursor and calls onSelect', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)

    const bottom = fakeNode({ id: 'bottom', x: 0, y: 0, w: 50, h: 50 })
    const top = fakeNode({ id: 'top', x: 0, y: 0, w: 50, h: 50 }) // overlaps bottom, drawn later
    graph.setScene({ groups: [], edges: [], nodes: [bottom, top] })

    let selected = 'unset'
    graph.onSelect(n => { selected = n })

    fire(canvas, 'pointerdown', pointerEvent(10, 10))
    fire(canvas, 'pointerup', pointerEvent(10, 10))

    assert.equal(selected, top)
    assert.equal(top.selected, true)
    assert.equal(bottom.selected, false)

    // clicking empty space clears the selection
    fire(canvas, 'pointerdown', pointerEvent(700, 500))
    fire(canvas, 'pointerup', pointerEvent(700, 500))
    assert.equal(selected, null)
})

test('picking highlights edges touching the selected node', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)
    const a = fakeNode({ id: 'a', x: 0, y: 0, w: 20, h: 20 })
    const b = fakeNode({ id: 'b', x: 100, y: 0, w: 20, h: 20 })
    const ab = fakeEdge({ id: 'a>b', from: 'a', to: 'b', x: 0, y: 0, w: 120, h: 20 })
    const other = fakeEdge({ id: 'b>b', from: 'b', to: 'b', x: 0, y: 0, w: 10, h: 10 })
    graph.setScene({ groups: [], edges: [ab, other], nodes: [a, b] })

    graph.select('a')
    assert.equal(ab.highlight, true)
    assert.equal(other.highlight, false)
})

test('drag calls onMove with GRID-snapped coordinates', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)
    const node = fakeNode({ id: 'n1', x: 0, y: 0, w: 30, h: 30 })
    graph.setScene({ groups: [], edges: [], nodes: [node] })

    let moved = null
    graph.onMove((n, pos) => { moved = { n, pos } })

    fire(canvas, 'pointerdown', pointerEvent(10, 10))
    fire(canvas, 'pointermove', pointerEvent(41, 21)) // world delta (31, 11), past the drag threshold
    fire(canvas, 'pointerup', pointerEvent(41, 21))

    assert.ok(moved, 'expected onMove to fire')
    assert.equal(moved.n, node)
    assert.equal(moved.pos.x % GRID, 0)
    assert.equal(moved.pos.y % GRID, 0)
    assert.equal(node.x, moved.pos.x)
    assert.equal(node.y, moved.pos.y)
})

test('a small drag (under the threshold) does not trigger onMove', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)
    const node = fakeNode({ id: 'n1', x: 0, y: 0, w: 30, h: 30 })
    graph.setScene({ groups: [], edges: [], nodes: [node] })

    let moved = false
    graph.onMove(() => { moved = true })

    fire(canvas, 'pointerdown', pointerEvent(10, 10))
    fire(canvas, 'pointermove', pointerEvent(11, 10))
    fire(canvas, 'pointerup', pointerEvent(11, 10))

    assert.equal(moved, false)
})

test('fitToContent puts all bounds on screen', () => {
    const canvas = fakeCanvas({ width: 800, height: 600 })
    const graph = new Graph(canvas)

    const nodes = [
        fakeNode({ id: 'a', x: -500, y: -300, w: 40, h: 40 }),
        fakeNode({ id: 'b', x: 900, y: 700, w: 40, h: 40 }),
        fakeNode({ id: 'c', x: 200, y: 100, w: 40, h: 40 })
    ]
    graph.setScene({ groups: [], edges: [], nodes })

    graph.fitToContent(40)

    for (const n of nodes) {
        const b = n.bounds()
        const topLeft = worldToScreen(graph.camera, { x: b.x, y: b.y })
        const bottomRight = worldToScreen(graph.camera, { x: b.x + b.w, y: b.y + b.h })
        assert.ok(topLeft.x >= -1 && topLeft.x <= canvas.clientWidth + 1, `x ${topLeft.x} on screen`)
        assert.ok(topLeft.y >= -1 && topLeft.y <= canvas.clientHeight + 1, `y ${topLeft.y} on screen`)
        assert.ok(bottomRight.x >= -1 && bottomRight.x <= canvas.clientWidth + 1)
        assert.ok(bottomRight.y >= -1 && bottomRight.y <= canvas.clientHeight + 1)
    }
})

test('wheel zoom is clamped and marks the camera dirty', () => {
    const canvas = fakeCanvas()
    const graph = new Graph(canvas)
    graph.renderFrame(0) // clear initial dirty flag
    assert.equal(graph.dirty, false)

    fire(canvas, 'wheel', wheelEvent(400, 300, -2000))
    assert.equal(graph.dirty, true)
    assert.ok(graph.camera.k <= 3 && graph.camera.k >= 0.2)
})

function worldToScreen (camera, p) {
    return { x: p.x * camera.k + camera.x, y: p.y * camera.k + camera.y }
}
