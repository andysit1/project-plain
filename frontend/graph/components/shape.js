// L3 data layer: Shape helpers plus DataBox, the node Drawable for one frame / class / heap box.
// Browser ES module: no Node APIs, no imports. Boxes are measured once at build time from
// estimated text widths, and every label is drawn with fitText so nothing spills out of a box.

export const TITLE_H = 24, ROW_H = 22, SECTION_H = 16, CHIP_H = 20, PAD = 8
export const CELL_W = 30, CELL_H = 26, ELEM_H = 18, DOT_R = 4
const MIN_W = 110, TAG_W = 26, DOT_W = 18

const FONT = '12px Calibri, "Segoe UI Symbol", sans-serif'
const BOLD = 'bold 12px Calibri, "Segoe UI Symbol", sans-serif'
const SMALL = '10px Calibri, "Segoe UI Symbol", sans-serif'
const BIG = 'bold 16px Calibri, "Segoe UI Symbol", sans-serif'

// Dark palette in the spirit of node.js: dark fills, light text, one hue per glyph family.
export const PALETTE = Object.freeze({
  text: '#F2F2F2', dim: '#BFBFBF', type: '#9CC3E6', tag: '#8A8A8A', section: '#8FA3B5',
  border: '#333333', select: '#FFD75E', dot: '#E6EEF5', none: '#E08A8A', unknown: '#9A9A9A',
  pointer: '#B8C4D0', cursor: '#FFB35E', traversal: '#6BA8FF', highlight: '#E8C14A',
  chip: '#3A3226', chipText: '#FFCF8A',
})
const GLYPH = Object.freeze({
  frame:    { fill: '#1E2730', title: '#2E4A5D', cell: '#26323D', line: '#3E5566' },
  class:    { fill: '#241E2C', title: '#4A2E5D', cell: '#2E2638', line: '#5B4570' },
  obj:      { fill: '#241E2C', title: '#4A2E5D', cell: '#2E2638', line: '#5B4570' },
  list:     { fill: '#1C2621', title: '#2E5D45', cell: '#27392F', line: '#5E8C73' },
  tuple:    { fill: '#1C2621', title: '#2E5D45', cell: '#27392F', line: '#8FC3A6' },
  set:      { fill: '#1B2626', title: '#2E5D5A', cell: '#263A39', line: '#5E8C89' },
  dict:     { fill: '#29231B', title: '#5D4A2E', cell: '#352D22', line: '#8C7556' },
  record:   { fill: '#29231B', title: '#5D4A2E', cell: '#352D22', line: '#8C7556' },
  union:    { fill: '#252525', title: '#4A4A4A', cell: '#303030', line: '#666666' },
  unknown:  { fill: '#3A3A3A', title: '#3A3A3A', cell: '#444444', line: '#666666' },
  ellipsis: { fill: '#1E1E1E', title: '#1E1E1E', cell: '#1E1E1E', line: '#777777' },
})
const ROW_GLYPHS = new Set(['frame', 'class', 'obj', 'union'])
const TABLE_GLYPHS = new Set(['dict', 'record'])
export const SEQ_GLYPHS = new Set(['list', 'tuple', 'set'])
const SRC_TAG = { annotation: 'ann', literal: 'lit', ctor: 'new', mutation: 'mut', return: 'ret', runtime: 'run', unknown: '' }

/** Rough text width for layout (the canvas is not available at build time). */
export function textW(s, px = 12) { return Math.ceil(String(s).length * px * 0.56) }

// ---------------------------------------------------------------- shape helpers

const REF_KINDS = new Set(['list', 'set', 'tuple', 'dict', 'record', 'obj'])
export const isNone = s => !!s && s.k === 'prim' && s.t === 'none'

/** Splits Optional[X]: { core: X, optional: true }. Unions of several non-none shapes stay unions. */
export function unwrap(s) {
  if (!s || typeof s !== 'object') return { core: { k: 'unknown' }, optional: false }
  if (s.k !== 'union') return { core: s, optional: false }
  const of = Array.isArray(s.of) ? s.of : []
  const rest = of.filter(x => !isNone(x))
  const optional = rest.length < of.length
  if (rest.length === 0) return { core: { k: 'prim', t: 'none' }, optional: false }
  if (rest.length === 1) return { core: rest[0], optional }
  return { core: { k: 'union', of: rest }, optional }
}

