// Merges a CodeGraph with a saved Layout into a Scene the canvas can draw.
// Pure: no DOM, no randomness, no clock except opts.now. Never mutates its inputs.

import { NODE_W, NODE_H, GROUP_PAD, dirOf } from '../../../shared/contracts.js'
import { findFreeSpot } from '../utils/placement.js'

function rectOfPos(pos) {
    return { x: pos.x, y: pos.y, w: NODE_W, h: NODE_H }
}

/**
 * @param {import('../../../shared/contracts.js').CodeGraph} graph
 * @param {import('../../../shared/contracts.js').Layout} layout
 * @param {import('../../../shared/contracts.js').CodeGraph|null} prevGraph
 * @param {{ now?: number, viewCenter?: {x:number,y:number} }} opts
 * @returns {import('../../../shared/contracts.js').Scene}
 */
export function merge(graph, layout, prevGraph = null, opts = {}) {
    const now = opts.now ?? 0
    const viewCenter = opts.viewCenter ?? { x: 0, y: 0 }

    const currentIds = new Set(graph.nodes.map(n => n.id))
    const prevById = new Map((prevGraph ? prevGraph.nodes : []).map(n => [n.id, n]))

    const patchNodes = {}
    const patchOrphans = {}
    const patchGroups = {}

    // ---------------------------------------------------------- vanished + orphans + rename pool

    const vanishedIds = Object.keys(layout.nodes).filter(id => !currentIds.has(id))
    // pool entries: candidates a same-body new node may claim
    const pool = []
    for (const [id, o] of Object.entries(layout.orphans)) {
        pool.push({ oldId: id, x: o.x, y: o.y, body: o.body, existing: true })
    }
    for (const id of vanishedIds) {
        const pos = layout.nodes[id]
        const body = prevById.has(id) ? prevById.get(id).body : ''
        pool.push({ oldId: id, x: pos.x, y: pos.y, body, existing: false })
        patchNodes[id] = null // no longer a scene node either way
    }

    const claims = new Map() // newId -> {x, y}
    for (const n of graph.nodes) {
        if (layout.nodes[n.id]) continue // has a saved spot, rule 1 wins
        const idx = pool.findIndex(p => p.body === n.body && p.body !== '')
        if (idx === -1) continue
        const [p] = pool.splice(idx, 1)
        claims.set(n.id, { x: p.x, y: p.y })
        if (p.existing) patchOrphans[p.oldId] = null // delete the claimed orphan entry
        // if !p.existing, it was never written to orphans; nothing to delete
    }
    // whatever is left in pool and came from a fresh vanish this run becomes a new orphan
    for (const p of pool) {
        if (!p.existing) {
            patchOrphans[p.oldId] = { x: p.x, y: p.y, body: p.body, since: now }
        }
    }

    // ---------------------------------------------------------- positions

    const placedPos = {} // id -> {x, y}, for every current graph node already positioned
    const reserved = []  // rects that must not be overlapped: placed nodes + reserved orphan spots

    for (const id of Object.keys(layout.orphans)) {
        if (patchOrphans[id] === null) continue // claimed away this run
        const o = layout.orphans[id]
        reserved.push({ x: o.x, y: o.y, w: NODE_W, h: NODE_H })
    }
    for (const id of vanishedIds) {
        if (patchOrphans[id]) reserved.push(rectOfPos(patchOrphans[id])) // newly orphaned, unclaimed
    }

    for (const n of graph.nodes) {
        if (layout.nodes[n.id]) {
            placedPos[n.id] = layout.nodes[n.id]
            reserved.push(rectOfPos(placedPos[n.id]))
        } else if (claims.has(n.id)) {
            const pos = claims.get(n.id)
            placedPos[n.id] = pos
            patchNodes[n.id] = pos
            reserved.push(rectOfPos(pos))
        }
    }

    const isFirstRun = Object.keys(layout.nodes).length === 0
    const columnTargets = isFirstRun ? computeColumns(graph) : null

    for (const n of graph.nodes) {
        if (placedPos[n.id]) continue // already positioned above

        let near, side
        if (isFirstRun) {
            const c = columnTargets.get(n.id)
            near = { x: c.x + NODE_W / 2, y: c.y + NODE_H / 2 }
            side = undefined
        } else {
            const rel = findPlacedRelative(n, graph.edges, placedPos)
            if (rel) {
                near = rel.near
                side = rel.side
            } else {
                const below = findBelowSameFile(n, graph.nodes, placedPos)
                if (below) {
                    near = below.near
                    side = 'below'
                } else {
                    const g = layout.groups[dirOf(n.file)]
                    if (g) {
                        near = { x: g.x + g.w / 2, y: g.y + g.h / 2 }
                        side = undefined
                    } else {
                        near = viewCenter
                        side = undefined
                    }
                }
            }
        }

        const pos = findFreeSpot(reserved, NODE_W, NODE_H, near, 200, side ? { side } : undefined)
        placedPos[n.id] = pos
        patchNodes[n.id] = pos
        reserved.push(rectOfPos(pos))
    }

    // ---------------------------------------------------------- scene nodes

    const sceneNodes = graph.nodes.map(n => {
        const pos = placedPos[n.id]
        const prev = prevById.get(n.id)
        const changed = !!prev && prev.sig !== n.sig
        return { ...n, x: pos.x, y: pos.y, w: NODE_W, h: NODE_H, changed }
    })

    // ---------------------------------------------------------- groups

    const byDir = new Map()
    for (const sn of sceneNodes) {
        const d = dirOf(sn.file)
        if (!byDir.has(d)) byDir.set(d, [])
        byDir.get(d).push(sn)
    }

    const sceneGroups = []
    for (const [dir, members] of byDir) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const m of members) {
            minX = Math.min(minX, m.x)
            minY = Math.min(minY, m.y)
            maxX = Math.max(maxX, m.x + m.w)
            maxY = Math.max(maxY, m.y + m.h)
        }
        const rect = {
            x: minX - GROUP_PAD, y: minY - GROUP_PAD,
            w: (maxX - minX) + 2 * GROUP_PAD, h: (maxY - minY) + 2 * GROUP_PAD,
        }
        sceneGroups.push({ id: dir, title: dir, x: rect.x, y: rect.y, w: rect.w, h: rect.h })

        const saved = layout.groups[dir]
        if (!saved || saved.x !== rect.x || saved.y !== rect.y || saved.w !== rect.w || saved.h !== rect.h) {
            patchGroups[dir] = rect
        }
    }
    // directories that no longer have any member: drop the saved group
    for (const dir of Object.keys(layout.groups)) {
        if (!byDir.has(dir)) patchGroups[dir] = null
    }

    sceneGroups.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

    const layoutPatch = {}
    if (Object.keys(patchNodes).length) layoutPatch.nodes = patchNodes
    if (Object.keys(patchGroups).length) layoutPatch.groups = patchGroups
    if (Object.keys(patchOrphans).length) layoutPatch.orphans = patchOrphans

    return {
        mode: 'functions',
        nodes: sceneNodes,
        groups: sceneGroups,
        edges: graph.edges,
        layoutPatch,
        total: graph.nodes.length,
    }
}

