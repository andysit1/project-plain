import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { FolderGroup } from '../../frontend/graph/components/group.js'
import { compareSnapshot } from './helpers/t7-snapshot.js'

const WIDTH = 320
const HEIGHT = 220

function makeCanvas () {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  return { canvas, ctx }
}

const NORMAL_DATA = { id: 'src/components', title: 'src/components', x: 20, y: 20, w: 260, h: 160 }
const LONG_TITLE_DATA = {
  id: 'src/very/long',
  title: 'this/is/a/very/long/directory/path/that/should/be/truncated/with/an/ellipsis',
  x: 20, y: 20, w: 260, h: 160,
}

test('bounds() matches the group rect exactly', () => {
  const group = new FolderGroup(NORMAL_DATA)
  assert.deepEqual(group.bounds(), { x: 20, y: 20, w: 260, h: 160 })
  assert.equal(group.id, 'src/components')
  assert.equal(group.data, NORMAL_DATA)
})

test('snapshot: normal group box with title', async () => {
  const { canvas, ctx } = makeCanvas()
  const group = new FolderGroup(NORMAL_DATA)
  group.draw(ctx, { k: 1, showLabels: true })
  await compareSnapshot(canvas, 'group-normal')
})

test('snapshot: long title is truncated to the box width', async () => {
  const { canvas, ctx } = makeCanvas()
  const group = new FolderGroup(LONG_TITLE_DATA)
  group.draw(ctx, { k: 1, showLabels: true })
  await compareSnapshot(canvas, 'group-long-title')
})

test('snapshot: labels hidden when view.showLabels is false', async () => {
  const { canvas, ctx } = makeCanvas()
  const group = new FolderGroup(NORMAL_DATA)
  group.draw(ctx, { k: 1, showLabels: false })
  await compareSnapshot(canvas, 'group-labels-hidden')
})

// A minimal recording ctx: enough surface for FolderGroup.draw() to run, with a
// deterministic fixed-width measureText so we can assert the drawn title text
// (position + measured width) stays inside the group's box.
function makeRecordingCtx () {
  const calls = { fillText: [], strokeLineWidths: [] }
  const ctx = {
    fillStyle: null,
    strokeStyle: null,
    lineWidth: null,
    font: null,
    textAlign: null,
    textBaseline: null,
    beginPath () {},
    moveTo () {},
    lineTo () {},
    quadraticCurveTo () {},
    closePath () {},
    fill () {},
    stroke () { calls.strokeLineWidths.push(ctx.lineWidth) },
    measureText (text) { return { width: text.length * 6 } },
    fillText (text, x, y) { calls.fillText.push({ text, x, y, width: text.length * 6 }) },
  }
  return { ctx, calls }
}

test('recording ctx: title text stays inside the box', () => {
  const { ctx, calls } = makeRecordingCtx()
  const group = new FolderGroup(LONG_TITLE_DATA)
  group.draw(ctx, { k: 1, showLabels: true })

  assert.equal(calls.fillText.length, 1)
  const { text, x, y, width } = calls.fillText[0]
  assert.ok(text.endsWith('…'), 'long title should be truncated with an ellipsis')
  assert.ok(text.length < LONG_TITLE_DATA.title.length, 'truncated text should be shorter than the original')

  const { x: bx, y: by, w: bw, h: bh } = LONG_TITLE_DATA
  assert.ok(x >= bx, 'title x should start inside the box')
  assert.ok(y >= by, 'title y should start inside the box')
  assert.ok(x + width <= bx + bw, 'title text should not overflow the box width')
  assert.ok(y <= by + bh, 'title y should be inside the box height')
})

test('recording ctx: border lineWidth stays visually constant across zoom (1 / view.k)', () => {
  for (const k of [0.5, 1, 2, 4]) {
    const { ctx, calls } = makeRecordingCtx()
    const group = new FolderGroup(NORMAL_DATA)
    group.draw(ctx, { k, showLabels: true })
    assert.equal(calls.strokeLineWidths[0], 1 / k)
  }
})

test('recording ctx: no title is drawn when view.showLabels is false', () => {
  const { ctx, calls } = makeRecordingCtx()
  const group = new FolderGroup(NORMAL_DATA)
  group.draw(ctx, { k: 1, showLabels: false })
  assert.equal(calls.fillText.length, 0)
})