/** True when the shape draws as a pointer to a heap box rather than inline. */
export function isRef(s, depth = 0) {
  const { core } = unwrap(s)
  if (REF_KINDS.has(core.k)) return true
  if (core.k === 'union' && depth < 4) return core.of.some(x => isRef(x, depth + 1))
  return false
}

/** Short class name from a CodeClass id ("app/x.py::Outer.Inner" -> "Inner"). */
export function shortCls(id, classes) {
  const c = classes && classes.get(id)
  if (c && c.name) return c.name
  const q = String(id).split('::').pop()
  return q.split('.').pop()
}

/** Compact type text: "int", "list[str]", "dict[str, Point]", "ListNode?", "int | str". */
export function shapeLabel(s, classes, depth = 0) {
  if (depth > 3) return '…'
  const { core, optional } = unwrap(s)
  const q = optional ? '?' : ''
  const sub = x => shapeLabel(x, classes, depth + 1)
  switch (core.k) {
    case 'prim': return core.t === 'none' ? 'None' : core.t + q
    case 'list': case 'set': case 'tuple': return `${core.k}[${sub(core.of)}]${q}`
    case 'dict': return `dict[${sub(core.key)}, ${sub(core.val)}]${q}`
    case 'record': return `{${Object.keys(core.fields || {}).join(', ')}}${q}`
    case 'obj': return shortCls(core.cls, classes) + q
    case 'union': return core.of.map(sub).join(' | ') + (optional ? ' | None' : '')
    default: return '?'
  }
}

/** True when `s` holds an instance of class `cls` directly or as a container element. */
export function refersTo(s, cls, depth = 0) {
  if (!s || depth > 4) return false
  switch (s.k) {
    case 'obj': return s.cls === cls
    case 'union': return (s.of || []).some(x => refersTo(x, cls, depth + 1))
    case 'list': case 'set': case 'tuple': return refersTo(s.of, cls, depth + 1)
    case 'dict': return refersTo(s.key, cls, depth + 1) || refersTo(s.val, cls, depth + 1)
    case 'record': return Object.values(s.fields || {}).some(x => refersTo(x, cls, depth + 1))
    default: return false
  }
}

// ---------------------------------------------------------------- measuring

// Fills in w, h and per-entry y / per-cell x offsets (relative to the box's top-left).
function measure(d) {
  const titleW = textW(d.title || '', 12) + (d.optional ? 22 : 0) + (d.src ? TAG_W + 8 : 0) + PAD * 2
  if (d.glyph === 'ellipsis') { d.w = 34; d.h = 26; return }
  if (d.glyph === 'unknown') { d.w = 40; d.h = 30; return }

  if (ROW_GLYPHS.has(d.glyph)) {
    let y = TITLE_H + PAD / 2, w = Math.max(MIN_W, titleW)
    for (const e of d.entries) {
      e.y = y
      if (e.section) { y += SECTION_H; continue }
      y += ROW_H
      const typeW = e.type ? textW(' : ' + e.type) : 0
      w = Math.max(w, PAD + textW(e.label) + typeW + 8 + TAG_W + DOT_W + PAD)
    }
    for (const c of d.chips || []) w = Math.max(w, textW(c) + PAD * 4)
    if ((d.chips || []).length) y += 4 + d.chips.length * CHIP_H
    d.w = w; d.h = y + PAD / 2
    return
  }

  if (TABLE_GLYPHS.has(d.glyph)) {
    let lw = 36, rw = 36
    for (const e of d.entries) {
      if (e.more) continue
      lw = Math.max(lw, textW(e.left) + 12)
      rw = Math.max(rw, e.ref ? DOT_W + 12 : textW(e.right) + 12)
    }
    d.colL = lw; d.colR = rw
    const arrowW = 16
    d.w = Math.max(MIN_W, titleW, PAD * 2 + lw + arrowW + rw)
    // stretch the value column so the table fills the box
    d.colR = d.w - PAD * 2 - lw - arrowW
    let y = TITLE_H + PAD / 2
    for (const e of d.entries) { e.y = y; y += e.more ? 14 : ROW_H }
    d.h = y + PAD / 2
    return
  }

  if (SEQ_GLYPHS.has(d.glyph)) {
    const n = d.cells.length
    d.w = Math.max(MIN_W, titleW, PAD * 2 + n * CELL_W, textW(d.elem || '') + PAD * 2)
    const x0 = PAD
    d.cells.forEach((c, i) => { c.x = x0 + i * CELL_W })
    d.cellY = TITLE_H + 4
    d.h = d.cellY + CELL_H + ELEM_H
    return
  }
  d.w = Math.max(MIN_W, titleW); d.h = TITLE_H + PAD
}

