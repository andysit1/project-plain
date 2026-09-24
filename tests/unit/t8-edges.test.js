import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CallEdge, LANE_GAP } from '../../frontend/graph/components/transition.js'
import { buildEdges } from '../../frontend/graph/components/th.js'
import { liangBarskyClip, perpendicular } from '../../frontend/graph/components/utils/geometry.js'
import { renderPng, comparePng } from './helpers/t8-snapshot.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP_DIR = join(HERE, 'snapshots')
const SNAP_PATH = join(SNAP_DIR, 't8-lanes.png')

const VIEW = { k: 1, showLabels: true }

function fakeCtx() {
  const calls = []
  return {
    calls,
    beginPath() { calls.push(['beginPath']) },
    moveTo(x, y) { calls.push(['moveTo', x, y]) },
    lineTo(x, y) { calls.push(['lineTo', x, y]) },
    closePath() { calls.push(['closePath']) },
    stroke() { calls.push(['stroke']) },
    fill() { calls.push(['fill']) },
    set lineWidth(v) { calls.push(['lineWidth', v]) },
    set strokeStyle(v) { calls.push(['strokeStyle', v]) },
    set fillStyle(v) { calls.push(['fillStyle', v]) },
  }
}

// ---------------------------------------------------------------- liangBarskyClip

function onBorder(box, p, eps = 1e-6) {
  const onVertical = Math.abs(p.x - box.x) < eps || Math.abs(p.x - box.x + box.w) < eps || Math.abs(p.x - (box.x + box.w)) < eps
  const xOnEdge = Math.abs(p.x - box.x) < eps || Math.abs(p.x - (box.x + box.w)) < eps
  const yOnEdge = Math.abs(p.y - box.y) < eps || Math.abs(p.y - (box.y + box.h)) < eps
  const withinX = p.x >= box.x - eps && p.x <= box.x + box.w + eps
  const withinY = p.y >= box.y - eps && p.y <= box.y + box.h + eps
  return (xOnEdge && withinY) || (yOnEdge && withinX)
}

test('liangBarskyClip: horizontal segment lands on the box border', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 }
  const p = liangBarskyClip(box, 100, 5, 5, 5) // far point -> box center
  assert.ok(onBorder(box, p), `expected ${JSON.stringify(p)} on border`)
  assert.equal(p.x, 10)
  assert.equal(p.y, 5)
})

test('liangBarskyClip: vertical segment lands on the box border', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 }
  const p = liangBarskyClip(box, 5, 100, 5, 5)
  assert.ok(onBorder(box, p))
  assert.equal(p.x, 5)
  assert.equal(p.y, 10)
})

test('liangBarskyClip: diagonal segment lands on the box border', () => {
  const box = { x: 0, y: 0, w: 10, h: 10 }
  const p = liangBarskyClip(box, 100, 100, 5, 5)
  assert.ok(onBorder(box, p), `expected ${JSON.stringify(p)} on border`)
  // Diagonal from (100,100) to (5,5): enters the box on x=10 or y=10 boundary.
  assert.ok(Math.abs(p.x - 10) < 1e-9 || Math.abs(p.y - 10) < 1e-9)
})

test('liangBarskyClip: another diagonal angle also lands on the border', () => {
  const box = { x: 20, y: 40, w: 30, h: 10 }
  const p = liangBarskyClip(box, 0, 0, 35, 45) // far point -> inside the box
  assert.ok(onBorder(box, p), `expected ${JSON.stringify(p)} on border of ${JSON.stringify(box)}`)
})

// ---------------------------------------------------------------- CallEdge basics

function boxesFrom(map) {
  return id => map[id]
}

test('CallEdge.valid() requires both ends to resolve, and rejects self-edges', () => {
  const boxes = { a: { x: 0, y: 0, w: 40, h: 20 }, b: { x: 200, y: 0, w: 40, h: 20 } }
  const boxOf = boxesFrom(boxes)
  const eOk = new CallEdge({ id: 'a>b', from: 'a', to: 'b', kind: 'call' }, boxOf)
  assert.equal(eOk.valid(), true)

  const eMissing = new CallEdge({ id: 'a>c', from: 'a', to: 'c', kind: 'call' }, boxOf)
  assert.equal(eMissing.valid(), false)

  const eSelf = new CallEdge({ id: 'a>a', from: 'a', to: 'a', kind: 'call' }, boxOf)
  assert.equal(eSelf.valid(), false)
})

