import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NODE_W, NODE_H } from '../../shared/contracts.js'
import { flowLayout } from '../../frontend/graph/utils/flow.js'
import { merge } from '../../frontend/graph/components/merge.js'
import { buildEdges } from '../../frontend/graph/components/th.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fx = name => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))
const box = p => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H })
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('flow layout: callers sit left of callees, entry point in the first column', () => {
  const g = fx('graph.small.json')
  const pos = flowLayout(g)
  assert.equal(pos.size, g.nodes.length)
  assert.equal(pos.get('app/main.py::main').x, 0)
  // every forward call goes left -> right (the only exception is a cycle's back edge)
  const back = g.edges.filter(e => pos.get(e.from).x >= pos.get(e.to).x)
  assert.ok(back.length <= 1, `edges not flowing right: ${back.map(e => e.id)}`)
  const boxes = [...pos.values()].map(box)
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => assert.ok(!hit(a, b), 'nodes overlap')))
})

test('flow layout is deterministic', () => {
  const g = fx('graph.small.json')
  assert.deepEqual([...flowLayout(g)], [...flowLayout(g)])
})

test('routed edges never pass through a node and never lie on top of each other', () => {
  const scene = merge(fx('graph.small.json'), { version: 1, nodes: {}, groups: {}, orphans: {} })
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const boxOf = id => byId.get(id) && box(byId.get(id))
  const edges = buildEdges(scene.edges, boxOf, { obstacles: () => scene.nodes.map(box) })
  const segs = []
  for (const e of edges) {
    const pts = e._route()
    assert.ok(pts && pts.length >= 2, `no route for ${e.id}`)
    const a = boxOf(e.data.from), b = boxOf(e.data.to)
    assert.equal(pts[0].x, a.x + a.w, `${e.id} leaves from the caller's right side`)
    assert.equal(pts.at(-1).x, b.x, `${e.id} enters the callee's left side`)
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1]
      assert.ok(p.x === q.x || p.y === q.y, `${e.id} segment ${i} is not orthogonal`)
      const s = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y), e: e.id }
      for (const n of scene.nodes) {
        const nb = box(n)
        const inner = { x: nb.x + 1, y: nb.y + 1, w: nb.w - 2, h: nb.h - 2 }
        assert.ok(!hit({ ...s, w: s.w || 0.1, h: s.h || 0.1 }, inner), `${e.id} passes through ${n.id}`)
      }
      segs.push(s)
    }
  }
  // collinear overlap between two different edges' segments
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j]
    if (s.e === t.e) continue
    const sameV = s.w === 0 && t.w === 0 && s.x === t.x && s.y < t.y + t.h && t.y < s.y + s.h
    const sameH = s.h === 0 && t.h === 0 && s.y === t.y && s.x < t.x + t.w && t.x < s.x + s.w
    assert.ok(!sameV && !sameH, `${s.e} and ${t.e} overlap`)
  }
})

test('merge above the ceiling is fast (no placement search)', () => {
  const t = Date.now()
  const scene = merge(fx('graph.large.json'), { version: 1, nodes: {}, groups: {}, orphans: {} })
  assert.equal(scene.nodes.length, 6000)
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`)
})