// ---------------------------------------------------------------- drawable

/**
 * One box of the L3 view. data: { id, kind: 'data', glyph, title, x, y, w, h, src?, optional?,
 * entries? (row / table glyphs), cells? + elem? (list/tuple/set), chips? (frame), reserveBelow }.
 * Satisfies what graph.js needs from a node: id, data, selected, hitTest, bounds, moveTo, draw.
 * bounds() is exactly the box (no margin), so graph.js drag math (bounds().x -> moveTo) is exact.
 */
export class DataBox {
  constructor(data) {
    this.data = { kind: 'data', x: 0, y: 0, entries: [], cells: [], chips: [], reserveBelow: 0, ...data }
    this.data.name = this.data.name || this.data.title || ''
    this.id = this.data.id
    this.selected = false
    measure(this.data)
  }

  get glyph() { return this.data.glyph }

  bounds() {
    const { x, y, w, h } = this.data
    return { x, y, w, h }
  }

  hitTest(px, py) {
    const { x, y, w, h } = this.data
    return px >= x && px < x + w && py >= y && py < y + h
  }

  moveTo(x, y) { this.data.x = x; this.data.y = y }

  /** Re-measures after entries / chips change (used by the builder before layout). */
  remeasure() { measure(this.data) }

  /** World position of a pointer's start. key = entry key ("v:head", "f:next") or cell key ("c0").
   * dir tells the edge which way to leave: 'right' for rows, 'down' for cells. */
  port(key) {
    const d = this.data
    if (SEQ_GLYPHS.has(d.glyph)) {
      const c = d.cells.find(c => c.key === key)
      if (c) return { x: d.x + c.x + CELL_W / 2, y: d.y + d.cellY + CELL_H / 2, dir: 'down' }
    } else if (TABLE_GLYPHS.has(d.glyph)) {
      const e = d.entries.find(e => e.key === key)
      if (e) return { x: d.x + d.w - PAD - d.colR / 2, y: d.y + e.y + ROW_H / 2, dir: 'right' }
    } else {
      const e = d.entries.find(e => e.key === key)
      if (e) return { x: d.x + d.w - PAD - DOT_R - 2, y: d.y + e.y + ROW_H / 2, dir: 'right' }
    }
    return null
  }

  /** Where loop cursor number `i` points: under cell i (or the first table row), at the box bottom. */
  cursorAnchor(i = 0) {
    const d = this.data
    if (SEQ_GLYPHS.has(d.glyph) && d.cells.length) {
      const real = d.cells.filter(c => !c.more)
      const c = real[Math.min(i, real.length - 1)] || d.cells[0]
      return { x: d.x + c.x + CELL_W / 2, y: d.y + d.h }
    }
    return { x: d.x + PAD + 14 + i * 24, y: d.y + d.h }
  }

  /** Tooltip text for a world point inside the box (row name, type and where the shape came from). */
  tooltipAt(px, py) {
    if (!this.hitTest(px, py)) return null
    const d = this.data
    const ry = py - d.y
    const e = (d.entries || []).find(e => !e.section && !e.more && ry >= e.y && ry < e.y + ROW_H)
    const src = (e && e.src) || d.src
    const what = e ? `${e.label || e.left}${e.type || e.right ? ' : ' + (e.type || e.right) : ''}` : d.title
    return src ? `${what}  (${src})` : what
  }

