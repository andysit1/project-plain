// L3 data layer: buildDataScene(codeGraph, focusId) -> { groups, edges, nodes } for graph.setScene.
// Frame view (focusId = CodeNode id): a frame box of FrameVars on the left, the heap they point
// to laid out left-to-right as a tree (one column per pointer depth), loop cursors on the data.
// Schema view (focusId = CodeClass id): the class box on the left, its field shapes to the right.
// Recursive structures unroll to a fixed depth; every recursion is guarded by depth + class path.

import { DataBox, SEQ_GLYPHS, unwrap, isRef, shapeLabel, shortCls, refersTo } from './shape.js'
import { PointerEdge, CursorEdge, TraversalEdge } from './shape_edges.js'

const COL_GAP = 70, ROW_GAP = 22, ROOT_GAP = 34, HEAP_X_GAP = 90
const MAX_DEPTH = 5, MAX_BOXES = 90, SEQ_FANOUT_DEPTH = 1
const CURSOR_RESERVE = 30, CURSOR_STEP = 16, TRAVERSAL_RESERVE = 40, BACK_RESERVE = 30
const RING_GAP_X = 60, RING_GAP_Y = 44
const SCOPES = [['param', 'params'], ['local', 'locals'], ['self', 'self'], ['global', 'globals']]
const CHAIN_LEVELS = 2 // linked lists: 3 boxes (levels 0..2) then …
const TREE_LEVELS = 2  // trees: root + 2 levels, deeper links show …

/**
 * @param {import('../../../shared/contracts.js').CodeGraph} codeGraph
 * @param {string} focusId CodeNode id (frame view) or CodeClass id (schema view)
 * @returns {{ groups: object[], edges: object[], nodes: DataBox[] } | null}
 */
export function buildDataScene(codeGraph, focusId, { kind } = {}) {
  if (!codeGraph || typeof focusId !== 'string') return null
  // A module pseudo-class id equals its file's '<module>' function id; `kind` says which view.
  const frame = kind !== 'class' && codeGraph.frames && codeGraph.frames[focusId]
  if (frame) return frameScene(codeGraph, focusId, frame)
  if (kind === 'function') return null
  const cls = (codeGraph.classes || []).find(c => c.id === focusId)
  if (cls) return schemaScene(codeGraph, cls)
  return null
}

// ---------------------------------------------------------------- heap builder

class Builder {
  constructor(graph, prefix) {
    this.classes = new Map((graph.classes || []).map(c => [c.id, c]))
    this.prefix = prefix
    this.n = 0
    this.boxes = []
    this.edges = []           // edge specs, turned into drawables at the end
    this.chains = new Map()   // chain root box id -> box ids of a linked-list chain
    this.itemOf = new Map()   // box id -> layout item
  }

  nextId(tag) { return `${this.prefix}:${tag}${this.n++}` }
  full() { return this.boxes.length >= MAX_BOXES }
  canRef(shape, depth) { return isRef(shape) && depth <= MAX_DEPTH && !this.full() }

  box(data) {
    const b = new DataBox({ id: this.nextId(data.glyph), ...data })
    this.boxes.push(b)
    return b
  }

  item(box, children = []) {
    const it = { box, children, w: box.data.w, h: box.data.h, members: [box] }
    this.itemOf.set(box.id, it)
    return it
  }

  link(from, port, to, kind = 'pointer', dashed = false, lane = 0) {
    this.edges.push({ id: this.nextId('e'), kind, from, to, port, dashed, lane })
  }

  label(s) { return shapeLabel(s, this.classes) }

  // Layout item for a reference shape, or null when it draws inline.
  ref(shape, o) {
    const { core, optional } = unwrap(shape)
    if (!this.canRef(core, o.depth)) return null
    switch (core.k) {
      case 'list': case 'tuple': case 'set': return this.seq(core, optional, o)
      case 'dict': return this.dict(core, optional, o)
      case 'record': return this.record(core, optional, o)
      case 'obj': return this.obj(core.cls, { ...o, optional })
      case 'union': return this.union(core, optional, o)
      default: return null
    }
  }

  // Children of a container: builds each ref slot and links it from `port`.
  fill(box, slots, o) {
    const children = []
    for (const s of slots) {
      const child = this.ref(s.shape, { ...o, depth: o.depth + 1 })
      if (child) { children.push(child); this.link(box.id, s.port, child.box.id) }
    }
    return children
  }