test('CallEdge.draw() does not throw and returns silently when invalid', () => {
  const boxOf = boxesFrom({ a: { x: 0, y: 0, w: 40, h: 20 } }) // 'b' missing
  const e = new CallEdge({ id: 'a>b', from: 'a', to: 'b', kind: 'call' }, boxOf)
  const ctx = fakeCtx()
  assert.doesNotThrow(() => e.draw(ctx, VIEW))
  assert.equal(ctx.calls.length, 0)
})

test('CallEdge.bounds() is the empty rect when invalid', () => {
  const boxOf = boxesFrom({ a: { x: 0, y: 0, w: 40, h: 20 } })
  const e = new CallEdge({ id: 'a>b', from: 'a', to: 'b', kind: 'call' }, boxOf)
  assert.deepEqual(e.bounds(), { x: 0, y: 0, w: 0, h: 0 })
})

test('CallEdge re-resolves boxOf at draw/bounds time: a node that disappears after construction is skipped without throwing', () => {
  const boxes = { a: { x: 0, y: 0, w: 40, h: 20 }, b: { x: 200, y: 0, w: 40, h: 20 } }
  const boxOf = id => boxes[id]
  const e = new CallEdge({ id: 'a>b', from: 'a', to: 'b', kind: 'call' }, boxOf)
  assert.equal(e.valid(), true)
  assert.doesNotThrow(() => e.draw(fakeCtx(), VIEW))

  delete boxes.b // node b was removed (e.g. deleted / filtered out)

  assert.equal(e.valid(), false)
  const ctx = fakeCtx()
  assert.doesNotThrow(() => e.draw(ctx, VIEW))
  assert.equal(ctx.calls.length, 0)
  assert.deepEqual(e.bounds(), { x: 0, y: 0, w: 0, h: 0 })
})

test('CallEdge.bounds() contains both clipped endpoints', () => {
  const boxes = { a: { x: 0, y: 0, w: 40, h: 20 }, b: { x: 200, y: 50, w: 40, h: 20 } }
  const boxOf = boxesFrom(boxes)
  const e = new CallEdge({ id: 'a>b', from: 'a', to: 'b', kind: 'call' }, boxOf)
  const b = e.bounds()

  // Recompute the same clipped endpoints independently to check containment.
  const centerA = { x: 20, y: 10 }
  const centerB = { x: 220, y: 60 }
  const start = liangBarskyClip(boxes.a, centerB.x, centerB.y, centerA.x, centerA.y)
  const end = liangBarskyClip(boxes.b, centerA.x, centerA.y, centerB.x, centerB.y)

  for (const p of [start, end]) {
    assert.ok(p.x >= b.x - 1e-6 && p.x <= b.x + b.w + 1e-6, `x=${p.x} not within bounds ${JSON.stringify(b)}`)
    assert.ok(p.y >= b.y - 1e-6 && p.y <= b.y + b.h + 1e-6, `y=${p.y} not within bounds ${JSON.stringify(b)}`)
  }
})

// ---------------------------------------------------------------- buildEdges / lanes

test('buildEdges skips edges with a missing end, and self-edges, without throwing', () => {
  const boxes = { a: { x: 0, y: 0, w: 40, h: 20 }, b: { x: 200, y: 0, w: 40, h: 20 } }
  const boxOf = boxesFrom(boxes)
  const edges = [
    { id: 'a>b', from: 'a', to: 'b', kind: 'call' },
    { id: 'a>missing', from: 'a', to: 'missing', kind: 'call' },
    { id: 'missing>a', from: 'missing', to: 'a', kind: 'call' },
    { id: 'a>a', from: 'a', to: 'a', kind: 'call' },
  ]
  let result
  assert.doesNotThrow(() => { result = buildEdges(edges, boxOf) })
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'a>b')
})

