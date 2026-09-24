// Flow layout: arranges a call graph left-to-right in the order the program runs.
// Entry points (functions nobody calls; `<module>` and `main` first) sit in the leftmost
// column, and every callee sits one column right of its deepest caller (longest path).
// Nodes within a column are ordered with barycenter sweeps to reduce edge crossings, and
// long edges reserve a thin slot in each column they pass, leaving the router a clear lane.
// Each weakly connected call tree gets its own horizontal band; unconnected functions go in
// a compact grid at the bottom. Pure and deterministic: same graph -> same positions.

import { NODE_W, NODE_H, GRID } from '../../../shared/contracts.js'

export const COL_GAP = 150          // horizontal room between columns, where edges are routed
export const ROW_STEP = NODE_H + 44 // vertical pitch of real nodes in a column
const DUMMY_STEP = 25               // vertical slot a long edge reserves in a column it crosses
const BAND_GAP = 100                // space between separate call trees
const SWEEPS = 12
const LONE_COLS = 4

const snap = v => Math.round(v / GRID) * GRID

/** Returns Map(id -> {x, y}) (top-left, snapped to GRID) for every node in `graph`. */
export function flowLayout(graph) {
    const nodes = graph.nodes
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const out = new Map()
    if (!nodes.length) return out

    const succ = nodes.map(() => [])
    const pred = nodes.map(() => [])
    for (const e of graph.edges) {
        const a = index.get(e.from), b = index.get(e.to)
        if (a === undefined || b === undefined || a === b) continue
        succ[a].push(b)
        pred[b].push(a)
    }
    // entry points first: <module> blocks, then main, then graph order
    const rank = i => (nodes[i].kind === 'module' ? 0 : nodes[i].name === 'main' ? 1 : 2)
    const byPriority = (a, b) => rank(a) - rank(b) || a - b
    for (const list of succ) list.sort(byPriority)

    // ---------------------------------------------------------------- weakly connected components
    const comp = new Array(nodes.length).fill(-1)
    const comps = []
    for (let i = 0; i < nodes.length; i++) {
        if (comp[i] !== -1) continue
        const members = []
        const stack = [i]
        comp[i] = comps.length
        while (stack.length) {
            const v = stack.pop()
            members.push(v)
            for (const w of succ[v].concat(pred[v])) {
                if (comp[w] === -1) { comp[w] = comps.length; stack.push(w) }
            }
        }
        comps.push(members.sort((a, b) => a - b))
    }

    let bandY = 0
    const lonely = []
    for (const members of comps) {
        if (members.length === 1 && !succ[members[0]].length && !pred[members[0]].length) {
            lonely.push(members[0])
            continue
        }
        const height = layoutComponent(members, succ, pred, byPriority, bandY, nodes, out)
        bandY = snap(bandY + height + BAND_GAP)
    }

    // unconnected functions: a compact grid in graph order (file, then line)
    lonely.forEach((v, k) => {
        out.set(nodes[v].id, {
            x: snap((k % LONE_COLS) * (NODE_W + GRID * 2)),
            y: snap(bandY + Math.floor(k / LONE_COLS) * ROW_STEP),
        })
    })
    return out
}