  seq(core, optional, o) {
    const known = Number.isInteger(core.len) && core.len >= 0
    const inTree = o.struct && o.struct.kind === 'tree' && refersTo(core.of, o.struct.cls)
    const n = known ? Math.min(core.len, 8) : (inTree ? 2 : 3)
    const more = !known || core.len > 8
    const elemRef = this.canRef(core.of, o.depth + 1)
    const elem = unwrap(core.of).core
    const cells = []
    for (let i = 0; i < n; i++) {
      // fan out every cell near the frame (grid = list of lists looks 2-D), only the first deeper down
      const ref = elemRef && (o.depth <= SEQ_FANOUT_DEPTH || i === 0 || inTree)
      cells.push({ key: `c${i}`, ref, text: ref ? '' : (elem.k === 'unknown' ? '?' : '') })
    }
    if (more) cells.push({ key: 'more', more: true })
    const len = known ? `len ${core.len}` : 'len ?'
    const box = this.box({ glyph: core.k, title: `${core.k} · ${len}`, cells, elem: `of ${this.label(core.of)}`, optional, src: o.src })
    const slots = cells.filter(c => c.ref).map(c => ({ port: c.key, shape: core.of }))
    return this.item(box, this.fill(box, slots, { ...o, struct: inTree ? o.struct : null, parentId: null }))
  }

  dict(core, optional, o) {
    const valRef = this.canRef(core.val, o.depth + 1)
    const entries = [
      { key: 'v', left: this.label(core.key), right: valRef ? '' : this.label(core.val), ref: valRef, inline: unwrap(core.val).core.k === 'unknown' ? '?' : null },
      { key: 'more', more: true },
    ]
    const box = this.box({ glyph: 'dict', title: 'dict', entries, optional, src: o.src })
    return this.item(box, valRef ? this.fill(box, [{ port: 'v', shape: core.val }], o) : [])
  }

  record(core, optional, o) {
    const fields = Object.entries(core.fields || {})
    const entries = fields.map(([k, s]) => {
      const ref = this.canRef(s, o.depth + 1)
      return { key: `k:${k}`, left: k, keyIsName: true, right: ref ? '' : this.label(s), ref }
    })
    const box = this.box({ glyph: 'record', title: 'record', entries, optional, src: o.src })
    const slots = fields.filter((_, i) => entries[i].ref).map(([k, s]) => ({ port: `k:${k}`, shape: s }))
    return this.item(box, this.fill(box, slots, o))
  }

  union(core, optional, o) {
    const entries = core.of.map((s, i) => {
      const ref = this.canRef(s, o.depth + 1)
      return { key: `u${i}`, label: `alt ${i + 1}`, type: this.label(s), ref }
    })
    const box = this.box({ glyph: 'union', title: 'union', entries, optional, src: o.src })
    const slots = core.of.map((s, i) => ({ port: `u${i}`, shape: s })).filter((_, i) => entries[i].ref)
    return this.item(box, this.fill(box, slots, o))
  }