  draw(ctx, view) {
    const d = this.data
    const pal = GLYPH[d.glyph] || GLYPH.union
    const { x, y, w, h } = d
    ctx.save()
    // runtime shapes are solid; statically inferred ones draw slightly lighter
    const inferred = d.src !== 'runtime'
    // graph.js may already have set globalAlpha (dimming); scale it rather than overwrite it
    const base = ctx.globalAlpha

    if (d.glyph === 'ellipsis') {
      roundRect(ctx, x, y, w, h, 6)
      ctx.setLineDash([3, 3]); ctx.strokeStyle = pal.line; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([])
      if (view.showLabels) text(ctx, '…', x + w / 2, y + h / 2 - 2, BIG, PALETTE.dim, 'center')
      this._selection(ctx)
      ctx.restore()
      return
    }

    roundRect(ctx, x, y, w, h, 7)
    ctx.globalAlpha = base * (inferred ? 0.94 : 1)
    ctx.fillStyle = pal.fill; ctx.fill()
    ctx.globalAlpha = base
    if (d.glyph !== 'unknown') {
      // title band
      ctx.save(); roundRect(ctx, x, y, w, h, 7); ctx.clip()
      ctx.globalAlpha = base * (inferred ? 0.9 : 1)
      ctx.fillStyle = pal.title; ctx.fillRect(x, y, w, TITLE_H)
      ctx.restore()
    }
    roundRect(ctx, x, y, w, h, 7)
    if (d.optional) ctx.setLineDash([6, 4])
    ctx.lineWidth = d.optional ? 1.6 : 1.5
    ctx.strokeStyle = d.optional ? PALETTE.dim : PALETTE.border
    ctx.stroke(); ctx.setLineDash([])

    if (view.showLabels) {
      if (d.glyph === 'unknown') {
        text(ctx, '?', x + w / 2, y + h / 2, BIG, PALETTE.unknown, 'center')
      } else {
        this._title(ctx, d)
        if (ROW_GLYPHS.has(d.glyph)) this._rows(ctx, d, pal)
        else if (TABLE_GLYPHS.has(d.glyph)) this._table(ctx, d, pal)
        else if (SEQ_GLYPHS.has(d.glyph)) this._cells(ctx, d, pal)
      }
    }
    this._selection(ctx)
    ctx.restore()
  }

