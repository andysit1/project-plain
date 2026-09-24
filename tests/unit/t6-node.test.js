import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

import { CodeNode, KIND_COLORS, NODE_PADDING } from '../../frontend/graph/components/node.js'
import { NODE_W, NODE_H, RING_MS } from '../../shared/contracts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAP_DIR = path.join(__dirname, 'snapshots')

const CANVAS_W = NODE_W + 40
const CANVAS_H = NODE_H + 40
const ORIGIN_X = 10
const ORIGIN_Y = 10
const BG = '#1e1e1e'
const PIXEL_TOLERANCE = 28
const MISMATCH_RATIO = 0.03

function makeSceneNode(overrides = {}) {
  return {
    id: 'app/main.py::load_config',
    name: 'load_config',
    qname: 'load_config',
    file: 'app/main.py',
    line: 10,
    kind: 'fn',
    params: 'path, strict=False',
    returns: 'Config',
    sig: 'aaaaaaaa',
    body: 'bbbbbbbb',
    x: ORIGIN_X, y: ORIGIN_Y, w: NODE_W, h: NODE_H,
    changed: false,
    ...overrides,
  }
}

function renderNode(node, view) {
  const canvas = createCanvas(CANVAS_W, CANVAS_H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  node.draw(ctx, view)
  return canvas
}

async function assertSnapshot(canvas, name) {
  const file = path.join(SNAP_DIR, `t6-${name}.png`)
  const buf = await canvas.encode('png')

  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.mkdirSync(SNAP_DIR, { recursive: true })
    fs.writeFileSync(file, buf)
    return
  }

  assert.ok(fs.existsSync(file), `missing snapshot ${file}; run with UPDATE_SNAPSHOTS=1 to create it`)

  const expectedImg = await loadImage(file)
  const expectedCanvas = createCanvas(CANVAS_W, CANVAS_H)
  const ectx = expectedCanvas.getContext('2d')
  ectx.drawImage(expectedImg, 0, 0)
  const expected = ectx.getImageData(0, 0, CANVAS_W, CANVAS_H).data

  const actual = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data
  assert.equal(actual.length, expected.length, 'image dimensions differ from stored snapshot')

  let mismatches = 0
  for (let i = 0; i < actual.length; i += 4) {
    const dr = Math.abs(actual[i] - expected[i])
    const dg = Math.abs(actual[i + 1] - expected[i + 1])
    const db = Math.abs(actual[i + 2] - expected[i + 2])
    const da = Math.abs(actual[i + 3] - expected[i + 3])
    if (dr > PIXEL_TOLERANCE || dg > PIXEL_TOLERANCE || db > PIXEL_TOLERANCE || da > PIXEL_TOLERANCE) mismatches++
  }
  const total = actual.length / 4
  const ratio = mismatches / total
  assert.ok(ratio < MISMATCH_RATIO, `${name}: ${mismatches}/${total} pixels differ (${(ratio * 100).toFixed(2)}%), exceeds tolerance`)
}

// -------------------------------------------------------------- snapshots

describe('CodeNode snapshots', () => {
  for (const kind of Object.keys(KIND_COLORS)) {
    test(`draws a ${kind} node`, async () => {
      const node = new CodeNode(makeSceneNode({ kind, name: `${kind}Example`, id: `x::${kind}Example` }))
      const canvas = renderNode(node, { k: 1, showLabels: true })
      await assertSnapshot(canvas, `kind-${kind}`)
    })
  }

  test('draws without text when labels are hidden', async () => {
    const node = new CodeNode(makeSceneNode())
    const canvas = renderNode(node, { k: 0.1, showLabels: false })
    await assertSnapshot(canvas, 'labels-hidden')
  })

  test('draws a fading change ring', async () => {
    const clock = { t: 1000 }
    const node = new CodeNode(makeSceneNode({ changed: true }), { now: () => clock.t })
    clock.t = 1000 + RING_MS / 2
    const canvas = renderNode(node, { k: 1, showLabels: true })
    await assertSnapshot(canvas, 'change-ring')
  })

  test('draws a selection outline', async () => {
    const node = new CodeNode(makeSceneNode())
    node.selected = true
    const canvas = renderNode(node, { k: 1, showLabels: true })
    await assertSnapshot(canvas, 'selected')
  })
})

// -------------------------------------------------------------- geometry

describe('CodeNode geometry', () => {
  test('hitTest is true only inside the box', () => {
    const node = new CodeNode(makeSceneNode())
    assert.equal(node.hitTest(ORIGIN_X + 1, ORIGIN_Y + 1), true)
    assert.equal(node.hitTest(ORIGIN_X + NODE_W / 2, ORIGIN_Y + NODE_H / 2), true)
    assert.equal(node.hitTest(ORIGIN_X - 1, ORIGIN_Y + 1), false)
    assert.equal(node.hitTest(ORIGIN_X + NODE_W, ORIGIN_Y + 1), false)
    assert.equal(node.hitTest(ORIGIN_X + 1, ORIGIN_Y + NODE_H), false)
  })

  test('bounds covers the box plus ring/selection margin', () => {
    const node = new CodeNode(makeSceneNode())
    const b = node.bounds()
    assert.ok(b.x <= ORIGIN_X)
    assert.ok(b.y <= ORIGIN_Y)
    assert.ok(b.x + b.w >= ORIGIN_X + NODE_W)
    assert.ok(b.y + b.h >= ORIGIN_Y + NODE_H)
  })

  test('moveTo updates the underlying SceneNode position', () => {
    const sceneNode = makeSceneNode()
    const node = new CodeNode(sceneNode)
    node.moveTo(123, 456)
    assert.equal(sceneNode.x, 123)
    assert.equal(sceneNode.y, 456)
    assert.equal(node.data.x, 123)
    assert.equal(node.data.y, 456)
  })
})

