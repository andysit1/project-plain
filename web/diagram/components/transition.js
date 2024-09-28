
//TODO igure out how this class works + make connections in node

class TransitionGroup {
    constructor (parent, child) {
        this.parent = parent
        this.child = child
        this.transitions = []
    }

    offset (transition) {
        const index = this.transitions.indexOf(transition)

        const dir =
            {
            x: this.parent.rect.cx() - this.child.rect.cx(),
            y: this.parent.rect.cy() - this.child.rect.cy()
            }

        this.rotateDir(dir, Math.PI / 2)
        this.normalizeDir(dir)

        const str = ((index + 0.5) - this.transitions.length / 2) * LINE_SEPARATION

        return {
        x: dir.x * str,
        y: dir.y * str,
        dirX: dir.x,
        dirY: dir.y
        }
    }

    rotateDir (p, angle) {
        const s = Math.sin(angle)
        const c = Math.cos(angle)

        const x = p.x * c - p.y * s
        const y = p.x * s + p.y * c

        p.x = x
        p.y = y
    }

    normalizeDir (dir) {
        const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y)
        dir.x /= mag
        dir.y /= mag
    }
}

class Transition {
    constructor (id, name, parent, child, group) {
        this.id = id
        this.name = name
        this.parent = parent
        this.child = child
        this.group = group
        this.highlight = false

        group.transitions.push(this)
    }

    draw (ctx) {
        if (this.parent.layer !== graph.activeLayer ||
                this.child.layer !== graph.activeLayer) { return }

        const offset = this.group.offset(this)

        const a =
            {
            x: this.parent.rect.cx() + offset.x,
            y: this.parent.rect.cy() + offset.y
            }

        const b =
            {
            x: this.child.rect.cx() + offset.x,
            y: this.child.rect.cy() + offset.y
            }

        this.clipArrow(this.child.rect, a, b)
        const arrow = this.arrowBase(a, b)

        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(arrow.x, arrow.y)
        ctx.closePath()

        ctx.lineWidth = LINE_THICKNESS
        ctx.strokeStyle = this.highlight ? LINE_HIGHLIGHT : LINE_COLOR
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(arrow.x + offset.dirX * arrow.size, arrow.y + offset.dirY * arrow.size)
        ctx.lineTo(arrow.x - offset.dirX * arrow.size, arrow.y - offset.dirY * arrow.size)
        ctx.lineTo(b.x, b.y)
        ctx.closePath()

        ctx.fillStyle = this.highlight ? LINE_HIGHLIGHT : LINE_COLOR
        ctx.fill()
    }

    drawHover (ctx) {
        if (this.parent.layer !== graph.activeLayer ||
                this.child.layer !== graph.activeLayer) { return }

        if (!this.highlight || !this.name) { return }

        ctx.fillStyle = NODE_TEXT_COLOR
        ctx.font = LINE_TEXT_FONT
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(this.name, this.mousePos.x, this.mousePos.y - 10)
    }

    isInBounds (x, y) {
        if (this.parent.layer !== graph.activeLayer ||
                this.child.layer !== graph.activeLayer) { return false }

        function sqr (x) { return x * x }
        function dist2 (v, w) { return sqr(v.x - w.x) + sqr(v.y - w.y) }
        function distToSegmentSquared (p, v, w) {
        const l2 = dist2(v, w)
        if (l2 === 0) return dist2(p, v)
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
        t = Math.max(0, Math.min(1, t))
        return dist2(p, {
            x: v.x + t * (w.x - v.x),
            y: v.y + t * (w.y - v.y)
        })
        }
        function distToSegment (p, v, w) { return Math.sqrt(distToSegmentSquared(p, v, w)) }

        const offset = this.group.offset(this)

        const a =
            {
            x: this.parent.rect.cx() + offset.x,
            y: this.parent.rect.cy() + offset.y
            }

        const b =
            {
            x: this.child.rect.cx() + offset.x,
            y: this.child.rect.cy() + offset.y
            }

        this.clipArrow(this.child.rect, a, b)
        this.clipArrow(this.parent.rect, b, a)
        return distToSegment({ x: x, y: y }, a, b) <= LINE_THICKNESS
    }

    arrowBase (a, b) {
        const dir = { x: b.x - a.x, y: b.y - a.y }
        const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y)
        dir.x /= mag
        dir.y /= mag

        const arrowSize = LINE_THICKNESS * 2

        return {
        x: b.x - dir.x * arrowSize * 2,
        y: b.y - dir.y * arrowSize * 2,
        size: arrowSize
        }
    }

    clipArrow (rect, a, b) {
        const intersect = this.liangBarskyClipper(
        rect.x, rect.y, rect.x + rect.w, rect.y + rect.h,
        a.x, a.y,
        b.x, b.y)

        b.x = intersect.x
        b.y = intersect.y
    }

    liangBarskyClipper (xmin, ymin, xmax, ymax, x1, y1, x2, y2) {
        const p1 = -(x2 - x1)
        const p2 = -p1
        const p3 = -(y2 - y1)
        const p4 = -p3

        let n1 = 0
        let n2 = 0

        if (p1 !== 0) {
        if (p1 < 0) { n1 = (x1 - xmin) / p1 } else { n1 = (xmax - x1) / p2 }
        }

        if (p3 !== 0) {
        if (p3 < 0) { n2 = (y1 - ymin) / p3 } else { n2 = (ymax - y1) / p4 }
        }

        const rn = Math.max(0, n1, n2)
        return {
        x: x1 + p2 * rn,
        y: y1 + p4 * rn
        }
    }
}



class NestedGroup {
    constructor (id, indent, enter, exit) {
        this.id = id
        this.indent = indent
        this.enter = enter
        this.exit = exit
    }
}