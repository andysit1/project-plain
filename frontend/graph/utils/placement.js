// Node placement: find the free grid slot nearest a target point.
// Used for every node the user didn't place by hand, so nodes never stack.

export const GRID = 25          // matches the minor grid lines drawn by Graph
export const NODE_GAP = 25      // minimum clear space between two nodes

export const snap = (v) => Math.round(v / GRID) * GRID

function overlaps(a, b, gap) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
           a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

/**
 * Returns {x, y} for a w×h node, centred as close to `near` as possible
 * without overlapping any rect in `states`. Searches outward ring by ring on the grid.
 */
export function findFreeSpot(states, w, h, near, maxRings = 200) {
    const cx = snap(near.x - w / 2)
    const cy = snap(near.y - h / 2)
    const stepX = snap(w + NODE_GAP) || GRID
    const stepY = snap(h + NODE_GAP) || GRID
    const free = (x, y) => !states.some(s => s.rect && overlaps({ x, y, w, h }, s.rect, NODE_GAP))

    if (free(cx, cy)) return { x: cx, y: cy }
    for (let ring = 1; ring <= maxRings; ring++) {
        // walk the square ring of cells at Chebyshev distance `ring`, nearest cells first
        const cells = []
        for (let i = -ring; i <= ring; i++) {
            cells.push([i, -ring], [i, ring])
            if (i !== -ring && i !== ring) cells.push([-ring, i], [ring, i])
        }
        cells.sort((a, b) => Math.hypot(a[0] * stepX, a[1] * stepY) - Math.hypot(b[0] * stepX, b[1] * stepY))
        for (const [i, j] of cells) {
            const x = cx + i * stepX, y = cy + j * stepY
            if (free(x, y)) return { x, y }
        }
    }
    return { x: cx, y: cy } // graph is absurdly full; fall back to stacking
}
