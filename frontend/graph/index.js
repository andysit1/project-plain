// App shell: wires live data -> scene builders -> Graph, the layer switcher (L1 classes,
// L2 functions, L3 data), drill-down, and the inspector/status bar.
// This is the ONE module allowed to import anything (see shared/dom.md, tasks/CHANGELOG.md).

import { emptyLayout, isEmptyPatch, applyLayoutPatch, dirOf, LAYERS } from '../../shared/contracts.js'
import { renderInspector, renderStatus } from './components/info_window.js'

const LAYER_LABELS = { classes: 'Classes', functions: 'Functions', data: 'Data' }
const NO_CLASSES_HINT = 'No classes to show. The classes layer is Python-only for now.'
// A graph with no `classes` field at all comes from a map server started before the layers update.
const OLD_SERVER_HINT = 'This map server sends no class data: it was started before the layers update. Restart map.'
const NO_FOCUS_HINT = 'Select a function or class first, then press Data (or double-click the box).'
// Mouse selections open the inspector after this long, so the panel cannot slide under the
// second click of a double-click (it covers the right edge of the canvas).
const INSPECT_DELAY_MS = 300
const EMPTY_SCENE = { groups: [], edges: [], nodes: [] }

/**
 * Wires the whole pipeline against injected dependencies, so it can run headless in tests.
 *
 * deps: { live, merge, applyCeiling, Graph, CodeNode, FolderGroup, buildEdges,
 *         buildClassScene?, ClassNode?, buildClassEdges?, buildDataScene? }
 *   live:         { connect({onGraph,onStatus,onConnection,onHello}) -> {close},
 *                   loadLayout() -> Promise<Layout>, saveLayout(patch), flushLayout() }
 *   merge:        (graph, layout, prevGraph, {viewCenter, now}) -> Scene
 *   applyCeiling: (scene) -> Scene
 *   Graph:        class Graph(canvas) — see shared docs / components/graph.js (T9)
 *   CodeNode:     class CodeNode(sceneNode)
 *   FolderGroup:  class FolderGroup(sceneGroup)
 *   buildEdges:   (codeEdges, boxOf) -> CallEdge[]
 *   buildClassScene: (graph, layout) -> Scene (mode 'classes'); missing = empty classes layer
 *   ClassNode:    class ClassNode(sceneNode); defaults to CodeNode
 *   buildClassEdges: (classEdges, boxOf) -> Drawable[]; defaults to buildEdges
 *   buildDataScene:  (graph, focusId) -> { groups, edges, nodes } | null; missing = always empty
 *
 * opts: { canvas, doc = document, win = window }
 *
 * Returns { ready, graph, plain, close } — `ready` resolves once the layout has loaded and the
 * live connection has been opened (it does NOT wait for the first graph to render).
 */
