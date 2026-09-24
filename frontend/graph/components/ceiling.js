// Collapses an oversized Scene (functions mode) down to one node per file (files mode) so the
// canvas never has to draw more than NODE_CEILING boxes worth of detail. Pure function, no DOM.

import { NODE_CEILING, NODE_W, NODE_H, NODE_GAP, GROUP_PAD, dirOf, edgeId } from '../../../shared/contracts.js'

const FILES_PER_ROW = 4 // deterministic grid width inside a directory group

function basename (file) {
    const i = file.lastIndexOf('/')
    return i < 0 ? file : file.slice(i + 1)
}

/** scene: Scene (see shared/contracts.js). Returns scene unchanged when at/under the ceiling,
 * otherwise a new files-mode Scene: one SceneNode per file, laid out in directory groups placed
 * side by side (never overlapping), with edges aggregated per file pair (self-pairs dropped). */
export function applyCeiling (scene) {
    if (!scene || !Array.isArray(scene.nodes) || scene.nodes.length <= NODE_CEILING) {
        return scene
    }

    // group members by file, tracking whether any member changed and which node ids belong to it
    const files = new Map() // file -> { file, count, changed }
    const idToFile = new Map()
    for (const n of scene.nodes) {
        idToFile.set(n.id, n.file)
        let f = files.get(n.file)
        if (!f) { f = { file: n.file, count: 0, changed: false }; files.set(n.file, f) }
        f.count++
        if (n.changed) { f.changed = true }
    }

    // group files by directory, both sorted for a deterministic layout
    const dirs = new Map() // dir -> file[]
    for (const file of files.keys()) {
        const d = dirOf(file)
        if (!dirs.has(d)) { dirs.set(d, []) }
        dirs.get(d).push(file)
    }
    const sortedDirs = [...dirs.keys()].sort()
    for (const list of dirs.values()) { list.sort() }

    const groups = []
    const nodes = []
    let groupX = 0

    for (const dir of sortedDirs) {
        const filesInDir = dirs.get(dir)
        const cols = Math.min(FILES_PER_ROW, filesInDir.length)
        const rows = Math.ceil(filesInDir.length / cols)
        const groupW = GROUP_PAD * 2 + cols * NODE_W + (cols - 1) * NODE_GAP
        const groupH = GROUP_PAD * 2 + rows * NODE_H + (rows - 1) * NODE_GAP

        filesInDir.forEach((file, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            const f = files.get(file)
            nodes.push({
                id: file,
                name: basename(file),
                qname: file,
                file,
                line: 1,
                kind: 'module',
                params: `${f.count} functions`,
                returns: '',
                sig: '',
                body: '',
                changed: f.changed,
                x: groupX + GROUP_PAD + col * (NODE_W + NODE_GAP),
                y: GROUP_PAD + row * (NODE_H + NODE_GAP),
                w: NODE_W,
                h: NODE_H
            })
        })

        groups.push({ id: dir, title: dir, x: groupX, y: 0, w: groupW, h: groupH })
        groupX += groupW + GROUP_PAD * 4 // gap between groups
    }

    // aggregate edges per (fromFile, toFile) pair, dropping same-file pairs
    const edgeMap = new Map()
    for (const e of scene.edges || []) {
        const fromFile = idToFile.get(e.from)
        const toFile = idToFile.get(e.to)
        if (!fromFile || !toFile || fromFile === toFile) { continue }
        const id = edgeId(fromFile, toFile)
        if (!edgeMap.has(id)) { edgeMap.set(id, { id, from: fromFile, to: toFile, kind: 'call' }) }
    }

    return {
        mode: 'files',
        nodes,
        groups,
        edges: [...edgeMap.values()],
        layoutPatch: {},
        total: scene.total
    }
}
