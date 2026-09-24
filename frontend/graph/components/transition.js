// CallEdge: draws a CodeEdge (shared/contracts.js) as a line between two node
// boxes, clipped to each box's border with Liang-Barsky, with an arrowhead at
// the target. When both A->B and B->A exist they are assigned opposite lanes
// (see th.js: buildEdges) so they draw as two parallel, non-overlapping lines.
//
// boxOf(id) is called at draw() / bounds() time (never cached), because nodes
// can be dragged after this CallEdge is constructed.
//
// With a `router` (see utils/router.js, attached by buildEdges) the edge instead
// follows an orthogonal route: out of the caller's right side, through the gaps
// between nodes, into the callee's left side, never on top of another edge.

import { liangBarskyClip, perpendicular, boxCenter } from './utils/geometry.js'

export const LANE_GAP = 14
const LINE_WIDTH = 2
const HIGHLIGHT_LINE_WIDTH = 3.5
const ARROW_LENGTH = 10
const ARROW_WIDTH = 7
const LINE_COLOR = '#7a7a7a'
const HIGHLIGHT_COLOR = '#e8c14a'
const CORNER = 8

const EMPTY_RECT = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })

export class CallEdge {
  /**
   * @param {{id:string, from:string, to:string, kind:'call'}} codeEdge
   * @param {(id: string) => ({x:number,y:number,w:number,h:number}|undefined)} boxOf
   * @param {{lane?: number, router?: import('./utils/router.js').Router}} [opts]
   */
  constructor(codeEdge, boxOf, { lane = 0, router = null } = {}) {
    this.data = codeEdge
    this.id = codeEdge.id
    this.boxOf = boxOf
    this.lane = lane
    this.router = router
    this.highlight = false
  }

  /** The routed polyline, or null when there is no router (or it is disabled). */
  _route() {
    if (!this.router || !this.router.enabled || !this.valid()) return null
    return this.router.routeOf(this.data)
  }

  valid() {
    const { from, to } = this.data
    if (from === to) return false
    const a = this.boxOf(from)
    const b = this.boxOf(to)
    return !!a && !!b
  }

  /** Computes the clipped segment endpoints (world space) plus the two arrow
   * base corners, or null when the edge cannot currently be resolved. */
  _geometry() {
    const { from, to } = this.data
    if (from === to) return null
    const boxA = this.boxOf(from)
    const boxB = this.boxOf(to)
    if (!boxA || !boxB) return null

    const centerA = boxCenter(boxA)
    const centerB = boxCenter(boxB)

    // The perpendicular must be computed in a direction-independent (canonical)
    // order, ALWAYS from the lexicographically smaller id's center to the
    // larger id's center. Otherwise A->B and B->A (whose "from"/"to" centers
    // are swapped relative to each other) would each flip the perpendicular's
    // sign, cancelling out the sign flip already applied by `lane`, and both
    // edges would land on the SAME side instead of opposite lanes.
    const perp = from < to
      ? perpendicular(centerA.x, centerA.y, centerB.x, centerB.y)
      : perpendicular(centerB.x, centerB.y, centerA.x, centerA.y)
    const offX = perp.x * this.lane * LANE_GAP
    const offY = perp.y * this.lane * LANE_GAP

    const a = { x: centerA.x + offX, y: centerA.y + offY }
    const b = { x: centerB.x + offX, y: centerB.y + offY }

    // Clip each end back to the border of its own box, walking from the
    // far center towards the near one so the result lands on the border.
    const start = liangBarskyClip(boxA, b.x, b.y, a.x, a.y)
    const end = liangBarskyClip(boxB, a.x, a.y, b.x, b.y)

    // Arrowhead: a small triangle whose tip is `end`, base perpendicular to
    // the line direction, set back by ARROW_LENGTH.
    let dx = end.x - start.x
    let dy = end.y - start.y
    const mag = Math.sqrt(dx * dx + dy * dy) || 1
    dx /= mag
    dy /= mag
    const baseX = end.x - dx * ARROW_LENGTH
    const baseY = end.y - dy * ARROW_LENGTH
    const nx = -dy * (ARROW_WIDTH / 2)
    const ny = dx * (ARROW_WIDTH / 2)
    const baseLeft = { x: baseX + nx, y: baseY + ny }
    const baseRight = { x: baseX - nx, y: baseY - ny }

    return { start, end, baseLeft, baseRight }
  }

  draw(ctx, view) {
    const route = this._route()
    if (route) return this._drawRoute(ctx, view, route)
    const geo = this._geometry()
    if (!geo) return
    const { start, end, baseLeft, baseRight } = geo

    const color = this.highlight ? HIGHLIGHT_COLOR : LINE_COLOR
    const width = (this.highlight ? HIGHLIGHT_LINE_WIDTH : LINE_WIDTH) / view.k

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(baseLeft.x, baseLeft.y)
    ctx.lineTo(baseRight.x, baseRight.y)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  _drawRoute(ctx, view, pts) {
    const color = this.highlight ? HIGHLIGHT_COLOR : LINE_COLOR
    const end = pts[pts.length - 1], prev = pts[pts.length - 2]
    const dir = Math.sign(end.x - prev.x) || 1
    const tip = end, base = { x: end.x - dir * ARROW_LENGTH, y: end.y }

    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], n = pts[i + 1], q = pts[i - 1]
      const r = Math.min(CORNER, Math.hypot(p.x - q.x, p.y - q.y) / 2, Math.hypot(n.x - p.x, n.y - p.y) / 2)
      ctx.arcTo(p.x, p.y, n.x, n.y, r)
    }
    ctx.lineTo(base.x, base.y)
    ctx.lineWidth = (this.highlight ? HIGHLIGHT_LINE_WIDTH : LINE_WIDTH) / view.k
    ctx.strokeStyle = color
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(base.x, base.y - ARROW_WIDTH / 2)
    ctx.lineTo(base.x, base.y + ARROW_WIDTH / 2)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  bounds() {
    const route = this._route()
    if (route) {
      const xs = route.map(p => p.x), ys = route.map(p => p.y)
      const minX = Math.min(...xs), minY = Math.min(...ys) - ARROW_WIDTH
      return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) + ARROW_WIDTH - minY }
    }
    const geo = this._geometry()
    if (!geo) return { ...EMPTY_RECT }
    const { start, end, baseLeft, baseRight } = geo
    const xs = [start.x, end.x, baseLeft.x, baseRight.x]
    const ys = [start.y, end.y, baseLeft.y, baseRight.y]
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
}
