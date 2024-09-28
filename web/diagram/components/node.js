const NODE_CORNER_RADIUS = 8
const NODE_COLOR = '#552222'
const NODE_BORDER_COLOR = '#555555'
const NODE_TEXT_FONT = '12px Calibri'
const NODE_TEXT_COLOR = '#CCCCCC'
const NODE_ACTIVE_COLOR = '#556699'
const LINE_COLOR = '#555555'
const LINE_THICKNESS = 5
const LINE_SEPARATION = 16
const LINE_HIGHLIGHT = '#888888'
const LINE_TEXT_FONT = '12px Calibri'
const LAYER_ENTER_COLOR = '#559966'

export class Rect {
    constructor (x, y, w, h) {
      this.x = x
      this.y = y
      this.w = w
      this.h = h
    }
  
    cx () {
      return this.x + this.w / 2
    }
  
    cy () {
      return this.y + this.h / 2
    }
}

export class State {
    constructor (id, name, rect) {
        this.id = id
        this.name = name
        this.rect = rect
        this.highlight = false
        this.activeState = false
    }

    draw (ctx) {

        this.fillNodePath(ctx)

        ctx.fillStyle = NODE_COLOR
        ctx.fill()

        ctx.lineWidth = 2
        ctx.strokeStyle = NODE_BORDER_COLOR
        ctx.stroke()

        ctx.fillStyle = NODE_TEXT_COLOR
        ctx.font = NODE_TEXT_FONT
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.name, this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2)
    }

    drawActive (ctx) {

        if (!this.activeState) { return }

        this.fillNodePath(ctx, 8)
        ctx.lineWidth = 3
        ctx.strokeStyle = NODE_ACTIVE_COLOR
        ctx.stroke()
    }

    fillNodePath (ctx, buffer = 0) {
        const x = this.rect.x - buffer
        const y = this.rect.y - buffer
        const w = this.rect.w + buffer * 2
        const h = this.rect.h + buffer * 2
        const r = NODE_CORNER_RADIUS + buffer

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

    isInBounds (x, y) {
        const r = NODE_CORNER_RADIUS

        return x >= this.rect.x - r && x < this.rect.x + this.rect.w + r && y >= this.rect.y - r &&
                y < this.rect.y + this.rect.h + r
    }
}