// ---------------------------------------------------------------- placement helpers

function findPlacedRelative(n, edges, placedPos) {
    for (const e of edges) {
        if (e.to === n.id && placedPos[e.from]) {
            const caller = placedPos[e.from]
            return {
                side: 'right',
                near: { x: caller.x + NODE_W + 25 + NODE_W / 2, y: caller.y + NODE_H / 2 },
            }
        }
        if (e.from === n.id && placedPos[e.to]) {
            const callee = placedPos[e.to]
            return {
                side: 'left',
                near: { x: callee.x - 25 - NODE_W / 2, y: callee.y + NODE_H / 2 },
            }
        }
    }
    return null
}

function findBelowSameFile(n, nodesInOrder, placedPos) {
    let lowest = null
    for (const other of nodesInOrder) {
        if (other.file !== n.file) continue
        const pos = placedPos[other.id]
        if (!pos) continue
        if (!lowest || pos.y > lowest.y) lowest = pos
    }
    if (!lowest) return null
    return { near: { x: lowest.x + NODE_W / 2, y: lowest.y + NODE_H + 25 + NODE_H / 2 } }
}

/** First-run layout: one column per file, files in the same directory side by side,
 * directories left to right with a gap between groups. Returns Map(id -> {x, y}). */
function computeColumns(graph) {
    const colWidth = NODE_W + 25
    const rowHeight = NODE_H + 25
    const dirGap = 25 * 4

    const dirOrder = []
    const filesByDir = new Map()
    for (const n of graph.nodes) {
        const d = dirOf(n.file)
        if (!filesByDir.has(d)) { filesByDir.set(d, []); dirOrder.push(d) }
        const files = filesByDir.get(d)
        if (!files.includes(n.file)) files.push(n.file)
    }

    const nodesByFile = new Map()
    for (const n of graph.nodes) {
        if (!nodesByFile.has(n.file)) nodesByFile.set(n.file, [])
        nodesByFile.get(n.file).push(n)
    }
    for (const arr of nodesByFile.values()) arr.sort((a, b) => a.line - b.line)

    const targets = new Map()
    let dirX = 0
    for (const dir of dirOrder) {
        const files = filesByDir.get(dir)
        files.forEach((file, colIdx) => {
            const colX = dirX + colIdx * colWidth
            const nodes = nodesByFile.get(file)
            nodes.forEach((n, rowIdx) => {
                targets.set(n.id, { x: colX, y: rowIdx * rowHeight })
            })
        })
        dirX += files.length * colWidth + dirGap
    }
    return targets
}
