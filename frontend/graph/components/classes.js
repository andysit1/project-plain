// Scene builder for the L1 classes layer (Scene mode 'classes', see shared/contracts.js).
// One SceneNode per CodeClass, edges = the ClassEdges. Saved spots come from layout.classes;
// a first run lays the classes out top to bottom by flow.js (parents above subclasses, owners and
// callers above what they compose/create/use), new classes later go next to a placed relative.
// Pure: never mutates its inputs. layoutPatch only ever touches `classes`.

import { NODE_W, NODE_H, GRID, NODE_GAP } from '../../../shared/contracts.js'
import { findFreeSpot } from '../utils/placement.js'
import { flowLayout, COL_GAP, ROW_STEP } from '../utils/flow.js'
import { classBoxHeight } from './class_node.js'

const ROW_GAP = 90                 // vertical room between class rows, where edges run
const COL_PITCH = NODE_W + 60      // horizontal pitch of boxes within a row
const LONE_COLS = 4                // grid width for classes with no relations
const snap = v => Math.round(v / GRID) * GRID

/** An empty classes scene (no classes: non-Python repo, or an older server). */
export function emptyClassScene() {
  return { mode: 'classes', nodes: [], groups: [], edges: [], layoutPatch: {}, total: 0 }
}

/**
 * @param {import('../../../shared/contracts.js').CodeGraph} codeGraph
 * @param {import('../../../shared/contracts.js').Layout} layout
 * @returns {import('../../../shared/contracts.js').Scene}
 */
export function buildClassScene(codeGraph, layout) {
  const classes = (codeGraph && codeGraph.classes) || []
  if (!classes.length) return emptyClassScene()
  const saved = (layout && layout.classes) || {}
  const ids = new Set(classes.map(c => c.id))
  const edges = (codeGraph.classEdges || []).filter(e => ids.has(e.from) && ids.has(e.to))
  const heightOf = new Map(classes.map(c => [c.id, classBoxHeight(c)]))

  const patch = {}
  const placed = {}   // id -> {x, y}
  const reserved = [] // rects nothing may overlap
  const reserve = (id, pos) => {
    placed[id] = pos
    reserved.push({ x: pos.x, y: pos.y, w: NODE_W, h: heightOf.get(id) })
  }

  for (const c of classes) if (saved[c.id]) reserve(c.id, { x: saved[c.id].x, y: saved[c.id].y })
  for (const id of Object.keys(saved)) if (!ids.has(id)) patch[id] = null // class is gone

  const fresh = classes.filter(c => !placed[c.id])
  if (fresh.length) {
    const firstRun = fresh.length === classes.length
    const targets = firstRun ? flowTargets(classes, edges, heightOf) : null
    for (const c of fresh) {
      const h = heightOf.get(c.id)
      let near, side
      if (firstRun) {
        const t = targets.get(c.id)
        near = { x: t.x + NODE_W / 2, y: t.y + h / 2 }
      } else {
        ({ near, side } = nearRelative(c, edges, classes, placed, heightOf))
      }
      const pos = findFreeSpot(reserved, NODE_W, h, near, 200, side ? { side } : undefined)
      reserve(c.id, pos)
      patch[c.id] = pos
    }
  }

  const nodes = classes.map(c => ({
    id: c.id,
    name: c.name,
    qname: c.qname,
    file: c.file,
    line: c.line,
    kind: c.kind === 'module' ? 'module' : 'method',
    params: `${c.fields.length} fields · ${c.methods.length} methods`,
    returns: c.bases.join(', '),
    sig: '',
    body: '',
    x: placed[c.id].x,
    y: placed[c.id].y,
    w: NODE_W,
    h: heightOf.get(c.id),
    changed: false,
    // extras for ClassNode and the inspector
    classKind: c.kind,
    bases: c.bases.slice(),
    fields: c.fields.map(f => ({ name: f.name, type: f.type, shape: f.shape })),
    methods: c.methods.slice(),
    structure: c.structure || null,
  }))

  return {
    mode: 'classes',
    nodes,
    groups: [],
    edges,
    layoutPatch: Object.keys(patch).length ? { classes: patch } : {},
    total: classes.length,
  }
}

