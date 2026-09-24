// CodeNode: a Drawable that renders one SceneNode (shared/contracts.js) as a rounded box.
// Browser ES module: no Node APIs. Imports only shared/contracts.js.
import { RING_MS } from '../../../shared/contracts.js'

const CORNER_RADIUS = 8
export const NODE_PADDING = 10
const PADDING = NODE_PADDING
const LINE1_FONT = 'bold 13px Calibri'
const LINE2_FONT = '12px Calibri'
const LINE1_COLOR = '#F2F2F2'
const LINE2_COLOR = '#D8D8D8'
const BORDER_COLOR = '#333333'
const SELECT_COLOR = '#FFD75E'
const RING_COLOR = '107, 168, 255' // rgb triple, alpha varies with ring progress
const RING_MAX_MARGIN = 8
const SELECT_MARGIN = 3

export const KIND_COLORS = Object.freeze({
  fn: '#2E5D45',      // green
  method: '#2E4A5D',  // blue
  module: '#5D4A2E',  // amber/brown
})

const DEFAULT_FILL = '#444444'

export class CodeNode {
  /**
   * @param {import('../../../shared/contracts.js').SceneNode} sceneNode
   * @param {{ now?: () => number }} [opts]
   */
  constructor(sceneNode, { now = () => performance.now() } = {}) {
    this.data = sceneNode
    this.id = sceneNode.id
    this.selected = false
    this._now = now
    this._createdAt = sceneNode.changed ? now() : null
  }

  /** True while the change ring is still animating. */
  isAnimating(t = this._now()) {
    if (this._createdAt === null) return false
    return (t - this._createdAt) < RING_MS
  }

  bounds() {
    const { x, y, w, h } = this.data
    const margin = Math.max(RING_MAX_MARGIN, SELECT_MARGIN)
    return { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 }
  }

  hitTest(x, y) {
    const { x: nx, y: ny, w, h } = this.data
    return x >= nx && x < nx + w && y >= ny && y < ny + h
  }

  moveTo(x, y) {
    this.data.x = x
    this.data.y = y
  }

  draw(ctx, view) {
    const { x, y, w, h, kind } = this.data
    const fill = KIND_COLORS[kind] || DEFAULT_FILL

    this._roundedRectPath(ctx, x, y, w, h, CORNER_RADIUS)
    ctx.fillStyle = fill
    ctx.fill()

    ctx.lineWidth = 1.5
    ctx.strokeStyle = BORDER_COLOR
    ctx.stroke()

    if (view.showLabels) {
      this._drawText(ctx, x, y, w, h)
    }

    if (this.selected) {
      this._drawSelection(ctx, x, y, w, h)
    }

    if (this._createdAt !== null) {
      this._drawRing(ctx, x, y, w, h)
    }
  }

  _drawText(ctx, x, y, w, h) {
    const { name, params, returns } = this.data
    const sig = returns ? `${name}(${params}) -> ${returns}` : `${name}(${params})`
    const maxWidth = w - PADDING * 2
    const cx = x + w / 2

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.font = LINE1_FONT
    ctx.fillStyle = LINE1_COLOR
    const line1 = this._fitText(ctx, String(name), maxWidth)
    ctx.fillText(line1, cx, y + h * 0.35)

    ctx.font = LINE2_FONT
    ctx.fillStyle = LINE2_COLOR
    const line2 = this._fitText(ctx, sig, maxWidth)
    ctx.fillText(line2, cx, y + h * 0.72)
  }

  _drawSelection(ctx, x, y, w, h) {
    this._roundedRectPath(ctx, x - SELECT_MARGIN, y - SELECT_MARGIN, w + SELECT_MARGIN * 2, h + SELECT_MARGIN * 2, CORNER_RADIUS + SELECT_MARGIN)
    ctx.lineWidth = 2
    ctx.strokeStyle = SELECT_COLOR
    ctx.stroke()
  }

  _drawRing(ctx, x, y, w, h) {
    const t = this._now()
    const elapsed = t - this._createdAt
    if (elapsed >= RING_MS) return
    const progress = Math.max(0, Math.min(1, elapsed / RING_MS))
    const alpha = 1 - progress
    const margin = RING_MAX_MARGIN * progress + 2

    this._roundedRectPath(ctx, x - margin, y - margin, w + margin * 2, h + margin * 2, CORNER_RADIUS + margin)
    ctx.lineWidth = 2.5
    ctx.strokeStyle = `rgba(${RING_COLOR}, ${alpha})`
    ctx.stroke()
  }

  // Shorten `text` with an ellipsis so it fits within maxWidth, using binary search on measureText.
  _fitText(ctx, text, maxWidth) {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) { lo = mid } else { hi = mid - 1 }
    }
    return lo === 0 ? '' : text.slice(0, lo) + '…'
  }

  _roundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2)
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
}
