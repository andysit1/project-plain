// Layer switcher, drill-down and L3 wiring in createApp (frontend/graph/index.js), headless:
// a fake Graph and DOM, the real buildClassScene, and a stubbed buildDataScene.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyLayout } from '../../shared/contracts.js'
import { createApp } from '../../frontend/graph/index.js'
import { buildClassScene } from '../../frontend/graph/components/classes.js'
import { createFakeDom, FakeElement } from './helpers/t10-dom.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = (name = 'graph.classes.json') => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))

const S = 'app/structures.py'
const REGISTRY = `${S}::Registry`
const REGISTRY_METHODS = [`${S}::Registry.__init__`, `${S}::Registry.add`, `${S}::Registry.build`]

// ---------------------------------------------------------------- fakes

class FakeGraph {
  constructor() {
    this.scene = { groups: [], edges: [], nodes: [] }
    this.camera = { x: 0, y: 0, k: 1 }
    this.highlight = null
    this.fits = []
    this.cameraSets = []
    this.selectedId = null
    this.cbs = { select: [], move: [], camera: [], activate: [] }
  }
  setScene({ groups, edges, nodes }) {
    this.scene = { groups, edges, nodes }
    if (this.selectedId != null && !nodes.some(n => n.id === this.selectedId)) this.select(null)
  }
  onSelect(cb) { this.cbs.select.push(cb) }
  onMove(cb) { this.cbs.move.push(cb) }
  onCamera(cb) { this.cbs.camera.push(cb) }
  onActivate(cb) { this.cbs.activate.push(cb) }
  setCamera(cam) { this.camera = { ...cam }; this.cameraSets.push({ ...cam }) }
  select(id) {
    const node = id == null ? null : (this.scene.nodes.find(n => n.id === id) ?? null)
    this.selectedId = node ? node.id : null
    for (const cb of this.cbs.select) cb(node)
  }
  setHighlight(ids) { this.highlight = ids ? [...ids] : null }
  fitToContent() { this.fits.push('all'); this.camera = { x: 1, y: 1, k: 0.5 } }
  fitToIds(ids) { this.fits.push([...ids]); this.camera = { x: 2, y: 2, k: 1.5 }; return true }
  viewCenter() { return { x: 0, y: 0 } }
  // test helpers: what a user does on the canvas
  dblclick(id, altKey = false) {
    const node = this.scene.nodes.find(n => n.id === id)
    for (const cb of this.cbs.activate) cb(node, { altKey })
  }
  drag(id, x, y) {
    const node = this.scene.nodes.find(n => n.id === id)
    node.data.x = x; node.data.y = y
    for (const cb of this.cbs.move) cb(node, { x, y })
  }
  pan(cam) { this.camera = { ...cam }; for (const cb of this.cbs.camera) cb({ ...cam }) }
}

class FakeNode { constructor(data) { this.id = data.id; this.data = data } }

function fakeMerge(graph) {
  const nodes = graph.nodes.map((n, i) => ({ ...n, x: (i % 5) * 220, y: Math.floor(i / 5) * 80, w: 200, h: 56, changed: false }))
  return { mode: 'functions', nodes, groups: [], edges: graph.edges, layoutPatch: {}, total: graph.nodes.length }
}

function makeLive(graph, layout = emptyLayout()) {
  const saved = []
  let handlers = null
  return {
    saved,
    push: (g) => handlers.onGraph(g),
    loadLayout: async () => layout,
    saveLayout: (patch) => { saved.push(patch) },
    flushLayout: () => {},
    connect(h) {
      handlers = h
      h.onConnection('open')
      if (graph) h.onGraph(graph)
      return { close() {} }
    },
  }
}

function makeWin() {
  const listeners = {}
  return {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    removeEventListener() {},
    key(key, extra = {}) {
      const e = { key, preventDefault() {}, ...extra }
      for (const fn of listeners.keydown || []) fn(e)
    },
  }
}

const EXTRA_IDS = ['layer-switch', 'layer-classes', 'layer-functions', 'layer-data', 'breadcrumb', 'layer-hint',
  'inspector-fn', 'inspector-cls', 'inspector-fields', 'inspector-methods', 'inspector-methods-title', 'inspector-subclasses']

async function boot({ graph = fixture(), layout, dataScene = () => null } = {}) {
  const { doc, elements } = createFakeDom()
  for (const id of EXTRA_IDS) elements.set(id, new FakeElement(id.startsWith('layer-') ? 'button' : 'div'))
  const win = makeWin()
  const live = makeLive(graph, layout)
  const dataCalls = []
  const deps = {
    live,
    merge: fakeMerge,
    applyCeiling: s => s,
    Graph: FakeGraph,
    CodeNode: FakeNode,
    FolderGroup: FakeNode,
    buildEdges: edges => edges.map(e => ({ id: e.id, data: e })),
    buildClassScene,
    ClassNode: FakeNode,
    buildClassEdges: edges => edges.map(e => ({ id: e.id, data: e })),
    buildDataScene: (g, focusId) => { dataCalls.push(focusId); return dataScene(g, focusId) },
  }
  const app = createApp(deps, { canvas: {}, doc, win })
  await app.ready
  return { app, plain: win.__plain, graph: app.graph, doc, el: id => elements.get(id), win, live, dataCalls }
}

