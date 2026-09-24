// L3 data layer edges: pointers (row/cell dot -> heap box), loop cursors under a container's
// cells, and the traversal arrow along a linked-list chain. Browser ES module, no imports
// beyond shape.js. Endpoints are resolved through boxOf(id) at draw/bounds time (never cached),
// so dragging a box keeps its arrows attached.

import { PALETTE, TITLE_H, fitText, roundRect, text } from './shape.js'

const EMPTY = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })
const ARROW_L = 9, ARROW_W = 6
const LABEL_FONT = '11px Calibri, "Segoe UI Symbol", sans-serif'

function arrowHead(ctx, from, to, color) {
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const bx = to.x - ux * ARROW_L, by = to.y - uy * ARROW_L
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(bx - uy * ARROW_W / 2, by + ux * ARROW_W / 2)
  ctx.lineTo(bx + uy * ARROW_W / 2, by - ux * ARROW_W / 2)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function bbox(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
}

// A label pill (dark background) so labels stay readable over lines.
function pill(ctx, s, x, y, color) {
  ctx.font = LABEL_FONT
  const t = fitText(ctx, s, 180)
  const w = ctx.measureText(t).width + 10
  roundRect(ctx, x, y - 8, w, 16, 6)
  ctx.fillStyle = 'rgba(18, 18, 18, 0.92)'
  ctx.fill()
  ctx.strokeStyle = color; ctx.lineWidth = 0.8; ctx.stroke()
  text(ctx, t, x + 5, y, LABEL_FONT, color, 'left')
}

// Straight connector between two boxes, leaving/entering on the sides that face each other
// (graph rings: neighbours are laid out in a 2x2 block, so this never cuts through a box).
function boxToBox(s, t) {
  const ca = { x: s.x + s.w / 2, y: s.y + s.h / 2 }, cb = { x: t.x + t.w / 2, y: t.y + t.h / 2 }
  const dx = cb.x - ca.x, dy = cb.y - ca.y
  let p0, p3
  if (Math.abs(dx) >= Math.abs(dy) * 1.5) {
    const sx = Math.sign(dx) || 1
    p0 = { x: sx > 0 ? s.x + s.w : s.x, y: ca.y + (dy ? Math.sign(dy) * s.h / 4 : 0) }
    p3 = { x: sx > 0 ? t.x : t.x + t.w, y: cb.y - (dy ? Math.sign(dy) * t.h / 4 : 0) }
  } else if (Math.abs(dy) >= Math.abs(dx) * 1.5) {
    const sy = Math.sign(dy) || 1
    p0 = { x: ca.x + (dx ? Math.sign(dx) * s.w / 4 : 0), y: sy > 0 ? s.y + s.h : s.y }
    p3 = { x: cb.x - (dx ? Math.sign(dx) * t.w / 4 : 0), y: sy > 0 ? t.y : t.y + t.h }
  } else {
    // diagonal: corner to corner
    p0 = { x: dx > 0 ? s.x + s.w * 0.85 : s.x + s.w * 0.15, y: dy > 0 ? s.y + s.h : s.y }
    p3 = { x: dx > 0 ? t.x + t.w * 0.15 : t.x + t.w * 0.85, y: dy > 0 ? t.y : t.y + t.h }
  }
  const c1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 }
  const c2 = { x: p0.x + (p3.x - p0.x) * 2 / 3, y: p0.y + (p3.y - p0.y) * 2 / 3 }
  return { p0, c1, c2, p3 }
}

/**
 * A pointer. data: { id, kind: 'pointer'|'alias'|'back'|'link'|'cross', from, to, port, dashed, lane? }.
 * from/to are DataBox ids (graph.js highlights edges whose from/to is the selected id).
 */
export class PointerEdge {
  constructor(data, boxOf) {
    this.data = data
    this.id = data.id
    this.boxOf = boxOf
    this.highlight = false
  }

  _geom() {
    const a = this.boxOf(this.data.from), b = this.boxOf(this.data.to)
    if (!a || !b) return null
    const s = a.data, t = b.data
    const p0 = (this.data.port && a.port(this.data.port)) || { x: s.x + s.w, y: s.y + TITLE_H / 2, dir: 'right' }
    if (this.data.kind === 'link' || this.data.kind === 'cross') return boxToBox(s, t)
    if (this.data.kind === 'back') {
      // back pointers (doubly linked prev) loop underneath both boxes, one lane per level
      const low = Math.max(s.y + s.h, t.y + t.h) + 10 + (this.data.lane || 0) * 7
      const p3 = { x: t.x + t.w * 0.65, y: t.y + t.h }
      return { p0, c1: { x: p0.x + 26, y: low + 6 }, c2: { x: p3.x, y: low + 6 }, p3 }
    }
    let p3, c2
    if (t.x >= p0.x + 12) {
      p3 = { x: t.x, y: t.y + Math.min(TITLE_H / 2, t.h / 2) }
      const dx = Math.max(24, (p3.x - p0.x) / 2)
      c2 = { x: p3.x - dx, y: p3.y }
    } else if (t.y >= p0.y) {
      p3 = { x: t.x + t.w / 2, y: t.y }
      c2 = { x: p3.x, y: p3.y - 40 }
    } else if (t.y + t.h <= p0.y) {
      p3 = { x: t.x + t.w / 2, y: t.y + t.h }
      c2 = { x: p3.x, y: p3.y + 40 }
    } else {
      p3 = { x: t.x + t.w, y: t.y + t.h / 2 }
      c2 = { x: p3.x + 40, y: p3.y }
    }
    const reach = Math.max(30, Math.min(80, Math.abs(p3.x - p0.x) / 2))
    const c1 = p0.dir === 'down' ? { x: p0.x, y: p0.y + Math.max(36, reach) } : { x: p0.x + reach, y: p0.y }
    return { p0, c1, c2, p3 }
  }

