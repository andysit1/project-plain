// App shell: wires live data -> merge -> ceiling -> scene -> Graph, and the inspector/status bar.
// This is the ONE module allowed to import anything (see shared/dom.md, tasks/CHANGELOG.md).

import { emptyLayout, isEmptyPatch, applyLayoutPatch } from '../../shared/contracts.js'
import { renderInspector, renderStatus } from './components/info_window.js'

/**
 * Wires the whole pipeline against injected dependencies, so it can run headless in tests.
 *
 * deps: { live, merge, applyCeiling, Graph, CodeNode, FolderGroup, buildEdges, fetch? }
 *   live:         { connect({onGraph,onStatus,onConnection,onHello}) -> {close},
 *                   loadLayout() -> Promise<Layout>, saveLayout(patch), flushLayout() }
 *   merge:        (graph, layout, prevGraph, {viewCenter, now}) -> Scene
 *   applyCeiling: (scene) -> Scene
 *   Graph:        class Graph(canvas) — see shared docs / components/graph.js (T9)
 *   CodeNode:     class CodeNode(sceneNode)
 *   FolderGroup:  class FolderGroup(sceneGroup)
 *   buildEdges:   (codeEdges, boxOf) -> CallEdge[]
 *
 * opts: { canvas, doc = document, win = window }
 *
 * Returns { ready, graph, plain, close } — `ready` resolves once the layout has loaded and the
 * live connection has been opened (it does NOT wait for the first graph to render).
 */
export function createApp(deps, { canvas, doc = document, win = window }) {
  const { live, merge, applyCeiling, Graph, CodeNode, FolderGroup, buildEdges } = deps

  const graph = new Graph(canvas)

  let layout = emptyLayout()
  let prevGraph = null
  let currentScene = null
  let connectionState = 'connecting'
  let lastRebuild = null
  let cameraApplied = false
  let closeLive = null

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
  }
  win.__plain = plain

  // What the inspector needs to resolve callers/callees and to select on click.
  const inspectorGraph = {
    get nodes() { return currentScene?.nodes || [] },
    get edges() { return currentScene?.edges || [] },
    select(id) { graph.select(id) },
  }

  function paintStatus() {
    renderStatus(doc, { connection: connectionState, scene: currentScene, rebuild: lastRebuild })
  }

  graph.onSelect((node) => {
    renderInspector(doc, node, inspectorGraph)
  })

  graph.onMove((node, { x, y }) => {
    if (currentScene?.mode === 'files') return
    live.saveLayout({ nodes: { [node.id]: { x, y } } })
    layout = applyLayoutPatch(layout, { nodes: { [node.id]: { x, y } } })
  })

  graph.onCamera((camera) => {
    live.saveLayout({ camera })
    layout = applyLayoutPatch(layout, { camera })
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
    const viewCenter = graph.viewCenter()
    const scene = applyCeiling(merge(codeGraph, layout, prevGraph, { viewCenter, now: Date.now() }))
    currentScene = scene
    prevGraph = codeGraph
    plain.graph = codeGraph
    plain.scene = scene

    const groups = scene.groups.map(g => new FolderGroup(g))
    const nodesById = new Map(scene.nodes.map(n => [n.id, n]))
    const nodes = scene.nodes.map(n => new CodeNode(n))
    const boxOf = (id) => {
      const n = nodesById.get(id)
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : undefined
    }
    const edges = buildEdges(scene.edges, boxOf)

    graph.setScene({ groups, edges, nodes })

    if (!isEmptyPatch(scene.layoutPatch)) {
      live.saveLayout(scene.layoutPatch)
      layout = applyLayoutPatch(layout, scene.layoutPatch)
    }

    if (!cameraApplied) {
      if (layout.camera) graph.setCamera(layout.camera)
      else graph.fitToContent()
      cameraApplied = true
    }

    plain.renders += 1
    paintStatus()
  }

  async function start() {
    renderInspector(doc, null, inspectorGraph)
    paintStatus()
    doc.getElementById('inspector-close')?.addEventListener('click', () => {
      renderInspector(doc, null, inspectorGraph)
      graph.select?.(null)
    })
    layout = await live.loadLayout()
    const { close } = live.connect({ onGraph, onStatus, onConnection, onHello })
    closeLive = close
  }

  const ready = start()

  return {
    ready,
    graph,
    plain,
    close() { closeLive?.() },
  }
}

/** Dynamically imports the real modules and boots the app against the live canvas. */
export async function main() {
  const canvas = document.getElementById('canvas')
  const [live, mergeMod, ceilingMod, graphMod, nodeMod, groupMod, thMod] = await Promise.all([
    import('./components/live.js'),
    import('./components/merge.js'),
    import('./components/ceiling.js'),
    import('./components/graph.js'),
    import('./components/node.js'),
    import('./components/group.js'),
    import('./components/th.js'),
  ])

  const app = createApp({
    live,
    merge: mergeMod.merge,
    applyCeiling: ceilingMod.applyCeiling,
    Graph: graphMod.default,
    CodeNode: nodeMod.CodeNode,
    FolderGroup: groupMod.FolderGroup,
    buildEdges: thMod.buildEdges,
  }, { canvas, doc: document, win: window })

  window.__plainApp = app
  await app.ready
  return app
}

if (typeof window !== 'undefined' && !window.__PLAIN_NO_AUTOSTART__) {
  main()
}
