// Orthogonal edge router: every call leaves the RIGHT side of the caller and enters the
// LEFT side of the callee, running through the gaps between nodes, never through a node.
//
//  - Ports: each node side spreads its edges out (sorted by where the other end is),
//    so no two arrows share an attachment point.
//  - Routes: a direct Z (out, one vertical in the gap, in) when that is clear; otherwise
//    out -> down/up in the gap -> across on a free horizontal channel -> in. Back edges
//    (callee left of caller) use the same shape, looping around on a free channel.
//  - Tracks: vertical and horizontal runs that would lie on top of each other are spread
//    TRACK px apart, so arrows never overlap.
//
// Browser ES module, no imports needed.

export const TRACK = 10     // spacing between parallel runs
const STUB = 30             // how far a route leaves a port before turning
const CLEAR = 8             // minimum clearance between a route and any node
const CELL = 256            // spatial index cell size
const MAX_ROUTED_EDGES = 4000 // above this, callers fall back to straight lines

/**
 * @param {{id:string, from:string, to:string}[]} edges
 * @param {(id:string) => ({x,y,w,h}|undefined)} boxOf
 * @param {() => {x,y,w,h,id?:string}[]} obstacles every node box (with its id)
 */
export class Router {
  constructor(edges, boxOf, obstacles) {
    this.edges = edges
    this.boxOf = boxOf
    this.obstacles = obstacles
    this.routes = null // Map(edgeId -> [{x,y}, ...]) or null when stale
    this.ends = new Map() // edgeId -> "x,y,x,y" of its end boxes when last routed
  }

  get enabled() { return this.edges.length <= MAX_ROUTED_EDGES }

  /** Polyline for an edge, or null. Recomputes everything when any end box has moved. */
  routeOf(edge) {
    if (this.routes) {
      const a = this.boxOf(edge.from), b = this.boxOf(edge.to)
      if (!a || !b) return null
      if (this.ends.get(edge.id) !== key(a, b)) this.routes = null // a node was dragged
    }
    if (!this.routes) this.compute()
    return this.routes.get(edge.id) || null
  }

  compute() {
    this.routes = new Map()
    this.ends = new Map()
    const index = new SpatialIndex(this.obstacles())
    const live = []
    for (const e of this.edges) {
      if (e.from === e.to) continue
      const a = this.boxOf(e.from), b = this.boxOf(e.to)
      if (!a || !b) continue
      live.push({ e, a, b })
      this.ends.set(e.id, key(a, b))
    }

    // ports: spread each side's edges along it, ordered by the far end's y (fewer crossings)
    const outs = groupBy(live, r => r.e.from), ins = groupBy(live, r => r.e.to)
    for (const list of outs.values()) spread(list, r => r.b.y + r.b.h / 2, (r, y) => { r.ys = y }, r => r.a)
    for (const list of ins.values()) spread(list, r => r.a.y + r.a.h / 2, (r, y) => { r.yt = y }, r => r.b)

    const segs = [] // horizontal channel runs already taken, so later edges pick other channels
    for (const r of live) {
      r.pts = routeOne(r, index, segs)
      this.routes.set(r.e.id, r.pts)
    }
    separate(live, index)
  }
}

function key(a, b) { return `${a.x},${a.y},${a.w},${a.h},${b.x},${b.y},${b.w},${b.h}` }

function groupBy(list, f) {
  const m = new Map()
  for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}

function spread(list, order, set, boxOfSide) {
  list.sort((p, q) => order(p) - order(q) || (p.e.id < q.e.id ? -1 : 1))
  const box = boxOfSide(list[0])
  list.forEach((r, i) => set(r, box.y + (box.h * (i + 1)) / (list.length + 1)))
}

// ---------------------------------------------------------------- routing one edge

function routeOne(r, index, segs) {
  const { a, b, ys, yt } = r
  const sx = a.x + a.w, tx = b.x
  const none = [] // the route may only touch its own nodes at the port stubs

  // 1) Z: caller is left of callee and one vertical in the gap between them is clear
  if (tx - sx >= 2 * STUB) {
    const xm = (sx + tx) / 2
    if (index.clearH(sx, xm, ys, [a]) && index.clearV(xm, ys, yt, none) && index.clearH(xm, tx, yt, [b])) {
      return [{ x: sx, y: ys }, { x: xm, y: ys }, { x: xm, y: yt }, { x: tx, y: yt }]
    }
  }

  // 2) channel: out to xa, vertical to a free horizontal channel yc, across to xb, vertical, in
  const xa = sx + STUB, xb = tx - STUB
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb)
  const candidates = new Set([ys, yt, (ys + yt) / 2])
  for (const o of index.inRange(lo, hi)) {
    candidates.add(o.y - CLEAR - TRACK)
    candidates.add(o.y + o.h + CLEAR + TRACK)
  }
  const cost = y => Math.abs(y - ys) + Math.abs(y - yt)
  const sorted = [...candidates].sort((p, q) => cost(p) - cost(q))
  let yc = null
  for (const y of sorted) {
    if (!index.clearH(lo, hi, y, none)) continue
    if (!index.clearV(xa, ys, y, none) || !index.clearV(xb, y, yt, none)) continue
    if (segs.some(s => Math.abs(s.y - y) < TRACK && s.lo < hi && lo < s.hi)) continue
    yc = y
    break
  }
  if (yc === null) yc = sorted.find(y => index.clearH(lo, hi, y, none)) ?? Math.max(a.y + a.h, b.y + b.h) + CLEAR + TRACK
  segs.push({ y: yc, lo, hi })
  return simplify([{ x: sx, y: ys }, { x: xa, y: ys }, { x: xa, y: yc }, { x: xb, y: yc }, { x: xb, y: yt }, { x: tx, y: yt }])
}