  // An instance of a class: one row per field, recursing into reference fields.
  // Recursive structures (class.structure) unroll: chains to 3 boxes + …, trees 2 levels deep,
  // graphs as a ring of 4. Any other self/mutual reference stops at the class path with "…".
  obj(clsId, o) {
    const cls = this.classes.get(clsId)
    const kind = cls ? cls.structure : null
    let struct = o.struct && o.struct.cls === clsId ? { ...o.struct, level: o.struct.level + 1 } : null
    if (!struct && kind && !o.asClass) {
      if (kind === 'graph') return this.ring(cls, o)
    }
    if (!struct && kind && kind !== 'graph') struct = { cls: clsId, kind, level: 0, chain: [] }
    const path = new Set(o.path || [])
    path.add(clsId)
    const linear = struct && (struct.kind === 'linked-list' || struct.kind === 'doubly-linked-list')
    const maxLevel = linear ? CHAIN_LEVELS : TREE_LEVELS

    const plans = (cls ? cls.fields : []).map(f => {
      const s = f.shape || { k: 'unknown' }
      const e = { key: `f:${f.name}`, label: f.name, type: this.label(s), src: f.src, ref: false }
      const { core } = unwrap(s)
      if (core.k === 'unknown') e.inline = '?'
      if (isNone(s)) e.inline = 'none'
      const self = refersTo(s, clsId)
      let act = null
      if (self && kind === 'graph' && o.asClass) act = 'ring'
      else if (self && struct) {
        if (struct.kind === 'doubly-linked-list' && isBackName(f.name)) {
          act = struct.level > 0 && o.parentId ? 'back' : null
          if (!act) { e.type = 'None'; e.inline = 'none' }
        } else if (struct.level >= maxLevel) {
          act = linear ? 'ellipsis' : null
          if (!act) e.type = '…'
        } else act = 'child'
      } else if (self || [...path].some(c => c !== clsId && refersTo(s, c) && isRef(s))) {
        e.type = `${e.type} …`
      } else if (this.canRef(s, o.depth + 1)) act = 'child'
      if (act) e.ref = true
      return { f, s, e, act }
    })

    const title = o.asClass ? `class ${shortCls(clsId, this.classes)}` : shortCls(clsId, this.classes)
    const box = this.box({ glyph: o.asClass ? 'class' : 'obj', title, entries: plans.map(p => p.e), optional: !!o.optional, src: o.src })
    if (struct && linear) {
      struct.chain.push(box.id)
      if (struct.level === 0) this.chains.set(box.id, struct.chain)
    }

    const children = []
    for (const p of plans) {
      const port = p.e.key
      if (p.act === 'child') {
        const sub = { depth: o.depth + 1, path, src: p.f.src, struct: struct && refersTo(p.s, clsId) ? struct : null, parentId: box.id }
        const child = this.ref(p.s, sub)
        if (child) { children.push(child); this.link(box.id, port, child.box.id) }
      } else if (p.act === 'ellipsis') {
        const el = this.box({ glyph: 'ellipsis', title: '…' })
        children.push(this.item(el))
        this.link(box.id, port, el.id, 'pointer', true)
      } else if (p.act === 'back') {
        this.link(box.id, port, o.parentId, 'back', false, struct.level)
        box.data.reserveBelow = Math.max(box.data.reserveBelow, BACK_RESERVE)
        const parent = this.itemOf.get(o.parentId)
        if (parent) parent.box.data.reserveBelow = Math.max(parent.box.data.reserveBelow, BACK_RESERVE)
      } else if (p.act === 'ring') {
        const ring = this.ring(cls, { ...o, depth: o.depth + 1, asClass: false })
        if (ring) { children.push(ring); this.link(box.id, port, ring.box.id) }
      }
    }
    return this.item(box, children)
  }

  // A graph-structured class: a ring of 4 instances with ring edges plus two dashed cross edges.
  ring(cls, o) {
    if (this.boxes.length + 4 > MAX_BOXES) return null
    const selfField = cls.fields.find(f => refersTo(f.shape, cls.id))
    const boxes = [0, 1, 2, 3].map(() => this.box({
      glyph: 'obj', title: cls.name, src: o.src,
      entries: cls.fields.map(f => ({
        key: `f:${f.name}`, label: f.name, src: f.src, ref: f === selfField,
        type: f === selfField ? this.label(f.shape) : this.label(f.shape || { k: 'unknown' }),
        inline: unwrap(f.shape).core.k === 'unknown' ? '?' : null,
      })),
    }))
    const port = selfField ? `f:${selfField.name}` : null
    // ring order around the 2x2 block: TL -> TR -> BR -> BL -> TL, then the diagonals
    for (let i = 0; i < 4; i++) this.link(boxes[i].id, port, boxes[(i + 1) % 4].id, 'link')
    this.link(boxes[0].id, port, boxes[2].id, 'cross', true)
    this.link(boxes[1].id, port, boxes[3].id, 'cross', true)
    const bw = Math.max(...boxes.map(b => b.data.w)), bh = Math.max(...boxes.map(b => b.data.h))
    const offs = [[0, 0], [bw + RING_GAP_X, 0], [bw + RING_GAP_X, bh + RING_GAP_Y], [0, bh + RING_GAP_Y]]
    const it = {
      box: boxes[0], children: [], members: boxes,
      w: bw * 2 + RING_GAP_X, h: bh * 2 + RING_GAP_Y + 20,
      place(x, y) { boxes.forEach((b, i) => b.moveTo(x + offs[i][0], y + offs[i][1])) },
    }
    for (const b of boxes) this.itemOf.set(b.id, it)
    return it
  }

  scene(groups = []) {
    const byId = new Map(this.boxes.map(b => [b.id, b]))
    const boxOf = id => byId.get(id)
    const edges = []
    const cursors = []
    for (const e of this.edges) {
      if (e.kind === 'cursor') cursors.push(new CursorEdge(e, boxOf))
      else if (e.kind === 'traversal') edges.push(new TraversalEdge(e, boxOf))
      else edges.push(new PointerEdge(e, boxOf))
    }
    // higher cursor slots first, so lower slots' label pills draw over their stems
    cursors.sort((a, b) => (b.data.slot || 0) - (a.data.slot || 0))
    return { groups, edges: [...edges, ...cursors], nodes: this.boxes.slice() }
  }
}