// First-run targets: flow.js lays a graph out left to right by layer; feed it "upper -> lower"
// edges and turn its columns into rows, so the result reads top to bottom.
function flowTargets(classes, edges, heightOf) {
  const down = []
  for (const e of edges) {
    if (e.from === e.to) continue
    const [a, b] = e.kind === 'inherits' ? [e.to, e.from] : [e.from, e.to]
    down.push({ id: `${a}>${b}`, from: a, to: b, kind: 'call' })
  }
  const linked = new Set(down.flatMap(e => [e.from, e.to]))
  const connected = classes.filter(c => linked.has(c.id))
  const lonely = classes.filter(c => !linked.has(c.id))

  // modules first as entry points, as flow.js does for '<module>' nodes
  const nodes = connected.map(c => ({ id: c.id, kind: c.kind === 'module' ? 'module' : 'method', name: c.name }))
  const flow = flowLayout({ nodes, edges: down })

  const rowOf = new Map()
  for (const [id, p] of flow) rowOf.set(id, Math.round(p.x / (NODE_W + COL_GAP)))
  const rowH = new Map()
  for (const c of connected) {
    const r = rowOf.get(c.id)
    rowH.set(r, Math.max(rowH.get(r) || NODE_H, heightOf.get(c.id)))
  }
  const rowY = new Map()
  let y = 0
  for (const r of [...rowH.keys()].sort((a, b) => a - b)) { rowY.set(r, y); y += rowH.get(r) + ROW_GAP }

  const out = new Map()
  for (const [id, p] of flow) {
    out.set(id, { x: snap((p.y / ROW_STEP) * COL_PITCH), y: snap(rowY.get(rowOf.get(id))) })
  }

  // classes with no relations: a compact grid under the connected part
  const lonelyH = Math.max(NODE_H, ...lonely.map(c => heightOf.get(c.id)))
  lonely.forEach((c, k) => {
    out.set(c.id, {
      x: snap((k % LONE_COLS) * COL_PITCH),
      y: snap(y + Math.floor(k / LONE_COLS) * (lonelyH + NODE_GAP * 2)),
    })
  })
  return out
}

// Where a class added after the first run should go: under a placed parent / owner, above a
// placed subclass / part, else below the lowest class of the same file, else below everything.
function nearRelative(c, edges, classes, placed, heightOf) {
  for (const e of edges) {
    if (e.from === e.to) continue
    const parentSide = e.kind === 'inherits' ? e.to : e.from // the "upper" end
    const childSide = e.kind === 'inherits' ? e.from : e.to
    if (childSide === c.id && placed[parentSide]) {
      const p = placed[parentSide]
      return { near: { x: p.x + NODE_W / 2, y: p.y + heightOf.get(parentSide) + ROW_GAP + heightOf.get(c.id) / 2 }, side: 'below' }
    }
    if (parentSide === c.id && placed[childSide]) {
      const p = placed[childSide]
      return { near: { x: p.x + NODE_W / 2, y: p.y - ROW_GAP - heightOf.get(c.id) / 2 }, side: undefined }
    }
  }
  let lowest = null, bottom = null
  for (const o of classes) {
    const p = placed[o.id]
    if (!p) continue
    const end = p.y + heightOf.get(o.id)
    if (o.file === c.file && (!lowest || end > lowest.end)) lowest = { p, end }
    if (!bottom || end > bottom.end) bottom = { p, end }
  }
  const ref = lowest || bottom
  if (!ref) return { near: { x: 0, y: 0 }, side: undefined }
  return { near: { x: ref.p.x + NODE_W / 2, y: ref.end + NODE_GAP + heightOf.get(c.id) / 2 }, side: 'below' }
}
