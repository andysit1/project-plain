// FolderGroup: a Drawable that renders a SceneGroup (directory) as a subtle
// rounded box sitting behind nodes, with the directory title top-left.
// Browser ES module: no Node APIs. Only shared/contracts.js may be imported.

const GROUP_CORNER_RADIUS = 10
const GROUP_FILL_COLOR = 'rgba(255, 255, 255, 0.04)'
const GROUP_BORDER_COLOR = 'rgba(255, 255, 255, 0.18)'
const GROUP_TITLE_COLOR = '#888888'
const GROUP_TITLE_FONT = '11px Calibri'
const GROUP_TITLE_PAD = 8

/** Draws a SceneGroup (directory box) behind the nodes it contains. No interaction in v1. */
export class FolderGroup {
  constructor (sceneGroup) {
    this.data = sceneGroup
    this.id = sceneGroup.id
  }

  draw (ctx, view) {
    const { x, y, w, h, title } = this.data

    this.fillGroupPath(ctx, x, y, w, h)
    ctx.fillStyle = GROUP_FILL_COLOR
    ctx.fill()

    ctx.lineWidth = 1 / view.k
    ctx.strokeStyle = GROUP_BORDER_COLOR
    ctx.stroke()

    if (!view.showLabels) return

    ctx.fillStyle = GROUP_TITLE_COLOR
    ctx.font = GROUP_TITLE_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const maxWidth = Math.max(0, w - GROUP_TITLE_PAD * 2)
    const text = this.fitText(ctx, String(title), maxWidth)
    ctx.fillText(text, x + GROUP_TITLE_PAD, y + GROUP_TITLE_PAD)
  }

  // shorten with an ellipsis so long directory titles stay inside the box
  fitText (ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid
      else hi = mid - 1
    }
    return text.slice(0, lo) + '…'
  }

  fillGroupPath (ctx, x, y, w, h) {
    const r = Math.min(GROUP_CORNER_RADIUS, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  bounds () {
    const { x, y, w, h } = this.data
    return { x, y, w, h }
  }
}