export function createApp(deps, { canvas, doc = document, win = window }) {
  const { live, merge, applyCeiling, Graph, CodeNode, FolderGroup, buildEdges } = deps
  const ClassNode = deps.ClassNode || CodeNode
  const buildClassEdges = deps.buildClassEdges || buildEdges
  const { buildClassScene, buildDataScene } = deps

  const graph = new Graph(canvas)

  let layout = emptyLayout()
  let latestGraph = null   // newest CodeGraph from the server
  let prevFnGraph = null   // the graph the functions scene was last merged from
  let currentScene = null
  let connectionState = 'connecting'
  let lastRebuild = null
  let cameraApplied = false
  let closeLive = null

  // ---- layer state
  let layer = 'functions'
  const cameras = { classes: null, functions: null, data: null } // in memory, per layer
  let focus = null        // { layer: 'classes'|'functions', id }: the last box the user selected
  let highlight = null    // string[] of CodeNode ids lit up in L2 after a drill-down, or null
  let drillFrom = null    // CodeClass id the current highlight came from (breadcrumb)
  let dataFocus = null    // { layer, id } the data view is showing
  let dataFrom = 'functions' // where Esc returns to from the data layer
  let hint = null         // empty-state text over the canvas
  let swapping = false    // true while a scene swap clears the selection (not a user deselect)

  const plain = {
    scene: null,
    graph: null,
    renders: 0,
    positions() {
      const out = {}
      for (const n of (plain.scene?.nodes || [])) out[n.id] = { x: n.x, y: n.y }
      return out
    },
    select(id) { graph.select(id) },
    connection: 'connecting',
    layer,
    setLayer,
    drill,
    highlighted() { return highlight ? highlight.slice() : [] },
  }
  win.__plain = plain

  // What the inspector needs to resolve callers/callees and to select on click.
  const inspectorGraph = {
    get nodes() { return currentScene?.nodes || [] },
    get edges() { return currentScene?.edges || [] },
    get functions() { return latestGraph?.nodes || [] },
    select(id) { graph.select(id) },
    openMethod,
  }

  function paintStatus() {
    renderStatus(doc, { connection: connectionState, scene: currentScene, rebuild: lastRebuild })
  }

  let pendingInspect = null // timer id of a deferred inspector render
  function cancelInspect() {
    if (pendingInspect != null) win.clearTimeout?.(pendingInspect)
    pendingInspect = null
  }

  graph.onSelect((node, { pointer = false } = {}) => {
    cancelInspect()
    if (node && pointer && win.setTimeout) {
      pendingInspect = win.setTimeout(() => {
        pendingInspect = null
        renderInspector(doc, node, inspectorGraph)
      }, INSPECT_DELAY_MS)
    } else {
      renderInspector(doc, node, inspectorGraph)
    }
    if (!swapping && layer !== 'data') focus = node ? { layer, id: node.id } : null
    if (focus && hint === NO_FOCUS_HINT) hint = null
    paintChrome()
  })

  graph.onMove((node, { x, y }) => {
    if (layer === 'classes') {
      const patch = { classes: { [node.id]: { x, y } } }
      live.saveLayout(patch)
      layout = applyLayoutPatch(layout, patch)
      return
    }
    if (layer !== 'functions' || currentScene?.mode === 'files') return
    live.saveLayout({ nodes: { [node.id]: { x, y } } })
    layout = applyLayoutPatch(layout, { nodes: { [node.id]: { x, y } } })
  })

  // Only the functions camera is persisted; the others live in memory (see `cameras`).
  graph.onCamera((camera) => {
    if (layer !== 'functions') return
    live.saveLayout({ camera })
    layout = applyLayoutPatch(layout, { camera })
  })

  graph.onActivate?.((node, { altKey } = {}) => {
    cancelInspect() // the layer is changing; the deferred panel would describe the old one
    drill(node.id, { altKey })
  })

  function onConnection(state) {
    connectionState = state
    plain.connection = state
    paintStatus()
  }

  function onStatus(status) {
    lastRebuild = status
    paintStatus()
  }

  function onHello(_hello) {
    // Nothing to show yet; kept as a seam for future use (e.g. displaying the watched root).
  }

  function onGraph(codeGraph) {
    latestGraph = codeGraph
    const nodeIds = new Set(codeGraph.nodes.map(n => n.id))
    if (highlight) {
      highlight = highlight.filter(id => nodeIds.has(id))
      if (!highlight.length) { highlight = null; drillFrom = null }
    }
    if (focus && layer !== 'data' && !focusExists(focus)) focus = null
    render()
  }

  // ---------------------------------------------------------------- rendering per layer

  function render() {
    if (!latestGraph) { paintChrome(); return }
    swapping = true
    try {
      if (layer === 'classes') renderClasses()
      else if (layer === 'data') renderData()
      else renderFunctions()
    } finally {
      swapping = false
    }
    plain.graph = latestGraph
    plain.scene = currentScene
    plain.renders += 1
    paintChrome()
  }

  function renderFunctions() {
    const viewCenter = graph.viewCenter()
    const scene = applyCeiling(merge(latestGraph, layout, prevFnGraph, { viewCenter, now: Date.now() }))
    currentScene = scene
    prevFnGraph = latestGraph
    hint = null

    const groups = drawableGroups(scene).map(g => new FolderGroup(g))
    const nodesById = new Map(scene.nodes.map(n => [n.id, n]))
    const nodes = scene.nodes.map(n => new CodeNode(n))
    const boxOf = (id) => {
      const n = nodesById.get(id)
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : undefined
    }
    // node boxes are read live (drag mutates them), so routes follow moved nodes
    const obstacles = () => scene.nodes.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
    const edges = buildEdges(scene.edges, boxOf, { obstacles })

    graph.setScene({ groups, edges, nodes })
    graph.setHighlight?.(sceneHighlight())
    reselect()

    if (!isEmptyPatch(scene.layoutPatch)) {
      live.saveLayout(scene.layoutPatch)
      layout = applyLayoutPatch(layout, scene.layoutPatch)
    }

    if (!cameraApplied) {
      if (layout.camera) graph.setCamera(layout.camera)
      else graph.fitToContent()
      cameraApplied = true
    }
  }

  function renderClasses() {
    const scene = buildClassScene
      ? buildClassScene(latestGraph, layout)
      : { mode: 'classes', nodes: [], groups: [], edges: [], layoutPatch: {}, total: 0 }
    currentScene = scene
    hint = scene.nodes.length ? null : latestGraph && !latestGraph.classes ? OLD_SERVER_HINT : NO_CLASSES_HINT

    const nodesById = new Map(scene.nodes.map(n => [n.id, n]))
    const nodes = scene.nodes.map(n => new ClassNode(n))
    const boxOf = (id) => {
      const n = nodesById.get(id)
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : undefined
    }
    const edges = buildClassEdges(scene.edges, boxOf)
    graph.setScene({ groups: [], edges, nodes })
    graph.setHighlight?.(null)
    reselect()

    if (!isEmptyPatch(scene.layoutPatch)) {
      live.saveLayout(scene.layoutPatch)
      layout = applyLayoutPatch(layout, scene.layoutPatch)
    }
  }

  function renderData() {
    const id = dataFocus?.id
    let result = null
    let failed = null
    if (buildDataScene && id != null) {
      // 3rd arg is a hint beyond the frozen (graph, focusId) interface: a module pseudo-class id
      // equals its file's '<module>' CodeNode id (see tasks/requests/L1U-to-coordinator-001.md)
      const kind = dataFocus.layer === 'classes' ? 'class' : 'function'
      try { result = buildDataScene(latestGraph, id, { kind }) } catch (err) { failed = err }
    }
    const drawables = result || EMPTY_SCENE
    graph.setScene(drawables)
    graph.setHighlight?.(null)

    const nodes = (drawables.nodes || []).map(d => {
      const b = typeof d.bounds === 'function' ? d.bounds() : {}
      return { ...(d.data || {}), id: d.id, x: b.x, y: b.y, w: b.w, h: b.h }
    })
    currentScene = {
      mode: 'data',
      nodes,
      groups: [],
      edges: (drawables.edges || []).map(e => e.data).filter(Boolean),
      layoutPatch: {},
      total: nodes.length,
      focusId: id ?? null,
    }
    const label = focusLabel(dataFocus)
    if (failed) hint = `The data view for ${label} failed: ${failed.message || failed}`
    else if (!buildDataScene) hint = 'The data layer is not available in this build.'
    else if (!result || !nodes.length) hint = `No data shapes to show for ${label}.`
    else hint = null
  }

  // After a scene swap, select the focused box again if it lives in this layer.
  function reselect() {
    if (focus && focus.layer === layer) graph.select(focus.id)
  }

  // ---------------------------------------------------------------- layer switching

  function switchTo(next) {
    if (next === layer) { render(); return }
    if (graph.camera) cameras[layer] = { ...graph.camera }
    if (layer === 'functions') persistFunctionsCamera()
    layer = next
    plain.layer = next
    render()
    if (!latestGraph) return
    const cam = cameras[next]
    if (next !== 'data' && cam) graph.setCamera(cam)
    else graph.fitToContent()
  }

  // the functions camera may still be waiting on the graph's debounce; save it on the way out
  function persistFunctionsCamera() {
    const cam = cameras.functions
    if (!cam || !cameraApplied) return
    const saved = layout.camera
    if (saved && saved.x === cam.x && saved.y === cam.y && saved.k === cam.k) return
    live.saveLayout({ camera: cam })
    layout = applyLayoutPatch(layout, { camera: cam })
  }

  /** Same as clicking a #layer-* button. False when not allowed (data with no selection). */
  function setLayer(name) {
    if (!LAYERS.includes(name)) return false
    if (name === 'data') {
      if (layer === 'data') return true
      if (!focus) return false
      openData(focus)
      return true
    }
    switchTo(name)
    return true
  }

  /** Same as double-clicking box `id` in the current layer (altKey: class -> data). */
  function drill(id, { altKey = false } = {}) {
    if (!latestGraph) return false
    if (layer === 'classes') {
      const cls = classById(id)
      if (!cls) return false
      focus = { layer: 'classes', id }
      if (altKey) { openData(focus); return true }
      drillClass(cls)
      return true
    }
    if (layer === 'functions') {
      if (!latestGraph.nodes.some(n => n.id === id)) return false
      focus = { layer: 'functions', id }
      openData(focus)
      return true
    }
    return false
  }

  // L1 -> L2: full graph, the class's methods (and their call edges) lit, the rest dimmed.
  function drillClass(cls) {
    const ids = new Set(latestGraph.nodes.map(n => n.id))
    const methods = (cls.methods || []).filter(m => ids.has(m))
    highlight = methods.length ? methods : null
    drillFrom = cls.id
    switchTo('functions')
    if (highlight) {
      if (graph.fitToIds) graph.fitToIds(sceneHighlight())
      else graph.fitToContent()
    }
    paintChrome()
  }

  // The highlight in scene ids: in files mode (over NODE_CEILING) a method's box is its file.
  function sceneHighlight() {
    if (!highlight || currentScene?.mode !== 'files') return highlight
    const fileOf = new Map(latestGraph.nodes.map(n => [n.id, n.file]))
    return [...new Set(highlight.map(id => fileOf.get(id)).filter(Boolean))]
  }

  function openData(f) {
    dataFocus = { ...f }
    if (layer !== 'data') {
      dataFrom = layer
      switchTo('data')
    } else {
      render()
      graph.fitToContent()
    }
  }

  // Inspector: a method of the selected class -> L2 with the class lit, camera on that method.
  function openMethod(id) {
    const owner = (latestGraph?.classes || []).find(c => (c.methods || []).includes(id))
    if (owner) drillClass(owner)
    else switchTo('functions')
    focus = { layer: 'functions', id }
    graph.select(id)
    graph.fitToIds?.([id])
    paintChrome()
  }

  /** Esc / Backspace: clear the drill-down highlight, else step one layer up. */
  function back() {
    if (layer === 'data') { switchTo(dataFrom === 'classes' ? 'classes' : 'functions'); return }
    if (layer === 'functions') {
      if (highlight) {
        highlight = null
        drillFrom = null
        graph.setHighlight?.(null)
        paintChrome()
        return
      }
      switchTo('classes')
    }
  }

  /** A layer button or key 1/2/3: like setLayer, but a refused Data says what it needs. */
  function onLayerButton(name) {
    if (setLayer(name) || name !== 'data') return
    hint = NO_FOCUS_HINT
    paintChrome()
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return
    const n = ['1', '2', '3'].indexOf(e.key)
    if (n !== -1) {
      onLayerButton(LAYERS[n])
      e.preventDefault?.()
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      back()
      e.preventDefault?.()
    }
  }

  // ---------------------------------------------------------------- lookups + chrome

  function classById(id) { return (latestGraph?.classes || []).find(c => c.id === id) || null }
  function fnById(id) { return (latestGraph?.nodes || []).find(n => n.id === id) || null }

  function focusExists(f) {
    return f.layer === 'classes' ? !!classById(f.id) : !!fnById(f.id)
  }

  function focusLabel(f) {
    if (!f) return 'this selection'
    if (f.layer === 'classes') return classById(f.id)?.name ?? f.id
    return fnById(f.id)?.qname ?? f.id
  }

  function breadcrumb() {
    const trail = []
    const drilled = () => {
      if (drillFrom) trail.push('Classes', classById(drillFrom)?.name ?? drillFrom)
      else trail.push('Functions')
    }
    if (layer === 'classes') {
      trail.push('Classes')
      if (focus?.layer === 'classes') trail.push(focusLabel(focus))
    } else if (layer === 'functions') {
      drilled()
      if (focus?.layer === 'functions') trail.push(focusLabel(focus))
    } else {
      if (dataFocus?.layer === 'classes') trail.push('Classes')
      else drilled()
      if (dataFocus) trail.push(focusLabel(dataFocus))
      trail.push('data')
    }
    return trail.join(' › ')
  }

  function paintChrome() {
    plain.layer = layer
    for (const name of LAYERS) {
      const el = doc.getElementById(`layer-${name}`)
      if (!el) continue
      setAttr(el, 'aria-pressed', String(name === layer))
      // aria-disabled, not disabled: the button stays clickable so it can explain what it needs
      if (name === 'data') setAttr(el, 'aria-disabled', String(!focus && layer !== 'data'))
    }
    const crumb = doc.getElementById('breadcrumb')
    if (crumb) crumb.textContent = latestGraph ? breadcrumb() : LAYER_LABELS[layer]
    const hintEl = doc.getElementById('layer-hint')
    if (hintEl) {
      hintEl.textContent = hint || ''
      hintEl.hidden = !hint
    }
    paintStatus()
  }

  /** Forgets saved positions in the current layer and lays it out again. */
  function relayout() {
    if (!latestGraph) return
    if (layer === 'classes') {
      const patch = { classes: {} }
      for (const id of Object.keys(layout.classes || {})) patch.classes[id] = null
      if (!isEmptyPatch(patch)) live.saveLayout(patch)
      layout = applyLayoutPatch(layout, patch)
      render()
      graph.fitToContent()
      return
    }
    if (layer !== 'functions' || currentScene?.mode === 'files') return
    const patch = { nodes: {}, groups: {}, orphans: {} }
    for (const k of ['nodes', 'groups', 'orphans']) for (const id of Object.keys(layout[k])) patch[k][id] = null
    live.saveLayout(patch)
    layout = applyLayoutPatch(layout, patch)
    render()
    graph.fitToContent()
  }
  plain.relayout = relayout

  async function start() {
    renderInspector(doc, null, inspectorGraph)
    paintChrome()
    doc.getElementById('relayout')?.addEventListener('click', relayout)
    doc.getElementById('inspector-close')?.addEventListener('click', () => {
      renderInspector(doc, null, inspectorGraph)
      graph.select?.(null)
    })
    for (const name of LAYERS) {
      doc.getElementById(`layer-${name}`)?.addEventListener('click', () => onLayerButton(name))
    }
    win.addEventListener?.('keydown', onKey)
    layout = await live.loadLayout()
    const { close } = live.connect({ onGraph, onStatus, onConnection, onHello })
    closeLive = close
  }

  const ready = start()

  return {
    ready,
    graph,
    plain,
    close() {
      closeLive?.()
      win.removeEventListener?.('keydown', onKey)
    },
  }
}