test('buildEdges assigns opposite lanes to a bidirectional pair, and lane 0 otherwise', () => {
  const boxes = {
    a: { x: 0, y: 0, w: 40, h: 20 },
    b: { x: 200, y: 0, w: 40, h: 20 },
    c: { x: 0, y: 200, w: 40, h: 20 },
  }
  const boxOf = boxesFrom(boxes)
  const edges = [
    { id: 'a>b', from: 'a', to: 'b', kind: 'call' },
    { id: 'b>a', from: 'b', to: 'a', kind: 'call' },
    { id: 'a>c', from: 'a', to: 'c', kind: 'call' }, // unidirectional
  ]
  const result = buildEdges(edges, boxOf)
  assert.equal(result.length, 3)

  const ab = result.find(e => e.id === 'a>b')
  const ba = result.find(e => e.id === 'b>a')
  const ac = result.find(e => e.id === 'a>c')

  assert.notEqual(ab.lane, 0)
  assert.notEqual(ba.lane, 0)
  assert.equal(ab.lane, -ba.lane)
  assert.equal(ac.lane, 0)
})

test('A->B and B->A draw as two parallel lanes, separated by 2*LANE_GAP, that do not intersect', () => {
  const boxes = { a: { x: 0, y: 0, w: 40, h: 20 }, b: { x: 200, y: 0, w: 40, h: 20 } }
  const boxOf = boxesFrom(boxes)
  const edges = [
    { id: 'a>b', from: 'a', to: 'b', kind: 'call' },
    { id: 'b>a', from: 'b', to: 'a', kind: 'call' },
  ]
  const [e1, e2] = buildEdges(edges, boxOf)
  const g1 = e1._geometry()
  const g2 = e2._geometry()

  // Both segments run along the same (horizontal) axis, offset vertically.
  const dir1 = { x: g1.end.x - g1.start.x, y: g1.end.y - g1.start.y }
  const dir2 = { x: g2.end.x - g2.start.x, y: g2.end.y - g2.start.y }
  const cross = dir1.x * dir2.y - dir1.y * dir2.x
  assert.ok(Math.abs(cross) < 1e-6, `expected parallel segments, cross=${cross}`)

  // Perpendicular separation between the two (parallel) lines.
  const mag1 = Math.hypot(dir1.x, dir1.y)
  const normal = { x: -dir1.y / mag1, y: dir1.x / mag1 }
  const sep = Math.abs((g2.start.x - g1.start.x) * normal.x + (g2.start.y - g1.start.y) * normal.y)
  assert.ok(Math.abs(sep - 2 * LANE_GAP) < 1e-6, `expected separation ${2 * LANE_GAP}, got ${sep}`)

  // They must not intersect: for parallel, non-collinear segments this holds
  // as long as they are actually offset (sep > 0), which we already checked.
  assert.ok(sep > 0)
})

// ---------------------------------------------------------------- snapshot

test('snapshot: two-lane A<->B render matches tests/unit/snapshots/t8-lanes.png', async () => {
  const boxes = { a: { x: 20, y: 60, w: 60, h: 30 }, b: { x: 220, y: 60, w: 60, h: 30 } }
  const boxOf = boxesFrom(boxes)
  const edges = [
    { id: 'a>b', from: 'a', to: 'b', kind: 'call' },
    { id: 'b>a', from: 'b', to: 'a', kind: 'call' },
  ]
  const callEdges = buildEdges(edges, boxOf)

  const actual = renderPng(300, 150, ctx => {
    for (const e of callEdges) e.draw(ctx, VIEW)
  })

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true })
    writeFileSync(SNAP_PATH, actual)
    return
  }

  assert.ok(existsSync(SNAP_PATH), `missing snapshot at ${SNAP_PATH}; run with UPDATE_SNAPSHOTS=1 to create it`)
  const expected = readFileSync(SNAP_PATH)
  const { equal, diffCount, maxDiff, totalPixels } = await comparePng(actual, expected)
  assert.ok(equal, `snapshot mismatch: ${diffCount}/${totalPixels} pixels differ (maxDiff=${maxDiff})`)
})