const pressed = (ctx) => ['classes', 'functions', 'data'].filter(n => ctx.el(`layer-${n}`)['aria-pressed'] === 'true')

// ---------------------------------------------------------------- tests

test('starts on functions; setLayer switches the scene, buttons and breadcrumb', async () => {
  const ctx = await boot()
  const { plain } = ctx
  assert.equal(plain.layer, 'functions')
  assert.equal(plain.scene.mode, 'functions')
  assert.deepEqual(pressed(ctx), ['functions'])
  assert.equal(ctx.el('breadcrumb').textContent, 'Functions')

  const renders = plain.renders
  assert.equal(plain.setLayer('classes'), true)
  assert.equal(plain.layer, 'classes')
  assert.equal(plain.scene.mode, 'classes')
  assert.equal(plain.scene.nodes.length, fixture().classes.length)
  assert.equal(ctx.graph.scene.nodes.length, fixture().classes.length)
  assert.equal(ctx.graph.scene.edges.length, fixture().classEdges.length)
  assert.equal(plain.renders, renders + 1)
  assert.deepEqual(pressed(ctx), ['classes'])
  assert.equal(ctx.el('breadcrumb').textContent, 'Classes')
  assert.equal(ctx.el('status-counts').textContent, `${fixture().classes.length} classes · ${fixture().classEdges.length} relations`)

  assert.equal(plain.setLayer('nope'), false)
  assert.equal(plain.layer, 'classes')
})

test('each layer keeps its own camera; the classes camera fits first and is never saved', async () => {
  const ctx = await boot()
  const { plain, graph, live } = ctx
  graph.pan({ x: 100, y: 200, k: 2 }) // user moves the functions camera
  assert.deepEqual(live.saved.at(-1), { camera: { x: 100, y: 200, k: 2 } })

  graph.fits = []
  plain.setLayer('classes')
  assert.deepEqual(graph.fits, ['all'], 'classes camera fits to content the first time')
  const saves = live.saved.length
  graph.pan({ x: -5, y: -5, k: 0.8 })
  assert.equal(live.saved.length, saves, 'classes camera is not persisted')

  plain.setLayer('functions')
  assert.deepEqual(graph.camera, { x: 100, y: 200, k: 2 })
  graph.fits = []
  plain.setLayer('classes')
  assert.deepEqual(graph.fits, [])
  assert.deepEqual(graph.camera, { x: -5, y: -5, k: 0.8 })
})

test('keys 1/2/3 switch layer', async () => {
  const ctx = await boot()
  ctx.win.key('1')
  assert.equal(ctx.plain.layer, 'classes')
  ctx.win.key('2')
  assert.equal(ctx.plain.layer, 'functions')
  ctx.win.key('3')
  assert.equal(ctx.plain.layer, 'functions', 'data needs a selection')
  ctx.win.key('1', { ctrlKey: true })
  assert.equal(ctx.plain.layer, 'functions', 'modified keys are left alone')
})

test('drilling into a class highlights exactly its methods and fits the camera to them', async () => {
  const ctx = await boot()
  const { plain, graph } = ctx
  plain.setLayer('classes')
  assert.deepEqual(plain.highlighted(), [])
  assert.equal(plain.drill(REGISTRY), true)
  assert.equal(plain.layer, 'functions')
  assert.deepEqual(plain.highlighted().sort(), REGISTRY_METHODS.slice().sort())
  assert.deepEqual(graph.highlight.sort(), REGISTRY_METHODS.slice().sort())
  assert.deepEqual(graph.fits.at(-1).sort(), REGISTRY_METHODS.slice().sort())
  assert.equal(graph.scene.nodes.length, fixture().nodes.length, 'the full graph stays visible')
  assert.equal(ctx.el('breadcrumb').textContent, 'Classes › Registry')

  // double-click does the same
  plain.setLayer('classes')
  graph.dblclick(`${S}::Square`)
  assert.deepEqual(plain.highlighted().sort(), [`${S}::Square.__init__`, `${S}::Square.area`])
})

test('Esc clears the highlight, a second Esc goes back to classes', async () => {
  const ctx = await boot()
  const { plain, graph, win } = ctx
  plain.setLayer('classes')
  plain.drill(REGISTRY)
  win.key('Escape')
  assert.equal(plain.layer, 'functions')
  assert.deepEqual(plain.highlighted(), [])
  assert.equal(graph.highlight, null)
  win.key('Escape')
  assert.equal(plain.layer, 'classes')
})

