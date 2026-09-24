import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyLayout } from '../../shared/contracts.js'
import { createApp } from '../../frontend/graph/index.js'
import { createFakeDom } from './helpers/t10-dom.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))

// ---------------------------------------------------------------- fakes

class FakeGraph {
  constructor(canvas) {
    this.canvas = canvas
    this.scene = null
    this._nodesById = new Map()
    this._selectCb = null
    this._moveCb = null
    this._cameraCb = null
    this.camera = null
    this.fitCalled = false
  }
  setScene({ groups, edges, nodes }) {
    this.scene = { groups, edges, nodes }
    this._nodesById = new Map(nodes.map(n => [n.id, n]))
  }
  onSelect(cb) { this._selectCb = cb }
  onMove(cb) { this._moveCb = cb }
  onCamera(cb) { this._cameraCb = cb }
  setCamera(cam) { this.camera = cam }
  select(id) { this._selectCb?.(id == null ? null : (this._nodesById.get(id) ?? null)) }
  fitToContent() { this.fitCalled = true }
  viewCenter() { return { x: 0, y: 0 } }
}

class FakeCodeNode {
  constructor(data) { this.id = data.id; this.data = data }
}
class FakeFolderGroup {
  constructor(data) { this.id = data.id; this.data = data }
}

// A merge stub good enough to drive the pipeline: one SceneNode per CodeNode, laid out on a grid.
function fakeMerge(graph, _layout, _prevGraph, _ctx) {
  const nodes = graph.nodes.map((n, i) => ({
    ...n, x: (i % 5) * 220, y: Math.floor(i / 5) * 80, w: 200, h: 56, changed: false,
  }))
  return {
    mode: 'functions',
    nodes,
    groups: [],
    edges: graph.edges,
    layoutPatch: {},
    total: graph.nodes.length,
  }
}

function identityCeiling(scene) { return scene }

function buildEdgesFake(codeEdges, _boxOf) {
  return codeEdges.map(e => ({ ...e }))
}

function makeLive({ graphFixture, layout = emptyLayout() } = {}) {
  const saved = []
  let handlers = null
  return {
    saved,
    handlers: () => handlers,
    loadLayout: async () => layout,
    saveLayout: (patch) => { saved.push(patch) },
    flushLayout: () => {},
    connect(h) {
      handlers = h
      h.onConnection('connecting')
      // Simulate the real client: hello, then the current graph, immediately.
      queueMicrotaskSync(() => {
        h.onHello({ root: '/fixtures/demo-repo' })
        h.onConnection('open')
        if (graphFixture) h.onGraph(graphFixture)
      })
      return { close() {} }
    },
  }
}

// live.connect in the real client fires callbacks synchronously off a promise chain; a plain
// synchronous call is enough here and keeps `ready` deterministic without extra ticks.
function queueMicrotaskSync(fn) { fn() }

function makeDeps(overrides = {}) {
  return {
    live: overrides.live ?? makeLive({ graphFixture: fixture('graph.small.json') }),
    merge: overrides.merge ?? fakeMerge,
    applyCeiling: overrides.applyCeiling ?? identityCeiling,
    Graph: FakeGraph,
    CodeNode: FakeCodeNode,
    FolderGroup: FakeFolderGroup,
    buildEdges: buildEdgesFake,
  }
}

function makeCanvas() {
  return { getContext: () => ({}) }
}

// ---------------------------------------------------------------- tests

test('loading renders 15 nodes into the graph and window.__plain', async () => {
  const { doc } = createFakeDom()
  const win = {}
  const deps = makeDeps()
  const app = createApp(deps, { canvas: makeCanvas(), doc, win })
  await app.ready

  assert.equal(app.graph.scene.nodes.length, 15)
  assert.equal(win.__plain.scene.nodes.length, 15)
  assert.equal(win.__plain.renders, 1)
  assert.ok(app.graph.fitCalled, 'fitToContent should run on first render with no saved camera')
})

test('selecting a node fills the inspector with name, sig, loc, callers and callees', async () => {
  const { doc, elements } = createFakeDom()
  const win = {}
  const deps = makeDeps()
  const app = createApp(deps, { canvas: makeCanvas(), doc, win })
  await app.ready

  win.__plain.select('app/main.py::run')

  assert.equal(elements.get('inspector').hidden, false)
  assert.equal(elements.get('inspector-name').textContent, 'run')
  assert.equal(elements.get('inspector-sig').textContent, 'run(cfg) -> None')
  assert.equal(elements.get('inspector-loc').textContent, 'app/main.py:10')

  const callerIds = elements.get('inspector-callers').children.map(li => li.dataset.id)
  const calleeIds = elements.get('inspector-callees').children.map(li => li.dataset.id)
  assert.deepEqual(callerIds.sort(), ['app/main.py::main'])
  assert.deepEqual(calleeIds.sort(), [
    'app/db.py::close', 'app/db.py::connect', 'app/db.py::query', 'app/utils.py::slugify',
  ])

  const callerTexts = elements.get('inspector-callers').children.map(li => li.textContent)
  assert.deepEqual(callerTexts, ['main'])

  // Deselecting hides the inspector again.
  win.__plain.select(null)
  assert.equal(elements.get('inspector').hidden, true)
})

test('files mode shows the notice and a non-empty layoutPatch triggers saveLayout', async () => {
  const { doc, elements } = createFakeDom()
  const win = {}
  const live = makeLive({ graphFixture: fixture('graph.small.json') })
  const filesModeMerge = (graph, layout, prevGraph, ctx) => {
    const base = fakeMerge(graph, layout, prevGraph, ctx)
    return {
      ...base,
      mode: 'files',
      layoutPatch: { nodes: { 'app/main.py::run': { x: 10, y: 20 } } },
    }
  }
  const deps = makeDeps({ live, merge: filesModeMerge })
  const app = createApp(deps, { canvas: makeCanvas(), doc, win })
  await app.ready

  assert.equal(elements.get('files-mode-notice').hidden, false)
  assert.equal(live.saved.length, 1)
  assert.deepEqual(live.saved[0], { nodes: { 'app/main.py::run': { x: 10, y: 20 } } })
})

test('#status-conn follows connection state changes', async () => {
  const { doc, elements } = createFakeDom()
  const win = {}
  const live = makeLive({ graphFixture: fixture('graph.small.json') })
  const deps = makeDeps({ live })
  const app = createApp(deps, { canvas: makeCanvas(), doc, win })
  await app.ready

  assert.equal(elements.get('status-conn').textContent, 'open')
  assert.equal(elements.get('status-conn').dataset.state, 'open')

  live.handlers().onConnection('closed')
  assert.equal(elements.get('status-conn').textContent, 'closed')
  assert.equal(win.__plain.connection, 'closed')
})

test('index.html declares every id from shared/dom.md', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'graph', 'index.html'), 'utf8')
  const requiredIds = [
    'canvas', 'status-conn', 'status-counts', 'status-rebuild', 'files-mode-notice',
    'inspector', 'inspector-name', 'inspector-sig', 'inspector-loc',
    'inspector-callers', 'inspector-callees', 'open-in-editor',
  ]
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing id="${id}" in index.html`)
  }
  assert.match(html, /<canvas[^>]*id=["']canvas["']/, 'canvas element must carry id="canvas"')
})