/** Drops zero-length and collinear points. */
function simplify(pts) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1]
    if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) continue
    if (out.length >= 2) {
      const o = out[out.length - 2]
      if ((Math.abs(o.x - q.x) < 0.5 && Math.abs(q.x - p.x) < 0.5) ||
          (Math.abs(o.y - q.y) < 0.5 && Math.abs(q.y - p.y) < 0.5)) { out[out.length - 1] = p; continue }
    }
    out.push(p)
  }
  return out
}

// ---------------------------------------------------------------- overlap removal

/** Spreads interior runs that lie on top of each other onto parallel tracks. The first and
 * last points sit on ports, so the runs touching them never move sideways. */
function separate(live, index) {
  const runs = { v: [], h: [] }
  for (const r of live) {
    const p = r.pts
    for (let i = 1; i < p.length - 2; i++) {
      const s = { r, i, p: p[i], q: p[i + 1] }
      if (Math.abs(s.p.x - s.q.x) < 0.5) runs.v.push(s)
      else if (i > 1 || p.length > 4) runs.h.push(s) // interior horizontal channel
    }
  }
  for (const [kind, list] of Object.entries(runs)) {
    const at = s => (kind === 'v' ? s.p.x : s.p.y)
    const span = s => kind === 'v' ? [Math.min(s.p.y, s.q.y), Math.max(s.p.y, s.q.y)]
                                    : [Math.min(s.p.x, s.q.x), Math.max(s.p.x, s.q.x)]
    list.sort((s, t) => at(s) - at(t))
    const done = new Set()
    for (const s of list) {
      if (done.has(s)) continue
      // cluster: runs on the same line whose extents overlap (transitively)
      const cluster = [s]
      done.add(s)
      for (let k = 0; k < cluster.length; k++) {
        const c = cluster[k], [c0, c1] = span(c)
        for (const t of list) {
          if (done.has(t) || Math.abs(at(t) - at(c)) >= TRACK) continue
          const [t0, t1] = span(t)
          if (t0 < c1 && c0 < t1) { cluster.push(t); done.add(t) }
        }
      }
      if (cluster.length < 2) continue
      // order along the perpendicular by where each run comes from, to avoid crossing
      cluster.sort((u, w) => (kind === 'v' ? u.r.ys - w.r.ys : u.r.a.x - w.r.a.x) || (u.r.e.id < w.r.e.id ? -1 : 1))
      const base = cluster.reduce((m, c) => m + at(c), 0) / cluster.length
      cluster.forEach((c, k) => {
        const v = base + (k - (cluster.length - 1) / 2) * TRACK
        if (kind === 'v') { c.p.x = v; c.q.x = v } else { c.p.y = v; c.q.y = v }
      })
    }
  }
}

// ---------------------------------------------------------------- spatial index over node boxes

class SpatialIndex {
  constructor(boxes) {
    this.cells = new Map()
    this.boxes = boxes
    for (const b of boxes) {
      for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.w) / CELL); cx++) {
        for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.h) / CELL); cy++) {
          const k = `${cx},${cy}`
          if (!this.cells.has(k)) this.cells.set(k, [])
          this.cells.get(k).push(b)
        }
      }
    }
  }

  query(x0, y0, x1, y1) {
    const seen = new Set()
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        for (const b of this.cells.get(`${cx},${cy}`) || []) seen.add(b)
      }
    }
    return seen
  }

  inRange(x0, x1) { return this.boxes.filter(b => b.x < x1 + CLEAR && x0 - CLEAR < b.x + b.w) }

  hits(x0, y0, x1, y1, skip) {
    for (const b of this.query(x0 - CLEAR, y0 - CLEAR, x1 + CLEAR, y1 + CLEAR)) {
      if (skip.some(s => s.x === b.x && s.y === b.y && s.w === b.w && s.h === b.h)) continue
      if (b.x - CLEAR < x1 && x0 < b.x + b.w + CLEAR && b.y - CLEAR < y1 && y0 < b.y + b.h + CLEAR) return true
    }
    return false
  }

  clearH(xa, xb, y, skip) { return !this.hits(Math.min(xa, xb), y, Math.max(xa, xb), y, skip) }
  clearV(x, ya, yb, skip) { return !this.hits(x, Math.min(ya, yb), x, Math.max(ya, yb), skip) }
}