const isNone = s => !!s && s.k === 'prim' && s.t === 'none'
const isBackName = n => /^(prev|previous|back|parent)$/i.test(n)

// ---------------------------------------------------------------- layout

// Left-to-right tidy tree: one column per depth, each subtree owns a disjoint vertical band.
function layoutForest(roots, x0) {
  const colW = []
  const measure = (it, d) => {
    colW[d] = Math.max(colW[d] || 0, it.w)
    for (const c of it.children) measure(c, d + 1)
  }
  for (const r of roots) measure(r.item, 0)
  const colX = []
  let x = x0
  for (let d = 0; d < colW.length; d++) { colX[d] = x; x += colW[d] + COL_GAP }

  const place = (it, d, yTop) => {
    if (it.place) it.place(colX[d], yTop)
    else it.box.moveTo(colX[d], yTop)
    let cy = yTop
    for (const c of it.children) cy += place(c, d + 1, cy) + ROW_GAP
    const kids = it.children.length ? cy - ROW_GAP - yTop : 0
    const reserve = Math.max(0, ...it.members.map(b => b.data.reserveBelow || 0))
    return Math.max(it.h + reserve, kids)
  }
  let y = 0
  for (const r of roots) {
    const top = Math.max(y, r.yMin || 0)
    y = top + place(r.item, 0, top) + ROOT_GAP
  }
}

// ---------------------------------------------------------------- frame view

function frameScene(graph, focusId, frame) {
  const B = new Builder(graph, `l3:${focusId}`)
  const node = (graph.nodes || []).find(n => n.id === focusId)
  const fname = node ? node.name : String(focusId).split('::').pop()
  const frameId = `l3:${focusId}:frame`

  // rows grouped by scope
  const vars = Array.isArray(frame.vars) ? frame.vars : []
  const entries = []
  const ordered = []
  for (const [scope, title] of SCOPES) {
    const vs = vars.filter(v => v.scope === scope)
    if (!vs.length) continue
    entries.push({ section: title })
    for (const v of vs) {
      const shape = v.shape || { k: 'unknown' }
      const e = { key: `v:${v.name}`, label: scope === 'self' ? `self.${v.name}` : v.name, type: B.label(shape), src: v.src, ref: B.canRef(shape, 0) }
      if (unwrap(shape).core.k === 'unknown') e.inline = '?'
      if (isNone(shape)) e.inline = 'none'
      entries.push(e)
      ordered.push({ v, e, shape })
    }
  }

  // heap roots; a second pointer to an already drawn recursive structure aliases it (dashed)
  const roots = []
  const varBox = new Map()
  const structRoot = new Map()
  for (const { v, e, shape } of ordered) {
    if (!e.ref) continue
    const { core } = unwrap(shape)
    const cls = core.k === 'obj' ? B.classes.get(core.cls) : null
    if (cls && cls.structure && structRoot.has(cls.id)) {
      const target = structRoot.get(cls.id)
      B.link(frameId, e.key, target.id, 'alias', true)
      setVar(varBox, v, target)
      continue
    }
    const item = B.ref(shape, { depth: 0, path: new Set(), src: v.src })
    if (!item) { e.ref = false; continue }
    if (cls && cls.structure) structRoot.set(cls.id, item.box)
    B.link(frameId, e.key, item.box.id)
    setVar(varBox, v, item.box)
    roots.push({ item, key: e.key })
  }

  const chips = loopsOnto(B, frameId, frame.loops, varBox)
  const fbox = new DataBox({ id: frameId, glyph: 'frame', title: `${fname}()`, name: fname, entries, chips })
  B.boxes.unshift(fbox)

  // heap trees start to the right of the frame, each near the row that points at it
  const x0 = fbox.data.w + HEAP_X_GAP
  layoutForest(roots.map(r => ({ item: r.item, yMin: Math.max(0, fbox.port(r.key).y - 12) })), x0)
  return B.scene()
}

function setVar(map, v, box) {
  map.set(v.name, box)
  if (v.scope === 'self') map.set(`self.${v.name}`, box)
}

