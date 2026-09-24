// ClassEdge: draws one ClassEdge (L1) between two class boxes, styled by kind:
//   inherits     = solid line, hollow triangle at the parent (to) end
//   composes     = solid line, filled diamond at the owner (from) end
//   instantiates = dashed line, open arrow at the created class
//   uses         = thin grey line, width grows a little with weight, small arrow
// Several edges between the same pair spread into parallel lanes; a self-edge
// (ListNode composes ListNode) draws as a small loop off the box's top-right corner.
// boxOf(id) is read at draw time, so edges follow dragged boxes.

import { liangBarskyClip, perpendicular, boxCenter } from './utils/geometry.js'

export const CLASS_LANE_GAP = 12
const HEAD = 12
const LOOP = 26
const HIGHLIGHT_COLOR = '#e8c14a'

export const CLASS_EDGE_STYLES = Object.freeze({
  inherits: { color: '#9fb7d9', width: 2, dash: null },
  composes: { color: '#d9a45f', width: 2, dash: null },
  instantiates: { color: '#7fc8a0', width: 1.75, dash: [7, 5] },
  uses: { color: '#6f757d', width: 1, dash: null },
})

const EMPTY_RECT = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })

export class ClassEdge {
  /**
   * @param {{id:string, from:string, to:string, kind:string, weight:number}} classEdge
   * @param {(id:string) => ({x,y,w,h}|undefined)} boxOf
   * @param {{lane?: number, loop?: number}} [opts] lane: signed offset index for parallel edges;
   *   loop: index of this self-edge on its box (nested loops)
   */
  constructor(classEdge, boxOf, { lane = 0, loop = 0 } = {}) {
    this.data = classEdge
    this.id = classEdge.id
    this.boxOf = boxOf
    this.lane = lane
    this.loop = loop
    this.highlight = false
  }

  get style() { return CLASS_EDGE_STYLES[this.data.kind] || CLASS_EDGE_STYLES.uses }

  lineWidth() {
    const base = this.style.width
    if (this.data.kind !== 'uses') return base
    return base + Math.min(2, Math.log2(Math.max(1, this.data.weight || 1)) * 0.5)
  }

  /** Points of the edge in world space: {pts:[{x,y}...], self:boolean}, or null. */
  geometry() {
    const { from, to } = this.data
    const a = this.boxOf(from), b = this.boxOf(to)
    if (!a || !b) return null
    if (from === to) {
      const s = LOOP + this.loop * 10
      const p0 = { x: a.x + a.w - 18 - this.loop * 8, y: a.y }
      const p3 = { x: a.x + a.w, y: a.y + 18 + this.loop * 8 }
      return {
        self: true,
        pts: [p0, { x: p0.x, y: a.y - s }, { x: a.x + a.w + s, y: p3.y }, p3],
      }
    }
    const ca = boxCenter(a), cb = boxCenter(b)
    const perp = from < to ? perpendicular(ca.x, ca.y, cb.x, cb.y) : perpendicular(cb.x, cb.y, ca.x, ca.y)
    const ox = perp.x * this.lane * CLASS_LANE_GAP, oy = perp.y * this.lane * CLASS_LANE_GAP
    const pa = { x: ca.x + ox, y: ca.y + oy }, pb = { x: cb.x + ox, y: cb.y + oy }
    const start = liangBarskyClip(a, pb.x, pb.y, pa.x, pa.y)
    const end = liangBarskyClip(b, pa.x, pa.y, pb.x, pb.y)
    return { self: false, pts: [start, end] }
  }

  draw(ctx, view) {
    const geo = this.geometry()
    if (!geo) return
    const { pts, self } = geo
    const color = this.highlight ? HIGHLIGHT_COLOR : this.style.color
    const k = view.k || 1
    const kind = this.data.kind

    // direction at each end, for the heads
    const first = pts[0], second = pts[1]
    const last = pts[pts.length - 1], beforeLast = pts[pts.length - 2]
    const endDir = unit(beforeLast, last)
    const startDir = unit(second, first) // pointing out of the owner box, back towards `first`

    // shorten the line under solid heads so it doesn't poke through them
    const lineStart = kind === 'composes' ? along(first, startDir, -HEAD * 1.6) : first
    const lineEnd = kind === 'inherits' ? along(last, endDir, -HEAD) : last

    ctx.beginPath()
    ctx.moveTo(lineStart.x, lineStart.y)
    if (self) ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, lineEnd.x, lineEnd.y)
    else ctx.lineTo(lineEnd.x, lineEnd.y)
    ctx.lineWidth = (this.highlight ? this.lineWidth() + 1.5 : this.lineWidth()) / k
    ctx.strokeStyle = color
    if (this.style.dash) ctx.setLineDash?.(this.style.dash.map(v => v / k))
    ctx.stroke()
    if (this.style.dash) ctx.setLineDash?.([])

