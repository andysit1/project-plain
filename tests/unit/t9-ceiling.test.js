import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyCeiling } from '../../frontend/graph/components/ceiling.js'
import { NODE_W, NODE_H, NODE_CEILING, dirOf } from '../../shared/contracts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fx = name => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))

// Turns a raw CodeGraph fixture into a functions-mode Scene with deterministic grid positions,
// the way T5's merge stage would hand one to applyCeiling.
function toFunctionsScene (graph) {
    const nodes = graph.nodes.map((n, i) => ({
        ...n,
        x: (i % 50) * (NODE_W + 25),
        y: Math.floor(i / 50) * (NODE_H + 25),
        w: NODE_W,
        h: NODE_H,
        changed: false
    }))
    const dirs = [...new Set(nodes.map(n => dirOf(n.file)))]
    const groups = dirs.map(d => ({ id: d, title: d, x: 0, y: 0, w: 100, h: 100 }))
    return { mode: 'functions', nodes, groups, edges: graph.edges, layoutPatch: {}, total: nodes.length }
}

function rectsOverlap (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

test('small scene passes through unchanged (under the ceiling)', () => {
    const scene = toFunctionsScene(fx('graph.small.json'))
    assert.ok(scene.nodes.length <= NODE_CEILING)
    const out = applyCeiling(scene)
    assert.equal(out, scene) // same reference, untouched
    assert.equal(out.mode, 'functions')
})

test('large scene collapses to files mode: one node per file, no overlaps, aggregated edges', () => {
    const graph = fx('graph.large.json')
    const scene = toFunctionsScene(graph)
    assert.ok(scene.nodes.length > NODE_CEILING)

    const out = applyCeiling(scene)

    assert.equal(out.mode, 'files')
    assert.equal(out.total, scene.total)

    // one SceneNode per distinct file
    const expectedFiles = new Set(graph.nodes.map(n => n.file))
    assert.equal(out.nodes.length, expectedFiles.size)
    assert.equal(out.nodes.length, 400)

    const seenIds = new Set()
    for (const n of out.nodes) {
        assert.ok(expectedFiles.has(n.id))
        assert.equal(n.id, n.file)
        assert.equal(n.qname, n.file)
        assert.equal(n.kind, 'module')
        assert.equal(n.line, 1)
        assert.equal(n.w, NODE_W)
        assert.equal(n.h, NODE_H)
        assert.match(n.params, /^\d+ functions$/)
        assert.equal(n.returns, '')
        assert.equal(n.sig, '')
        assert.equal(n.body, '')
        assert.equal(typeof n.changed, 'boolean')
        assert.ok(!seenIds.has(n.id), `duplicate file node ${n.id}`)
        seenIds.add(n.id)
    }

    // no two file nodes overlap
    for (let i = 0; i < out.nodes.length; i++) {
        for (let j = i + 1; j < out.nodes.length; j++) {
            assert.ok(!rectsOverlap(out.nodes[i], out.nodes[j]),
                `nodes overlap: ${out.nodes[i].id} / ${out.nodes[j].id}`)
        }
    }

    // no two directory groups overlap either
    for (let i = 0; i < out.groups.length; i++) {
        for (let j = i + 1; j < out.groups.length; j++) {
            assert.ok(!rectsOverlap(out.groups[i], out.groups[j]),
                `groups overlap: ${out.groups[i].id} / ${out.groups[j].id}`)
        }
    }

    // every file node sits fully inside its directory's group box
    const groupById = new Map(out.groups.map(g => [g.id, g]))
    for (const n of out.nodes) {
        const g = groupById.get(dirOf(n.file))
        assert.ok(g, `missing group for ${n.file}`)
        assert.ok(n.x >= g.x && n.x + n.w <= g.x + g.w, `node ${n.id} escapes its group horizontally`)
        assert.ok(n.y >= g.y && n.y + n.h <= g.y + g.h, `node ${n.id} escapes its group vertically`)
    }

    // edges aggregated per file pair, no self-pairs
    const idToFile = new Map(graph.nodes.map(n => [n.id, n.file]))
    const expectedPairs = new Set()
    for (const e of graph.edges) {
        const ff = idToFile.get(e.from), tf = idToFile.get(e.to)
        if (ff !== tf) { expectedPairs.add(`${ff}>${tf}`) }
    }
    assert.equal(out.edges.length, expectedPairs.size)
    const seenEdgeIds = new Set()
    for (const e of out.edges) {
        assert.notEqual(e.from, e.to, `self-pair edge ${e.id}`)
        assert.equal(e.kind, 'call')
        assert.equal(e.id, `${e.from}>${e.to}`)
        assert.ok(expectedPairs.has(e.id))
        assert.ok(!seenEdgeIds.has(e.id), `duplicate aggregated edge ${e.id}`)
        seenEdgeIds.add(e.id)
    }

    assert.deepEqual(out.layoutPatch, {})
})