  _selection(ctx) {
    if (!this.selected) return
    const { x, y, w, h } = this.data
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 10)
    ctx.setLineDash([]); ctx.lineWidth = 2; ctx.strokeStyle = PALETTE.select; ctx.stroke()
  }

  _title(ctx, d) {
    const { x, y, w } = d
    let right = x + w - PAD
    if (d.optional) {
      text(ctx, '⊘', right, y + TITLE_H / 2, BOLD, PALETTE.none, 'right')
      right -= 18
    }
    if (d.src && SRC_TAG[d.src] !== '') {
      text(ctx, SRC_TAG[d.src] || d.src, right, y + TITLE_H / 2, SMALL, PALETTE.dim, 'right')
      right -= TAG_W
    }
    const t = fitText(ctx, String(d.title || ''), right - x - PAD, BOLD)
    text(ctx, t, x + PAD, y + TITLE_H / 2, BOLD, PALETTE.text, 'left')
  }

  _rows(ctx, d, pal) {
    const { x, y, w } = d
    const dotX = x + w - PAD - DOT_R - 2
    for (const e of d.entries) {
      const ry = y + e.y
      if (e.section) {
        text(ctx, e.section, x + PAD, ry + SECTION_H / 2 + 1, SMALL, PALETTE.section, 'left')
        ctx.strokeStyle = pal.line; ctx.lineWidth = 0.6
        ctx.beginPath(); ctx.moveTo(x + PAD + textW(e.section, 10) + 6, ry + SECTION_H / 2 + 1); ctx.lineTo(x + w - PAD, ry + SECTION_H / 2 + 1); ctx.stroke()
        continue
      }
      const cy = ry + ROW_H / 2
      const tagX = e.ref ? dotX - DOT_R - 6 : x + w - PAD
      if (e.src && SRC_TAG[e.src] !== '') text(ctx, SRC_TAG[e.src] || e.src, tagX, cy, SMALL, PALETTE.tag, 'right')
      const avail = tagX - TAG_W - x - PAD
      ctx.font = FONT
      const label = fitText(ctx, String(e.label), avail, FONT)
      text(ctx, label, x + PAD, cy, FONT, PALETTE.text, 'left')
      const lw = ctx.measureText(label).width
      if (e.inline === '?') {
        const bx = x + PAD + lw + 18
        text(ctx, ':', x + PAD + lw + 4, cy, FONT, PALETTE.dim, 'left')
        ctx.fillStyle = GLYPH.unknown.cell; ctx.fillRect(bx, cy - 8, 16, 16)
        text(ctx, '?', bx + 8, cy, BOLD, PALETTE.unknown, 'center')
      } else if (e.type) {
        const t = fitText(ctx, ' : ' + e.type, avail - lw, FONT)
        text(ctx, t, x + PAD + lw, cy, FONT, e.inline === 'none' ? PALETTE.none : PALETTE.type, 'left')
      }
      if (e.ref) dot(ctx, dotX, cy)
    }
    if ((d.chips || []).length) {
      let cy = y + d.h - PAD / 2 - d.chips.length * CHIP_H
      for (const c of d.chips) {
        roundRect(ctx, x + PAD, cy + 2, w - PAD * 2, CHIP_H - 4, 7)
        ctx.fillStyle = PALETTE.chip; ctx.fill()
        const t = fitText(ctx, c, w - PAD * 4, SMALL)
        text(ctx, t, x + PAD * 2, cy + CHIP_H / 2, SMALL, PALETTE.chipText, 'left')
        cy += CHIP_H
      }
    }
  }

  _table(ctx, d, pal) {
    const { x, y } = d
    const lx = x + PAD, rx = lx + d.colL + 16
    for (const e of d.entries) {
      const ry = y + e.y
      if (e.more) { text(ctx, '⋮', lx + d.colL / 2, ry + 6, SMALL, PALETTE.dim, 'center'); continue }
      ctx.fillStyle = pal.cell
      ctx.fillRect(lx, ry + 2, d.colL, ROW_H - 4)
      ctx.fillRect(rx, ry + 2, d.colR, ROW_H - 4)
      const cy = ry + ROW_H / 2
      text(ctx, fitText(ctx, String(e.left), d.colL - 8, FONT), lx + 5, cy, FONT, e.keyIsName ? PALETTE.text : PALETTE.type, 'left')
      text(ctx, '→', lx + d.colL + 8, cy, SMALL, PALETTE.dim, 'center')
      if (e.ref) dot(ctx, rx + d.colR / 2, cy)
      else text(ctx, fitText(ctx, String(e.right), d.colR - 8, FONT), rx + 5, cy, FONT, e.inline === '?' ? PALETTE.unknown : PALETTE.type, 'left')
    }
  }

  _cells(ctx, d, pal) {
    const { x, y } = d
    const cy = y + d.cellY
    const round = d.glyph === 'set'
    d.cells.forEach((c, i) => {
      const cx = x + c.x
      if (c.more) {
        text(ctx, '…', cx + CELL_W / 2, cy + CELL_H / 2 - 2, BIG, PALETTE.dim, 'center')
        return
      }
      if (round) {
        roundRect(ctx, cx + 2, cy + 1, CELL_W - 4, CELL_H - 2, 9)
        ctx.fillStyle = pal.cell; ctx.fill(); ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.stroke()
      } else {
        ctx.fillStyle = pal.cell; ctx.fillRect(cx, cy, CELL_W, CELL_H)
        ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, CELL_W, CELL_H)
      }
      if (!round) text(ctx, String(i), cx + 3, cy + 6, '8px Calibri, sans-serif', PALETTE.tag, 'left')
      if (c.ref) dot(ctx, cx + CELL_W / 2, cy + CELL_H / 2)
      else if (c.text) text(ctx, fitText(ctx, c.text, CELL_W - 4, SMALL), cx + CELL_W / 2, cy + CELL_H / 2 + 2, SMALL, PALETTE.dim, 'center')
    })
    if (d.glyph === 'tuple') {
      // thick dividers mark a tuple's fixed slots
      ctx.strokeStyle = pal.line; ctx.lineWidth = 3
      const real = d.cells.filter(c => !c.more)
      ctx.beginPath()
      for (let i = 0; i <= real.length; i++) {
        const lx = x + PAD + i * CELL_W
        ctx.moveTo(lx, cy); ctx.lineTo(lx, cy + CELL_H)
      }
      ctx.stroke()
    }
    if (d.elem) text(ctx, fitText(ctx, d.elem, d.w - PAD * 2, SMALL), x + PAD, cy + CELL_H + ELEM_H / 2, SMALL, PALETTE.type, 'left')
  }
}

// ---------------------------------------------------------------- canvas helpers

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

export function text(ctx, s, x, y, font, color, align = 'left') {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}

function dot(ctx, x, y) {
  ctx.beginPath(); ctx.arc(x, y, DOT_R, 0, Math.PI * 2)
  ctx.fillStyle = PALETTE.dot; ctx.fill()
}

/** Shortens `s` with an ellipsis so it fits maxWidth (binary search on measureText). */
export function fitText(ctx, s, maxWidth, font) {
  if (font) ctx.font = font
  if (maxWidth <= 0) return ''
  if (ctx.measureText(s).width <= maxWidth) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? '' : s.slice(0, lo) + '…'
}