    ctx.lineWidth = 1.5 / k
    if (kind === 'inherits') {
      triangle(ctx, last, endDir, HEAD, HEAD)
      ctx.fillStyle = '#121212'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.stroke()
    } else if (kind === 'composes') {
      diamond(ctx, first, startDir, HEAD * 1.6, HEAD * 0.8)
      ctx.fillStyle = color
      ctx.fill()
      openArrow(ctx, last, endDir, HEAD * 0.7)
      ctx.strokeStyle = color
      ctx.stroke()
    } else if (kind === 'instantiates') {
      openArrow(ctx, last, endDir, HEAD * 0.9)
      ctx.strokeStyle = color
      ctx.stroke()
    } else {
      triangle(ctx, last, endDir, HEAD * 0.6, HEAD * 0.5)
      ctx.fillStyle = color
      ctx.fill()
    }
  }

  bounds() {
    const geo = this.geometry()
    if (!geo) return { ...EMPTY_RECT }
    const xs = geo.pts.map(p => p.x), ys = geo.pts.map(p => p.y)
    const m = HEAD * 1.6
    const minX = Math.min(...xs) - m, minY = Math.min(...ys) - m
    return { x: minX, y: minY, w: Math.max(...xs) + m - minX, h: Math.max(...ys) + m - minY }
  }
}

/**
 * Builds ClassEdge drawables. Edges between the same pair of classes (any kind, either
 * direction) get parallel lanes; self-edges get nested loops. Unresolvable ends are skipped.
 * @param {{id,from,to,kind,weight}[]} classEdges
 * @param {(id:string) => ({x,y,w,h}|undefined)} boxOf
 * @returns {ClassEdge[]}
 */
export function buildClassEdges(classEdges, boxOf) {
  if (!Array.isArray(classEdges)) return []
  const pairs = new Map()
  const live = classEdges.filter(e => e && boxOf(e.from) && boxOf(e.to))
  for (const e of live) {
    const key = e.from < e.to ? `${e.from}\n${e.to}` : `${e.to}\n${e.from}`
    if (!pairs.has(key)) pairs.set(key, [])
    pairs.get(key).push(e)
  }
  const out = []
  for (const group of pairs.values()) {
    group.forEach((e, i) => {
      if (e.from === e.to) out.push(new ClassEdge(e, boxOf, { loop: i }))
      else out.push(new ClassEdge(e, boxOf, { lane: i - (group.length - 1) / 2 }))
    })
  }
  return out
}

// ---------------------------------------------------------------- tiny vector helpers

function unit(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const m = Math.hypot(dx, dy) || 1
  return { x: dx / m, y: dy / m }
}

function along(p, d, t) { return { x: p.x + d.x * t, y: p.y + d.y * t } }

// Triangle with its tip at `tip`, pointing along `d`.
function triangle(ctx, tip, d, len, width) {
  const base = along(tip, d, -len)
  const nx = -d.y * width / 2, ny = d.x * width / 2
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(base.x + nx, base.y + ny)
  ctx.lineTo(base.x - nx, base.y - ny)
  ctx.closePath()
}

// Two strokes forming a `>` at `tip`.
function openArrow(ctx, tip, d, len) {
  const base = along(tip, d, -len)
  const nx = -d.y * len * 0.55, ny = d.x * len * 0.55
  ctx.beginPath()
  ctx.moveTo(base.x + nx, base.y + ny)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(base.x - nx, base.y - ny)
}

// Diamond with one point at `tip` (on the owner box border), extending back along -d.
function diamond(ctx, tip, d, len, width) {
  const mid = along(tip, d, -len / 2), far = along(tip, d, -len)
  const nx = -d.y * width / 2, ny = d.x * width / 2
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(mid.x + nx, mid.y + ny)
  ctx.lineTo(far.x, far.y)
  ctx.lineTo(mid.x - nx, mid.y - ny)
  ctx.closePath()
}
