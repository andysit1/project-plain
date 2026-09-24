// Node placement: find the free grid slot nearest a target point.
// Used for every node the user didn't place by hand, so nodes never stack.

import { GRID, NODE_GAP } from '../../../shared/contracts.js'

export { GRID, NODE_GAP }

export const snap = (v) => Math.round(v / GRID) * GRID

function rectOf(s) {
    return s.rect || s
}

function overlaps(a, b, gap) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
           a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

/**
 * Returns {x, y} for a w×h node, centred as close to `near` as possible
 * without overlapping any rect in `states`. Searches outward ring by ring on the grid.
 * `states` entries may be `{rect: {x,y,w,h}}` or a plain rect `{x,y,w,h}`.
 * `opts.side`: 'right' | 'left' | 'below' | undefined. When given, cells on that
 * side of `near` are preferred (nearest first), falling back to any free cell.
 */
export function findFreeSpot(states, w, h, near, maxRings = 200, opts = {}) {
    const { side } = opts
    const cx = snap(near.x - w / 2)
    const cy = snap(near.y - h / 2)
    const stepX = snap(w + NODE_GAP) || GRID
    const stepY = snap(h + NODE_GAP) || GRID
    const free = (x, y) => !states.some(s => {
        const r = rectOf(s)
        return r && overlaps({ x, y, w, h }, r, NODE_GAP)
    })

    const onSide = (i, j) => {
        if (side === 'right') return i >= 0
        if (side === 'left') return i <= 0
        if (side === 'below') return j >= 0
        return true
    }

    const search = (filter) => {
        if (filter(0, 0) && free(cx, cy)) return { x: cx, y: cy }
        for (let ring = 1; ring <= maxRings; ring++) {
            // walk the square ring of cells at Chebyshev distance `ring`, nearest cells first
            const cells = []
            for (let i = -ring; i <= ring; i++) {
                cells.push([i, -ring], [i, ring])
                if (i !== -ring && i !== ring) cells.push([-ring, i], [ring, i])
            }
            cells.sort((a, b) => Math.hypot(a[0] * stepX, a[1] * stepY) - Math.hypot(b[0] * stepX, b[1] * stepY))
            for (const [i, j] of cells) {
                if (!filter(i, j)) continue
                const x = cx + i * stepX, y = cy + j * stepY
                if (free(x, y)) return { x, y }
            }
        }
        return null
    }

    if (side) {
        const hit = search(onSide)
        if (hit) return hit
    }
    const any = search(() => true)
    if (any) return any
    return { x: cx, y: cy } // graph is absurdly full; fall back to stacking
}