test('data is disabled until something is selected, then opens for that selection', async () => {
  const ctx = await boot()
  const { plain, dataCalls } = ctx
  assert.equal(ctx.el('layer-data').getAttribute?.('aria-disabled') ?? ctx.el('layer-data')['aria-disabled'], 'true')
  assert.equal(plain.setLayer('data'), false)
  assert.equal(plain.layer, 'functions')
  assert.equal(dataCalls.length, 0)

  plain.select(`${S}::linked_sum`)
  assert.equal(ctx.el('layer-data').getAttribute?.('aria-disabled') ?? ctx.el('layer-data')['aria-disabled'], 'false')
  assert.equal(plain.setLayer('data'), true)
  assert.equal(plain.layer, 'data')
  assert.deepEqual(dataCalls, [`${S}::linked_sum`])
  assert.deepEqual(pressed(ctx), ['data'])
  assert.equal(ctx.el('breadcrumb').textContent, 'Functions › linked_sum › data')
  assert.equal(ctx.el('layer-hint').hidden, false, 'null result shows the empty state')
  assert.match(ctx.el('layer-hint').textContent, /linked_sum/)

  ctx.win.key('Escape')
  assert.equal(plain.layer, 'functions')
})

test('double-clicking a function opens L3 for it, and the data scene is handed to the graph', async () => {
  const shapes = { groups: [], edges: [], nodes: [{ id: 'v:x', data: { name: 'x' }, bounds: () => ({ x: 0, y: 0, w: 10, h: 10 }), draw() {} }] }
  const ctx = await boot({ dataScene: () => shapes })
  const { plain, graph, dataCalls } = ctx
  graph.fits = []
  graph.dblclick(`${S}::Registry.add`)
  assert.equal(plain.layer, 'data')
  assert.deepEqual(dataCalls, [`${S}::Registry.add`])
  assert.equal(graph.scene.nodes, shapes.nodes)
  assert.deepEqual(graph.fits, ['all'])
  assert.equal(ctx.el('layer-hint').hidden, true)
  assert.deepEqual(plain.positions(), { 'v:x': { x: 0, y: 0 } })

  // a new graph re-renders the data view for the same focus
  ctx.live.push(fixture())
  assert.deepEqual(dataCalls, [`${S}::Registry.add`, `${S}::Registry.add`])
  assert.equal(plain.layer, 'data')
})

test('Alt+double-click on a class opens its schema view (focusId = class id)', async () => {
  const ctx = await boot()
  ctx.plain.setLayer('classes')
  ctx.graph.dblclick(`${S}::TreeNode`, true)
  assert.equal(ctx.plain.layer, 'data')
  assert.deepEqual(ctx.dataCalls, [`${S}::TreeNode`])
  assert.equal(ctx.el('breadcrumb').textContent, 'Classes › TreeNode › data')
  ctx.win.key('Escape')
  assert.equal(ctx.plain.layer, 'classes')
})

test('a data view that throws degrades to the empty-state message', async () => {
  const ctx = await boot({ dataScene: () => { throw new Error('boom') } })
  ctx.plain.drill(`${S}::grid`)
  assert.equal(ctx.plain.layer, 'data')
  assert.match(ctx.el('layer-hint').textContent, /boom/)
})

test('a new graph re-renders the current layer and keeps the highlight while its ids exist', async () => {
  const ctx = await boot()
  const { plain, live } = ctx
  plain.setLayer('classes')
  plain.drill(REGISTRY)

  const g2 = fixture()
  g2.nodes = g2.nodes.filter(n => n.id !== `${S}::Registry.build`)
  g2.edges = g2.edges.filter(e => e.from !== `${S}::Registry.build` && e.to !== `${S}::Registry.build`)
  live.push(g2)
  assert.equal(plain.scene.mode, 'functions')
  assert.deepEqual(plain.highlighted().sort(), [`${S}::Registry.__init__`, `${S}::Registry.add`])

  plain.setLayer('classes')
  const renders = plain.renders
  live.push(fixture())
  assert.equal(plain.renders, renders + 1)
  assert.equal(plain.scene.mode, 'classes')
})

test('class drags save layout.classes; relayout in classes clears only classes', async () => {
  const ctx = await boot()
  const { plain, graph, live } = ctx
  plain.setLayer('classes')
  const firstPatch = live.saved.find(p => p.classes)
  assert.ok(firstPatch, 'first classes render saves its placements')
  assert.deepEqual(Object.keys(firstPatch), ['classes'])

  graph.drag(REGISTRY, 1000, 1000)
  assert.deepEqual(live.saved.at(-1), { classes: { [REGISTRY]: { x: 1000, y: 1000 } } })

  live.saved.length = 0
  plain.relayout()
  const clear = live.saved[0]
  assert.deepEqual(Object.keys(clear), ['classes'])
  assert.ok(Object.values(clear.classes).every(v => v === null))
  assert.equal(Object.keys(clear.classes).length, fixture().classes.length)
  assert.deepEqual(Object.keys(live.saved[1]), ['classes'], 'then the fresh layout is saved')
  assert.notDeepEqual(plain.positions()[REGISTRY], { x: 1000, y: 1000 })
})

