// ClassNode: a Drawable for one L1 class box (a SceneNode from classes.js, mode 'classes').
// Title bar, up to MAX_ROWS field rows `name: type` (the last one `+N more` when they don't fit)
// and a footer with the method count. Module pseudo-classes get their own fill and show their
// function count. Below LABEL_MIN_ZOOM the box collapses to a large title only.
// Same interface as CodeNode (id, data, selected, hitTest, moveTo, draw, bounds), which it extends.

import { NODE_H } from '../../../shared/contracts.js'
import { CodeNode, NODE_PADDING } from './node.js'
import { shapeLabel } from './shape.js'

export const TITLE_H = 26
export const ROW_H = 16
export const ROW_PAD = 5
export const FOOTER_H = 22
export const MAX_ROWS = 6

const CORNER = 8
const TITLE_FONT = 'bold 13px Calibri'
const ROW_FONT = '12px Consolas, monospace'
const FOOTER_FONT = '11px Calibri'
const TITLE_COLOR = '#F2F2F2'
const NAME_COLOR = '#E4E4E4'
const TYPE_COLOR = '#9FB2C8'
const DIM_TEXT = '#A9B0BA'
const BORDER_COLOR = '#333333'
const RULE_COLOR = 'rgba(255, 255, 255, 0.12)'

const FILLS = Object.freeze({
  class: { body: '#27394C', title: '#2F4A66' },
  module: { body: '#43392A', title: '#5D4A2E' },
})

const STRUCTURE_TAGS = Object.freeze({
  'linked-list': 'list', 'doubly-linked-list': 'dlist', tree: 'tree', graph: 'graph',
})

/** Rows a class box shows for `fieldCount` fields (the last one may be `+N more`). */
export function fieldRows(fieldCount) {
  return Math.min(fieldCount, MAX_ROWS)
}

/** Box height of a CodeClass: title + field rows + footer, never below NODE_H. */
export function classBoxHeight(cls) {
  const rows = cls && cls.kind !== 'module' ? fieldRows((cls.fields || []).length) : 0
  const body = rows ? rows * ROW_H + ROW_PAD * 2 : 0
  return Math.max(NODE_H, TITLE_H + body + FOOTER_H)
}

export class ClassNode extends CodeNode {
  /** @param {object} sceneNode a SceneNode from buildClassScene (carries classKind/fields/methods) */
  constructor(sceneNode, opts) {
    super({ ...sceneNode, changed: false }, opts)
    this.data = sceneNode
  }

  draw(ctx, view) {
    const { x, y, w, h } = this.data
    const fill = FILLS[this.data.classKind] || FILLS.class

    this._roundedRectPath(ctx, x, y, w, h, CORNER)
    ctx.fillStyle = fill.body
    ctx.fill()

    // title bar: the top TITLE_H of the box, square bottom corners
    const th = view.showLabels ? TITLE_H : h
    ctx.beginPath()
    ctx.moveTo(x, y + th)
    ctx.lineTo(x, y + CORNER)
    ctx.quadraticCurveTo(x, y, x + CORNER, y)
    ctx.lineTo(x + w - CORNER, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + CORNER)
    ctx.lineTo(x + w, y + th)
    ctx.closePath()
    ctx.fillStyle = fill.title
    ctx.fill()

    this._roundedRectPath(ctx, x, y, w, h, CORNER)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = BORDER_COLOR
    ctx.stroke()

    if (view.showLabels) this._drawLabels(ctx, x, y, w, h)
    else this._drawCollapsed(ctx, x, y, w, h, view)

    if (this.selected) this._drawSelection(ctx, x, y, w, h)
  }

  _drawLabels(ctx, x, y, w, h) {
    const d = this.data
    const maxWidth = w - NODE_PADDING * 2
    const tag = STRUCTURE_TAGS[d.structure]

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    let titleRoom = maxWidth
    if (tag) {
      ctx.font = FOOTER_FONT
      const tw = ctx.measureText(tag).width
      ctx.fillStyle = DIM_TEXT
      ctx.textAlign = 'right'
      ctx.fillText(tag, x + w - NODE_PADDING, y + TITLE_H / 2)
      titleRoom -= tw + 8
    }
    ctx.textAlign = 'left'
    ctx.font = TITLE_FONT
    ctx.fillStyle = TITLE_COLOR
    ctx.fillText(this._fitText(ctx, String(d.name), titleRoom), x + NODE_PADDING, y + TITLE_H / 2)

    const fields = d.classKind === 'module' ? [] : (d.fields || [])
    const rows = fieldRows(fields.length)
    ctx.font = ROW_FONT
    for (let i = 0; i < rows; i++) {
      const ry = y + TITLE_H + ROW_PAD + i * ROW_H + ROW_H / 2
      if (i === rows - 1 && fields.length > rows) {
        ctx.fillStyle = DIM_TEXT
        ctx.fillText(`+${fields.length - rows + 1} more`, x + NODE_PADDING, ry)
        break
      }
      const f = fields[i]
      const name = String(f.name)
      ctx.fillStyle = NAME_COLOR
      const fitName = this._fitText(ctx, name, maxWidth)
      ctx.fillText(fitName, x + NODE_PADDING, ry)
      // written type first; otherwise the inferred shape, dimmer so it reads as a guess
      const inferred = !f.type && f.shape && f.shape.k !== 'unknown'
      const type = f.type || (inferred ? shapeLabel(f.shape) : '')
      if (type && fitName === name) {
        const nw = ctx.measureText(name).width
        ctx.fillStyle = inferred ? DIM_TEXT : TYPE_COLOR
        ctx.fillText(this._fitText(ctx, `: ${type}`, maxWidth - nw), x + NODE_PADDING + nw, ry)
      }
    }

    // footer: a rule, then the method (or function) count
    const fy = y + h - FOOTER_H
    ctx.beginPath()
    ctx.moveTo(x + 1, fy)
    ctx.lineTo(x + w - 1, fy)
    ctx.lineWidth = 1
    ctx.strokeStyle = RULE_COLOR
    ctx.stroke()
    const n = (d.methods || []).length
    const noun = d.classKind === 'module' ? 'function' : 'method'
    ctx.font = FOOTER_FONT
    ctx.fillStyle = DIM_TEXT
    ctx.fillText(`${n} ${noun}${n === 1 ? '' : 's'}`, x + NODE_PADDING, fy + FOOTER_H / 2)
  }

  // Zoomed out: only the name, sized so it stays readable on screen.
  _drawCollapsed(ctx, x, y, w, h, view) {
    const size = Math.max(10, Math.min(14 / (view.k || 1), h * 0.45))
    ctx.font = `bold ${Math.round(size)}px Calibri`
    ctx.fillStyle = TITLE_COLOR
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this._fitText(ctx, String(this.data.name), w - NODE_PADDING), x + w / 2, y + h / 2)
  }
}
