import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  emptyLayout, applyLayoutPatch, isEmptyPatch, validateLayoutPatch,
  NODE_W, NODE_H,
} from '../../shared/contracts.js'
import { merge } from '../../frontend/graph/components/merge.js'
import { findFreeSpot, GRID, NODE_GAP, snap } from '../../frontend/graph/utils/placement.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fx = name => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))

function assertNoOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      assert.ok(!overlap, `nodes overlap: ${a.id} @ (${a.x},${a.y}) vs ${b.id} @ (${b.x},${b.y})`)
    }
  }
}

test('merging graph.small.json twice gives identical positions', () => {
  const g = fx('graph.small.json')
  const layout = emptyLayout()
  const s1 = merge(g, layout, null, { now: 1000 })
  const s2 = merge(g, layout, null, { now: 1000 })
  assert.deepEqual(s1.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
    s2.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })))
  assertNoOverlap(s1.nodes)
})

test('applying the patch and merging again gives an empty patch and same positions', () => {
  const g = fx('graph.small.json')
  const layout = emptyLayout()
  const s1 = merge(g, layout, null, { now: 1000 })
  validateLayoutPatch(s1.layoutPatch)
  const layout2 = applyLayoutPatch(layout, s1.layoutPatch)
  const s2 = merge(g, layout2, g, { now: 2000 })
  assert.ok(isEmptyPatch(s2.layoutPatch), 'expected empty patch on second merge')
  assert.deepEqual(s1.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
    s2.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })))
})

test('merging graph.small.v2.json onto layout.small.json moves no saved node', () => {
  const g1 = fx('graph.small.json')
  const g2 = fx('graph.small.v2.json')
  const layout = fx('layout.small.json')
  const scene = merge(g2, layout, g1, { now: 5000 })

  for (const [id, pos] of Object.entries(layout.nodes)) {
    const stillPresent = g2.nodes.some(n => n.id === id)
    if (!stillPresent) continue
    const sn = scene.nodes.find(n => n.id === id)
    assert.ok(sn, `expected ${id} still in scene`)
    assert.equal(sn.x, pos.x, `${id}.x moved`)
    assert.equal(sn.y, pos.y, `${id}.y moved`)
  }
  assertNoOverlap(scene.nodes)
})

test('rename transfer, orphan creation and new-node placement', () => {
  const g1 = fx('graph.small.json')
  const g2 = fx('graph.small.v2.json')
  const layout = fx('layout.small.json')
  const scene = merge(g2, layout, g1, { now: 9000 })

  // make_slug takes slugify's old spot
  const oldSlugify = layout.nodes['app/utils.py::slugify']
  const makeSlug = scene.nodes.find(n => n.id === 'app/utils.py::make_slug')
  assert.ok(makeSlug, 'make_slug present in scene')
  assert.equal(makeSlug.x, oldSlugify.x)
  assert.equal(makeSlug.y, oldSlugify.y)
  assert.equal(scene.layoutPatch.nodes['app/utils.py::make_slug'].x, oldSlugify.x)
  assert.equal(scene.layoutPatch.nodes['app/utils.py::make_slug'].y, oldSlugify.y)

  // deleted app/db.py::close lands in orphans, removed from nodes
  assert.equal(scene.layoutPatch.nodes['app/db.py::close'], null)
  const orphan = scene.layoutPatch.orphans['app/db.py::close']
  assert.ok(orphan)
  assert.equal(orphan.x, layout.nodes['app/db.py::close'].x)
  assert.equal(orphan.y, layout.nodes['app/db.py::close'].y)
  assert.equal(orphan.body, g1.nodes.find(n => n.id === 'app/db.py::close').body)
  assert.equal(orphan.since, 9000)
  assert.ok(!scene.nodes.some(n => n.id === 'app/db.py::close'))

  // chunk is placed near its caller read_file, without overlapping anything
  const readFile = scene.nodes.find(n => n.id === 'app/utils.py::read_file')
  const chunk = scene.nodes.find(n => n.id === 'app/utils.py::chunk')
  assert.ok(chunk)
  assert.ok(readFile)
  const dist = Math.hypot(chunk.x - readFile.x, chunk.y - readFile.y)
  assert.ok(dist < 1000, `chunk placed too far from its caller: ${dist}`)
  assertNoOverlap(scene.nodes)

  // parse_env changed sig -> changed: true
  const parseEnv = scene.nodes.find(n => n.id === 'app/config.py::parse_env')
  assert.equal(parseEnv.changed, true)

  // unrelated saved node not "changed"
  const mainNode = scene.nodes.find(n => n.id === 'app/main.py::main')
  assert.equal(mainNode.changed, false)
})

test('no two nodes overlap on a random 500-node graph (seeded)', () => {
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rand = mulberry32(42)
  const files = Array.from({ length: 25 }, (_, i) => `dir${i % 5}/file${i}.py`)
  const nodes = []
  const edges = []
  for (let i = 0; i < 500; i++) {
    const file = files[Math.floor(rand() * files.length)]
    const qname = `fn${i}`
    nodes.push({
      id: `${file}::${qname}`, name: qname, qname, file, line: 1 + (i % 40),
      kind: 'fn', params: '', returns: '', sig: 'aaaaaaaa', body: 'bbbbbbbb',
    })
  }
  for (let i = 0; i < 500; i++) {
    if (rand() < 0.5) {
      const j = Math.floor(rand() * 500)
      if (j !== i) edges.push({ id: `${nodes[i].id}>${nodes[j].id}`, from: nodes[i].id, to: nodes[j].id, kind: 'call' })
    }
  }
  const graph = { version: 1, root: '/x', builtAt: 0, nodes, edges, errors: [] }
  const scene = merge(graph, emptyLayout(), null, { now: 0 })
  assertNoOverlap(scene.nodes)
  assert.equal(scene.nodes.length, 500)
  assert.equal(scene.total, 500)
})

test('findFreeSpot accepts plain rects and honours side', () => {
  const states = [{ x: 0, y: 0, w: NODE_W, h: NODE_H }]
  const near = { x: 100, y: 28 }
  const right = findFreeSpot(states, NODE_W, NODE_H, near, 50, { side: 'right' })
  assert.ok(right.x >= 0, 'expected a spot at or to the right of near.x baseline')
  assert.ok(!(right.x < 0))

  const left = findFreeSpot(states, NODE_W, NODE_H, near, 50, { side: 'left' })
  assert.ok(left.x <= snap(near.x - NODE_W / 2))

  const below = findFreeSpot(states, NODE_W, NODE_H, { x: 100, y: 100 }, 50, { side: 'below' })
  assert.ok(below.y >= snap(100 - NODE_H / 2))

  // no overlap with the blocking rect
  for (const p of [right, left, below]) {
    const overlap = p.x < states[0].x + states[0].w + NODE_GAP && p.x + NODE_W + NODE_GAP > states[0].x &&
      p.y < states[0].y + states[0].h + NODE_GAP && p.y + NODE_H + NODE_GAP > states[0].y
    assert.ok(!overlap)
  }

  assert.equal(GRID, 25)
})