function layoutComponent(members, succ, pred, byPriority, top, nodes, out) {
    const inComp = new Set(members)

    // ------------------------------------------------ break cycles: DFS from entry points
    const sources = members.filter(v => !pred[v].some(u => inComp.has(u))).sort(byPriority)
    const starts = sources.length ? sources : [members.slice().sort(byPriority)[0]]
    const state = new Map() // 1 = on stack, 2 = done
    const back = new Set()  // "u>v" edges that close a cycle
    const order = []        // DFS discovery order, used as the initial in-column order
    const visit = root => {
        if (state.has(root)) return
        const stack = [[root, 0]]
        state.set(root, 1)
        order.push(root)
        while (stack.length) {
            const top = stack[stack.length - 1]
            const [v, i] = top
            if (i < succ[v].length) {
                top[1]++
                const w = succ[v][i]
                if (!state.has(w)) { state.set(w, 1); order.push(w); stack.push([w, 0]) }
                else if (state.get(w) === 1) back.add(`${v}>${w}`)
            } else {
                state.set(v, 2)
                stack.pop()
            }
        }
    }
    starts.forEach(visit)
    members.slice().sort(byPriority).forEach(visit) // anything only reachable inside a cycle

    // ------------------------------------------------ layers: longest path over the DAG
    const fwd = v => succ[v].filter(w => !back.has(`${v}>${w}`))
    const indeg = new Map(members.map(v => [v, 0]))
    for (const v of members) for (const w of fwd(v)) indeg.set(w, indeg.get(w) + 1)
    const layer = new Map(members.map(v => [v, 0]))
    const queue = members.filter(v => indeg.get(v) === 0)
    while (queue.length) {
        const v = queue.shift()
        for (const w of fwd(v)) {
            layer.set(w, Math.max(layer.get(w), layer.get(v) + 1))
            indeg.set(w, indeg.get(w) - 1)
            if (indeg.get(w) === 0) queue.push(w)
        }
    }
    const depth = Math.max(...members.map(v => layer.get(v))) + 1

    // ------------------------------------------------ columns with dummy slots for long edges
    // item: { v } for a real node, { dummy: true } for a slot a long edge passes through
    const cols = Array.from({ length: depth }, () => [])
    const up = new Map()   // item -> items in the previous column it connects to
    const down = new Map() // item -> items in the next column
    const link = (a, b) => {
        if (!down.has(a)) down.set(a, [])
        if (!up.has(b)) up.set(b, [])
        down.get(a).push(b)
        up.get(b).push(a)
    }
    const itemOf = new Map()
    const firstSeen = new Map(order.map((v, i) => [v, i]))
    for (const v of members.slice().sort((a, b) => firstSeen.get(a) - firstSeen.get(b))) {
        const it = { v }
        itemOf.set(v, it)
        cols[layer.get(v)].push(it)
    }
    for (const v of members) {
        for (const w of fwd(v)) {
            let prev = itemOf.get(v)
            for (let l = layer.get(v) + 1; l < layer.get(w); l++) {
                const d = { dummy: true }
                cols[l].push(d)
                link(prev, d)
                prev = d
            }
            link(prev, itemOf.get(w))
        }
    }

    // ------------------------------------------------ order within columns: barycenter sweeps
    // Positions are normalised to 0..1 so columns of different sizes compare fairly; the
    // ordering with the fewest crossings across all sweeps wins.
    const pos = new Map()
    const renumber = col => col.forEach((it, i) => pos.set(it, (i + 0.5) / col.length))
    cols.forEach(renumber)
    const sweep = (col, nbrs) => {
        const bary = new Map(col.map(it => {
            const ns = nbrs.get(it)
            return [it, ns && ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(it)]
        }))
        col.sort((a, b) => bary.get(a) - bary.get(b) || pos.get(a) - pos.get(b))
        renumber(col)
    }
    let best = cols.map(c => c.slice()), bestX = crossings(cols, down, pos)
    for (let s = 0; s < SWEEPS && bestX > 0; s++) {
        if (s % 2 === 0) for (let l = 1; l < depth; l++) sweep(cols[l], up)
        else for (let l = depth - 2; l >= 0; l--) sweep(cols[l], down)
        const x = crossings(cols, down, pos)
        if (x < bestX) { bestX = x; best = cols.map(c => c.slice()) }
    }
    best.forEach((c, l) => { cols[l] = c })

    // ------------------------------------------------ coordinates: columns centred in the band
    const colHeight = col => col.reduce((h, it) => h + (it.dummy ? DUMMY_STEP : ROW_STEP), 0)
    const bandHeight = Math.max(...cols.map(colHeight))
    cols.forEach((col, l) => {
        let y = top + (bandHeight - colHeight(col)) / 2
        for (const it of col) {
            if (!it.dummy) out.set(nodes[it.v].id, { x: snap(l * (NODE_W + COL_GAP)), y: snap(y) })
            y += it.dummy ? DUMMY_STEP : ROW_STEP
        }
    })
    return bandHeight
}

/** Edge crossings between adjacent columns (inversion count per column pair). */
function crossings(cols, down, pos) {
    let total = 0
    for (let l = 0; l + 1 < cols.length; l++) {
        const pairs = []
        for (const it of cols[l]) for (const w of down.get(it) || []) pairs.push([pos.get(it), pos.get(w)])
        if (pairs.length > 3000) return 0 // too big to count cheaply; keep the last sweep
        pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                if (pairs[i][0] < pairs[j][0] && pairs[i][1] > pairs[j][1]) total++
            }
        }
    }
    return total
}