// Turns frame.loops into cursors / traversal arrows on drawn boxes; returns chip lines for the
// loops that walk something not drawn (range(n), line.split(), ...).
function loopsOnto(B, frameId, loops, varBox) {
  const list = (Array.isArray(loops) ? loops : []).slice().sort((a, b) => (a.line || 0) - (b.line || 0))
  const slots = new Map()
  const loopBox = new Map()
  const pending = []
  const iterable = b => b && (SEQ_GLYPHS.has(b.glyph) || b.glyph === 'dict' || b.glyph === 'record')
  const firstChild = b => {
    const it = b && B.itemOf.get(b.id)
    return it && it.box === b && it.children.length ? it.children[0].box : null
  }
  const cursor = (box, loop, dashed, suffix = '') => {
    const slot = slots.get(box.id) || 0
    slots.set(box.id, slot + 1)
    box.data.reserveBelow = Math.max(box.data.reserveBelow, CURSOR_RESERVE + slot * CURSOR_STEP)
    B.edges.push({
      id: B.nextId('e'), kind: 'cursor', from: frameId, to: box.id, cell: slot, slot, dashed,
      label: `${loop.var || '?'} ↻ L${loop.line}${suffix}`,
    })
  }

  for (const loop of list) {
    const over = String(loop.over || '').trim()
    if (loop.kind === 'for') {
      let box = varBox.get(over) || null
      if (!iterable(box)) box = null
      // for x in row, where row is the target of an outer loop: step into the element box
      if (!box && loopBox.has(over)) box = firstChild(loopBox.get(over))
      if (!box) {
        const m = over.match(/^range\(\s*len\(\s*([\w.]+)\s*\)\s*\)$/)
        const b = m && varBox.get(m[1])
        if (iterable(b)) { cursor(b, loop, true, ' · index'); loopBox.set(loop.var, b); continue }
      }
      if (iterable(box)) { cursor(box, loop, false); loopBox.set(loop.var, box); continue }
    } else if (loop.kind === 'while' && loop.step) {
      const box = varBox.get(loop.var) || varBox.get(over)
      const chain = box && B.chains.get(box.id)
      if (chain && chain.length > 1) {
        for (const id of chain) {
          const b = B.boxes.find(x => x.id === id)
          if (b) b.data.reserveBelow = Math.max(b.data.reserveBelow, TRAVERSAL_RESERVE)
        }
        B.edges.push({
          id: B.nextId('e'), kind: 'traversal', from: frameId, to: chain[0], chain: chain.slice(),
          label: `${loop.var || over} ↻ L${loop.line} · .${loop.step}`,
        })
        continue
      }
    }
    pending.push(loop)
  }

  // Index loops: consecutive `for i in range(...)` over a frame's nested list become row/column
  // cursors (dashed: inferred), one per nesting level. Anything left over is a chip.
  const ranges = pending.filter(l => l.kind === 'for' && /^range\(/.test(String(l.over)))
  if (ranges.length >= 2) {
    let best = []
    for (const b of new Set(varBox.values())) {
      if (!b || !SEQ_GLYPHS.has(b.glyph)) continue
      const levels = [b]
      let c = firstChild(b)
      while (c && SEQ_GLYPHS.has(c.glyph) && levels.length < ranges.length) { levels.push(c); c = firstChild(c) }
      if (levels.length > best.length) best = levels
    }
    if (best.length >= 2) {
      best.forEach((b, i) => {
        const l = ranges[i]
        cursor(b, l, true, i === 0 ? ' · row' : i === 1 ? ' · col' : '')
        pending.splice(pending.indexOf(l), 1)
      })
    }
  }
  return pending.map(l => l.kind === 'while'
    ? `↻ L${l.line}  while ${l.over || l.var}${l.step ? ` (.${l.step})` : ''}`
    : `↻ L${l.line}  for ${l.var} in ${l.over || '?'}`)
}

// ---------------------------------------------------------------- schema view

function schemaScene(graph, cls) {
  const B = new Builder(graph, `l3:${cls.id}`)
  const root = B.obj(cls.id, { depth: 0, path: new Set(), asClass: true })
  if (root.box.data.glyph === 'class') {
    root.box.data.name = cls.name
    if (cls.structure) root.box.data.title = `${root.box.data.title} · ${cls.structure}`
    root.box.remeasure()
    root.w = root.box.data.w; root.h = root.box.data.h
  }
  // the class box must be the first node (index 0) whatever the builder created first
  const i = B.boxes.indexOf(root.box)
  if (i > 0) { B.boxes.splice(i, 1); B.boxes.unshift(root.box) }
  layoutForest([{ item: root, yMin: 0 }], 0)
  return B.scene()
}