test('a graph with an empty class list shows the Python-only hint in the classes layer', async () => {
  const ctx = await boot({ graph: { ...fixture('graph.small.json'), classes: [], classEdges: [], frames: {} } })
  ctx.plain.setLayer('classes')
  assert.equal(ctx.plain.scene.nodes.length, 0)
  assert.equal(ctx.el('layer-hint').hidden, false)
  assert.match(ctx.el('layer-hint').textContent, /Python-only/)
  ctx.plain.setLayer('functions')
  assert.equal(ctx.el('layer-hint').hidden, true)
})

test('a graph with no classes field (a map server from before layers) says to restart map', async () => {
  const ctx = await boot({ graph: fixture('graph.small.json') })
  ctx.plain.setLayer('classes')
  assert.match(ctx.el('layer-hint').textContent, /Restart map/)
})

test('pressing Data with nothing selected explains what to do instead of doing nothing', async () => {
  const ctx = await boot()
  ctx.el('layer-data').click()
  assert.equal(ctx.plain.layer, 'functions')
  assert.match(ctx.el('layer-hint').textContent, /Select a function or class first/)
  ctx.plain.select(`${S}::linked_sum`)
  assert.equal(ctx.el('layer-hint').hidden, true, 'selecting something clears the hint')
})

test('the inspector shows a class: bases, fields, methods (drill on click) and subclasses', async () => {
  const ctx = await boot()
  const { plain, el } = ctx
  plain.setLayer('classes')
  plain.select(`${S}::Square`)
  assert.equal(el('inspector').hidden, false)
  assert.equal(el('inspector-name').textContent, 'Square')
  assert.equal(el('inspector-sig').textContent, 'class Square(Shape)')
  assert.equal(el('inspector-fn').hidden, true)
  assert.equal(el('inspector-cls').hidden, false)
  assert.deepEqual(el('inspector-fields').children.map(li => li.textContent), ['side: float', 'corner: Point'])
  assert.deepEqual(el('inspector-methods').children.map(li => li.textContent), ['__init__', 'area'])
  assert.equal(el('layer-data').getAttribute?.('aria-disabled') ?? el('layer-data')['aria-disabled'], 'false', 'a selected class enables data')

  plain.select(`${S}::Shape`)
  assert.deepEqual(el('inspector-subclasses').children.map(li => li.dataset.id), [`${S}::Square`])
  el('inspector-subclasses').children[0].click()
  assert.equal(el('inspector-name').textContent, 'Square')

  // clicking a method drills to it in L2
  el('inspector-methods').children[1].click()
  assert.equal(plain.layer, 'functions')
  assert.deepEqual(plain.highlighted().sort(), [`${S}::Square.__init__`, `${S}::Square.area`])
  assert.equal(el('inspector-name').textContent, 'area')
  assert.equal(el('inspector-fn').hidden, false)
})

test('index.html declares the layer ids from shared/dom.md', () => {
  const html = readFileSync(join(ROOT, 'frontend', 'graph', 'index.html'), 'utf8')
  for (const id of ['layer-switch', 'layer-classes', 'layer-functions', 'layer-data', 'breadcrumb']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing id="${id}"`)
  }
  assert.match(html, /id="layer-data"[^>]*aria-disabled="true"/)
})

test('in files mode the drill-down highlight lights up the methods\' files', async () => {
  const { doc, elements } = createFakeDom()
  const win = makeWin()
  const toFiles = (scene) => ({
    ...scene, mode: 'files',
    nodes: [...new Set(scene.nodes.map(n => n.file))].map((f, i) => ({ id: f, file: f, name: f, x: i * 250, y: 0, w: 200, h: 56 })),
  })
  const app = createApp({
    live: makeLive(fixture()), merge: fakeMerge, applyCeiling: toFiles, Graph: FakeGraph,
    CodeNode: FakeNode, FolderGroup: FakeNode, buildEdges: () => [], buildClassScene, ClassNode: FakeNode,
    buildClassEdges: () => [],
  }, { canvas: {}, doc, win })
  await app.ready
  win.__plain.setLayer('classes')
  win.__plain.drill('app/config.py::<module>')
  assert.deepEqual(win.__plain.highlighted(), ['app/config.py::load_config'])
  assert.deepEqual(app.graph.highlight, ['app/config.py'])
  assert.ok(elements.get('files-mode-notice').hidden === false)
})
