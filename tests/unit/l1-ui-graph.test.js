// Graph additions for layers: highlight set (dim the rest), fit to a set of ids, double-click.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIM_ALPHA } from '../../shared/contracts.js'
import Graph from '../../frontend/graph/components/graph.js'
import { fakeCanvas, fakeNode, fakeEdge, pointerEvent, fire } from './helpers/t9-dom.js'

function setup() {
  const canvas = fakeCanvas()
  const graph = new Graph(canvas)
  const a = fakeNode({ id: 'a', x: 0, y: 0, w: 50, h: 50 })
  const b = fakeNode({ id: 'b', x: 100, y: 0, w: 50, h: 50 })
  const c = fakeNode({ id: 'c', x: 400, y: 300, w: 50, h: 50 })
  const ab = fakeEdge({ id: 'a>b', from: 'a', to: 'b', x: 50, y: 20 })
  const bc = fakeEdge({ id: 'b>c', from: 'b', to: 'c', x: 150, y: 20 })
  const ca = fakeEdge({ id: 'c>c', from: 'c', to: 'c', x: 150, y: 20 })
  graph.setScene({ groups: [], edges: [ab, bc, ca], nodes: [a, b, c] })
  return { canvas, graph, a, b, c, ab, bc, ca }
}

test('setHighlight dims everything outside the set and the edges not touching it', () => {
  const { graph, a, b, c, ab, bc, ca } = setup()
  graph.setHighlight(new Set(['a']))
  assert.deepEqual([a.dimmed, b.dimmed, c.dimmed], [false, true, true])
  assert.deepEqual([ab.dimmed, bc.dimmed, ca.dimmed], [false, true, true])
  assert.deepEqual(graph.highlighted(), ['a'])
  graph.setHighlight(null)
  assert.ok([a, b, c, ab, bc, ca].every(d => !d.dimmed))
  assert.deepEqual(graph.highlighted(), [])
})

test('the highlight survives a scene swap', () => {
  const { graph } = setup()
  graph.setHighlight(['b'])
  const b2 = fakeNode({ id: 'b', x: 0, y: 0 }), d = fakeNode({ id: 'd', x: 50, y: 0 })
  graph.setScene({ groups: [], edges: [], nodes: [b2, d] })
  assert.equal(b2.dimmed, false)
  assert.equal(d.dimmed, true)
})

test('dimmed drawables are painted at DIM_ALPHA', () => {
  const { canvas, graph, a, c } = setup()
  const alphas = {}
  for (const n of [a, c]) {
    const draw = n.draw.bind(n)
    n.draw = (ctx, view) => { alphas[n.id] = ctx.globalAlpha ?? 1; draw(ctx, view) }
  }
  graph.setCamera({ x: 0, y: 0, k: 1 })
  graph.setHighlight(['a'])
  graph.renderFrame(0)
  assert.equal(alphas.a, 1)
  assert.equal(alphas.c, DIM_ALPHA)
  assert.equal(canvas.ctx.globalAlpha, 1, 'alpha restored after drawing')
})

test('fitToIds frames only those nodes; unknown ids leave the camera alone', () => {
  const { graph } = setup()
  graph.setCamera({ x: 7, y: 7, k: 1 })
  assert.equal(graph.fitToIds(['nope']), false)
  assert.deepEqual(graph.camera, { x: 7, y: 7, k: 1 })
  assert.equal(graph.fitToIds(['c']), true)
  const k = graph.camera.k
  assert.ok(k <= 1.5, 'zoom capped')
  // the centre of c is at the centre of the 800x600 canvas
  assert.ok(Math.abs(425 * k + graph.camera.x - 400) < 1e-6)
  assert.ok(Math.abs(325 * k + graph.camera.y - 300) < 1e-6)
})

test('double-click on a node fires onActivate with altKey', () => {
  const { canvas, graph } = setup()
  graph.setCamera({ x: 0, y: 0, k: 1 })
  const got = []
  graph.onActivate((node, opts) => got.push([node.id, opts.altKey]))
  fire(canvas, 'dblclick', pointerEvent(110, 10, { altKey: true }))
  fire(canvas, 'dblclick', pointerEvent(300, 200))
  fire(canvas, 'dblclick', pointerEvent(10, 10))
  assert.deepEqual(got, [['b', true], ['a', false]])
})