  bounds() {
    const g = this._geom()
    return g ? bbox([g.p0, g.c1, g.c2, g.p3], 8) : EMPTY
  }

  draw(ctx, view) {
    const g = this._geom()
    if (!g) return
    const k = this.data.kind
    const color = this.highlight ? PALETTE.highlight : (k === 'back' ? '#9FB0C2' : PALETTE.pointer)
    ctx.save()
    ctx.lineWidth = this.highlight ? 2.5 : 1.5
    ctx.strokeStyle = color
    if (this.data.dashed) ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(g.p0.x, g.p0.y)
    ctx.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.p3.x, g.p3.y)
    ctx.stroke()
    ctx.setLineDash([])
    arrowHead(ctx, g.c2, g.p3, color)
    if (this.data.label && view.showLabels) pill(ctx, this.data.label, (g.p0.x + g.p3.x) / 2 - 10, (g.c1.y + g.c2.y) / 2, color)
    ctx.restore()
  }
}

/**
 * A loop cursor: an up-arrow under cell `cell` of box `to`, labelled "row ↻ L30".
 * slot stacks several cursors on one box. dashed = inferred index cursor (for i in range(n)).
 * data: { id, kind: 'cursor', from: frameId, to, cell, slot, label, dashed }
 */
export class CursorEdge {
  constructor(data, boxOf) {
    this.data = data
    this.id = data.id
    this.boxOf = boxOf
    this.highlight = false
  }

  _geom() {
    const b = this.boxOf(this.data.to)
    if (!b) return null
    const a = b.cursorAnchor(this.data.cell || 0)
    const slot = this.data.slot || 0
    return { x: a.x, top: a.y + 2, bottom: a.y + 16 + slot * 16 }
  }

  bounds() {
    const g = this._geom()
    return g ? { x: g.x - 10, y: g.top - 2, w: 200, h: g.bottom - g.top + 14 } : EMPTY
  }

  draw(ctx, view) {
    const g = this._geom()
    if (!g) return
    const color = this.highlight ? PALETTE.highlight : PALETTE.cursor
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    if (this.data.dashed) ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(g.x, g.bottom); ctx.lineTo(g.x, g.top + ARROW_L); ctx.stroke()
    ctx.setLineDash([])
    arrowHead(ctx, { x: g.x, y: g.bottom }, { x: g.x, y: g.top }, color)
    if (view.showLabels) pill(ctx, this.data.label, g.x + 4, g.bottom, color)
    ctx.restore()
  }
}

/**
 * A traversal arrow running under a chain of boxes (while node: node = node.next).
 * data: { id, kind: 'traversal', from: frameId, to: chain[0], chain: boxId[], label }
 */
export class TraversalEdge {
  constructor(data, boxOf) {
    this.data = data
    this.id = data.id
    this.boxOf = boxOf
    this.highlight = false
  }

  _geom() {
    const boxes = (this.data.chain || []).map(id => this.boxOf(id)).filter(Boolean).map(b => b.data)
    if (boxes.length < 2) return null
    const first = boxes[0], last = boxes[boxes.length - 1]
    const low = Math.max(...boxes.map(b => b.y + b.h)) + 18
    return {
      a: { x: first.x + first.w * 0.35, y: first.y + first.h + 2 },
      b: { x: last.x + last.w * 0.35, y: last.y + last.h + 2 },
      low,
    }
  }

  bounds() {
    const g = this._geom()
    return g ? bbox([g.a, g.b, { x: g.a.x, y: g.low + 10 }], 12) : EMPTY
  }

  draw(ctx, view) {
    const g = this._geom()
    if (!g) return
    const color = this.highlight ? PALETTE.highlight : PALETTE.traversal
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(g.a.x, g.a.y)
    ctx.lineTo(g.a.x, g.low - 6)
    ctx.quadraticCurveTo(g.a.x, g.low, g.a.x + 6, g.low)
    ctx.lineTo(g.b.x - 6, g.low)
    ctx.quadraticCurveTo(g.b.x, g.low, g.b.x, g.low - 6)
    ctx.lineTo(g.b.x, g.b.y + ARROW_L)
    ctx.stroke()
    arrowHead(ctx, { x: g.b.x, y: g.low }, g.b, color)
    if (view.showLabels) pill(ctx, this.data.label, g.a.x + 14, g.low, color)
    ctx.restore()
  }
}