function setAttr(el, name, value) {
  if (typeof el.setAttribute === 'function') el.setAttribute(name, value)
  else el[name] = value
}

/** Folder boxes that still mean something: in a flow layout a directory's functions can be
 * spread across the canvas, so skip any box that overlaps another folder's box or encloses
 * a function from a different directory. */
export function drawableGroups(scene) {
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  return scene.groups.filter(g =>
    !scene.groups.some(o => o !== g && hit(g, o)) &&
    !scene.nodes.some(n => dirOf(n.file) !== g.id && hit(g, n)))
}

/** Dynamically imports the real modules and boots the app against the live canvas. */
export async function main() {
  const canvas = document.getElementById('canvas')
  const [live, mergeMod, ceilingMod, graphMod, nodeMod, groupMod, thMod,
    classesMod, classNodeMod, classEdgeMod, dataMod] = await Promise.all([
    import('./components/live.js'),
    import('./components/merge.js'),
    import('./components/ceiling.js'),
    import('./components/graph.js'),
    import('./components/node.js'),
    import('./components/group.js'),
    import('./components/th.js'),
    import('./components/classes.js'),
    import('./components/class_node.js'),
    import('./components/class_edge.js'),
    // L3 is built separately; the rest of the app still runs if it fails to load
    import('./components/data_view.js').catch((err) => {
      console.warn('data view unavailable', err)
      return null
    }),
  ])

  const app = createApp({
    live,
    merge: mergeMod.merge,
    applyCeiling: ceilingMod.applyCeiling,
    Graph: graphMod.default,
    CodeNode: nodeMod.CodeNode,
    FolderGroup: groupMod.FolderGroup,
    buildEdges: thMod.buildEdges,
    buildClassScene: classesMod.buildClassScene,
    ClassNode: classNodeMod.ClassNode,
    buildClassEdges: classEdgeMod.buildClassEdges,
    buildDataScene: dataMod?.buildDataScene,
  }, { canvas, doc: document, win: window })

  window.__plainApp = app
  await app.ready
  return app
}

if (typeof window !== 'undefined' && !window.__PLAIN_NO_AUTOSTART__) {
  main()
}
