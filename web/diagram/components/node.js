class Rect {
    constructor (x, y, w, h) {
      this.x = x
      this.y = y
      this.w = w
      this.h = h
    }
  
    center_x () {
      return this.x + this.w / 2
    }
  
    center_y () {
      return this.y + this.h / 2
    }
}

class State {
    constructor (id, name, rect, layer) {
        this.id = id
        this.name = name
        this.rect = rect
        this.layer = layer
        this.highlight = false
        this.activeState = false
        this.enterState = false
        this.exitState = false
    }

    draw (ctx) {
        if (this.layer !== graph.activeLayer) { return }

        this.fillNodePath(ctx)

        ctx.fillStyle = this.enterState ? LAYER_ENTER_COLOR : NODE_COLOR
        ctx.fill()

        ctx.lineWidth = 2
        ctx.strokeStyle = this.highlight ? NODE_HIGHLIGHT_COLOR : NODE_BORDER_COLOR
        ctx.stroke()

        ctx.fillStyle = NODE_TEXT_COLOR
        ctx.font = NODE_TEXT_FONT
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.name, this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2)
    }

    drawActive (ctx) {
        if (this.layer !== graph.activeLayer) { return }

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
        if (this.layer !== graph.activeLayer) {
        return false
        }

        const r = NODE_CORNER_RADIUS

        return x >= this.rect.x - r && x < this.rect.x + this.rect.w + r && y >= this.rect.y - r &&
                y < this.rect.y + this.rect.h + r
    }
}