// -------------------------------------------------------------- animation clock

describe('CodeNode.isAnimating', () => {
  test('is false when the node has not changed', () => {
    const node = new CodeNode(makeSceneNode({ changed: false }))
    assert.equal(node.isAnimating(0), false)
    assert.equal(node.isAnimating(1e9), false)
  })

  test('is true for RING_MS after construction, then false', () => {
    const clock = { t: 5000 }
    const node = new CodeNode(makeSceneNode({ changed: true }), { now: () => clock.t })

    assert.equal(node.isAnimating(5000), true)
    assert.equal(node.isAnimating(5000 + RING_MS - 1), true)
    assert.equal(node.isAnimating(5000 + RING_MS), false)
    assert.equal(node.isAnimating(5000 + RING_MS + 500), false)
  })

  test('defaults to its injected clock when no time is passed', () => {
    const clock = { t: 5000 }
    const node = new CodeNode(makeSceneNode({ changed: true }), { now: () => clock.t })
    assert.equal(node.isAnimating(), true)
    clock.t = 5000 + RING_MS + 1
    assert.equal(node.isAnimating(), false)
  })
})

// -------------------------------------------------------------- text fitting

describe('CodeNode text fitting', () => {
  function recordingCtx(realCtx) {
    const calls = []
    const proxy = new Proxy(realCtx, {
      get(target, prop) {
        if (prop === 'fillText') {
          return (text, x, y, ...rest) => {
            calls.push({ text, x, y, font: target.font })
            return target.fillText(text, x, y, ...rest)
          }
        }
        const val = target[prop]
        return typeof val === 'function' ? val.bind(target) : val
      },
      set(target, prop, value) {
        target[prop] = value
        return true
      },
    })
    return { ctx: proxy, calls }
  }

  test('a 300-character signature stays inside the box', () => {
    const longParams = Array.from({ length: 300 }, (_, i) => 'a' + (i % 10)).join('').slice(0, 300)
    const sceneNode = makeSceneNode({ name: 'reallyLongFunctionNameThatKeepsGoing', params: longParams, returns: 'SomeVeryLongReturnTypeName' })
    const node = new CodeNode(sceneNode)

    const canvas = createCanvas(CANVAS_W, CANVAS_H)
    const realCtx = canvas.getContext('2d')
    const { ctx, calls } = recordingCtx(realCtx)

    node.draw(ctx, { k: 1, showLabels: true })

    assert.ok(calls.length >= 2, 'expected both text lines to be drawn')

    const left = sceneNode.x + NODE_PADDING
    const right = sceneNode.x + sceneNode.w - NODE_PADDING
    const EPS = 0.5

    for (const call of calls) {
      realCtx.font = call.font
      const width = realCtx.measureText(call.text).width
      const textLeft = call.x - width / 2
      const textRight = call.x + width / 2
      assert.ok(textLeft >= left - EPS, `"${call.text}" left edge ${textLeft} is before box padding ${left}`)
      assert.ok(textRight <= right + EPS, `"${call.text}" right edge ${textRight} is past box padding ${right}`)
    }
  })

  test('short signatures are not truncated', () => {
    const sceneNode = makeSceneNode({ name: 'short', params: 'a', returns: '' })
    const node = new CodeNode(sceneNode)
    const canvas = createCanvas(CANVAS_W, CANVAS_H)
    const realCtx = canvas.getContext('2d')
    const { ctx, calls } = recordingCtx(realCtx)

    node.draw(ctx, { k: 1, showLabels: true })

    assert.equal(calls[0].text, 'short')
    assert.equal(calls[1].text, 'short(a)')
  })

  test('omits the arrow when returns is empty', () => {
    const sceneNode = makeSceneNode({ name: 'noReturn', params: 'x', returns: '' })
    const node = new CodeNode(sceneNode)
    const canvas = createCanvas(CANVAS_W, CANVAS_H)
    const realCtx = canvas.getContext('2d')
    const { ctx, calls } = recordingCtx(realCtx)

    node.draw(ctx, { k: 1, showLabels: true })

    assert.ok(!calls[1].text.includes('->'))
  })

  test('draws no text when showLabels is false', () => {
    const sceneNode = makeSceneNode()
    const node = new CodeNode(sceneNode)
    const canvas = createCanvas(CANVAS_W, CANVAS_H)
    const realCtx = canvas.getContext('2d')
    const { ctx, calls } = recordingCtx(realCtx)

    node.draw(ctx, { k: 0.1, showLabels: false })

    assert.equal(calls.length, 0)
  })
})
