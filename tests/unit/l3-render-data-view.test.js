// L3 renderer: buildDataScene over the classes fixture (frame + schema views), node overlap,
// structure unrolling, loop cursors, and drawing every scene to a @napi-rs/canvas context.
// PNGs land in test-results/l3/ for eyeballing (not asserted).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDataScene } from '../../frontend/graph/components/data_view.js'
import { renderScene, savePng } from './helpers/l3-render-canvas.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const graph = JSON.parse(readFileSync(join(HERE, '..', '..', 'shared', 'fixtures', 'graph.classes.json'), 'utf8'))
const F = 'app/structures.py::'

const frameIds = Object.keys(graph.frames)
const classIds = graph.classes.map(c => c.id)
const titles = (scene, t) => scene.nodes.filter(n => n.data.title === t)
const glyphs = (scene, g) => scene.nodes.filter(n => n.data.glyph === g)
const edgesOf = (scene, kind) => scene.edges.filter(e => e.data.kind === kind)
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

function scene(id) {
  const s = buildDataScene(graph, id)
  assert.ok(s, `scene for ${id}`)
  return s
}

test('returns a scene for every frame and every class', () => {
  assert.ok(frameIds.length >= 4)
  for (const id of [...frameIds, ...classIds]) {
    const s = scene(id)
    assert.ok(Array.isArray(s.groups) && Array.isArray(s.edges) && Array.isArray(s.nodes))
    assert.ok(s.nodes.length >= 1, id)
  }
})

test('returns null for unknown ids and functions without a frame', () => {
  assert.equal(buildDataScene(graph, 'nope::nothing'), null)
  assert.equal(buildDataScene(graph, `${F}make_list`), null)
  assert.equal(buildDataScene(null, `${F}grid`), null)
  assert.equal(buildDataScene({ ...graph, frames: undefined, classes: undefined }, `${F}grid`), null)
})

test('node drawables satisfy the graph.js node interface', () => {
  for (const id of [...frameIds, ...classIds]) {
    const s = scene(id)
    const ids = new Set()
    for (const n of s.nodes) {
      assert.equal(typeof n.id, 'string')
      assert.ok(!ids.has(n.id), `duplicate id ${n.id}`)
      ids.add(n.id)
      assert.equal(n.selected, false)
      const b = n.bounds()
      assert.deepEqual(b, { x: n.data.x, y: n.data.y, w: n.data.w, h: n.data.h })
      assert.ok(n.hitTest(b.x + 1, b.y + 1))
      assert.ok(!n.hitTest(b.x - 1, b.y - 1))
      n.moveTo(b.x + 25, b.y + 50)
      assert.equal(n.data.x, b.x + 25)
      n.moveTo(b.x, b.y)
    }
    for (const e of s.edges) {
      assert.equal(typeof e.id, 'string')
      assert.ok(ids.has(e.data.from) && ids.has(e.data.to), `${e.id} endpoints resolve`)
      const b = e.bounds()
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.w))
    }
  }
})

test('no two node boxes overlap', () => {
  for (const id of [...frameIds, ...classIds]) {
    const nodes = scene(id).nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].bounds(), b = nodes[j].bounds()
        assert.ok(!overlap(a, b), `${id}: ${nodes[i].data.title} overlaps ${nodes[j].data.title}`)
      }
    }
  }
})

test('linked_sum: frame rows, a 3-box ListNode chain + ellipsis, traversal arrow', () => {
  const s = scene(`${F}linked_sum`)
  const frame = s.nodes[0]
  assert.equal(frame.data.glyph, 'frame')
  assert.equal(frame.data.title, 'linked_sum()')
  const rows = frame.data.entries.filter(e => !e.section).map(e => e.label)
  assert.deepEqual(rows, ['head', 'total', 'node'])
  const total = frame.data.entries.find(e => e.label === 'total')
  assert.equal(total.ref, false)
  assert.equal(total.type, 'int')
  assert.equal(titles(s, 'ListNode').length, 3)
  assert.ok(glyphs(s, 'ellipsis').length >= 1)
  const trav = edgesOf(s, 'traversal')
  assert.equal(trav.length, 1)
  assert.equal(trav[0].data.chain.length, 3)
  assert.match(trav[0].data.label, /node/)
  // `node` aliases the chain drawn for `head` instead of drawing a second chain
  assert.equal(edgesOf(s, 'alias').length, 1)
  // chain boxes sit in successive columns, left to right
  const xs = titles(s, 'ListNode').map(n => n.data.x)
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2])
})

test('grid: a nested list with two cursors (row and column)', () => {
  const s = scene(`${F}grid`)
  const lists = glyphs(s, 'list')
  const outer = lists.find(b => b.data.elem === 'of list[int]')
  assert.ok(outer, 'rows box')
  const inner = s.edges.filter(e => e.data.from === outer.id && e.data.kind === 'pointer')
  assert.equal(inner.length, 3, 'every cell of rows points at a row list')
  const cursors = edgesOf(s, 'cursor')
  assert.equal(cursors.length, 2)
  const targets = cursors.map(c => c.data.to)
  assert.ok(targets.includes(outer.id))
  assert.ok(targets.some(t => t !== outer.id && inner.some(e => e.data.to === t)))
  assert.deepEqual(cursors.map(c => c.data.label.split(' ')[0]).sort(), ['i', 'j'])
  // n is unknown: an inline ? in its row
  assert.equal(s.nodes[0].data.entries.find(e => e.label === 'n').inline, '?')
})

test('count_words: a dict table, a cursor over lines, a chip for line.split()', () => {
  const s = scene(`${F}count_words`)
  const dict = glyphs(s, 'dict')
  assert.equal(dict.length, 1)
  const row = dict[0].data.entries.find(e => !e.more)
  assert.equal(row.left, 'str')
  assert.equal(row.right, 'int')
  const cursors = edgesOf(s, 'cursor')
  assert.equal(cursors.length, 1)
  assert.equal(s.nodes.find(n => n.id === cursors[0].data.to).data.glyph, 'list')
  assert.ok(s.nodes[0].data.chips.some(c => /for word in line\.split\(\)/.test(c)))
})

test('Registry.add: self fields drawn with their heap boxes', () => {
  const s = scene(`${F}Registry.add`)
  const frame = s.nodes[0]
  const selfRows = frame.data.entries.filter(e => /^self\./.test(e.label || ''))
  assert.deepEqual(selfRows.map(e => e.label), ['self.items', 'self.by_name', 'self.tags'])
  assert.ok(frame.data.entries.some(e => e.section === 'self'))
  for (const r of selfRows) {
    assert.ok(s.edges.some(e => e.data.from === frame.id && e.data.port === r.key), `${r.label} points into the heap`)
  }
  assert.ok(glyphs(s, 'set').length >= 1)
  assert.ok(glyphs(s, 'dict').length >= 1)
  assert.ok(titles(s, 'Square').length >= 1)
  assert.ok(titles(s, 'Point').length >= 1)
})

test('TreeNode schema: a two-level binary tree', () => {
  const s = scene(`${F}TreeNode`)
  const root = s.nodes[0]
  assert.equal(root.data.glyph, 'class')
  assert.match(root.data.title, /TreeNode/)
  const kids = s.edges.filter(e => e.data.from === root.id)
  assert.equal(kids.length, 2)
  assert.equal(new Set(kids.map(e => e.data.to)).size, 2)
  assert.equal(titles(s, 'TreeNode').length, 6)
  // leaves end in … instead of recursing forever
  const leaf = s.nodes.find(n => n.id === s.edges.find(e => e.data.from === kids[0].data.to).data.to)
  assert.ok(leaf.data.entries.some(e => e.type === '…'))
})

test('other structures: doubly linked list back arrows, graph ring', () => {
  const d = scene(`${F}DNode`)
  assert.ok(edgesOf(d, 'back').length >= 2)
  const g = scene(`${F}GraphNode`)
  assert.equal(titles(g, 'GraphNode').length, 4)
  assert.equal(edgesOf(g, 'link').length, 4)
  assert.equal(edgesOf(g, 'cross').length, 2)
})

test('self-referencing shapes never loop forever', () => {
  const cls = 'x.py::Loop'
  const g = {
    nodes: [], classes: [
      { id: cls, name: 'Loop', fields: [{ name: 'me', shape: { k: 'obj', cls } }, { name: 'many', shape: { k: 'list', of: { k: 'obj', cls } } }] },
      { id: 'x.py::A', name: 'A', fields: [{ name: 'b', shape: { k: 'obj', cls: 'x.py::B' } }] },
      { id: 'x.py::B', name: 'B', fields: [{ name: 'a', shape: { k: 'obj', cls: 'x.py::A' } }] },
    ],
    frames: { 'x.py::f': { vars: [{ name: 'l', scope: 'local', line: 1, shape: { k: 'obj', cls }, src: 'ctor' }, { name: 'a', scope: 'local', line: 2, shape: { k: 'obj', cls: 'x.py::A' }, src: 'ctor' }], loops: [] } },
  }
  const s = buildDataScene(g, 'x.py::f')
  assert.ok(s.nodes.length < 20)
  assert.ok(buildDataScene(g, cls).nodes.length < 20)
})

test('glyph details: known len, tuple, record, optional, unknown', () => {
  const g = {
    nodes: [], classes: [],
    frames: { 'x.py::f': { loops: [{ kind: 'for', line: 3, var: 'p', over: 'pairs', step: '' }], vars: [
      { name: 'pairs', scope: 'param', line: 1, shape: { k: 'list', len: 2, of: { k: 'tuple', len: 2, of: { k: 'prim', t: 'int' } } }, src: 'runtime' },
      { name: 'conf', scope: 'global', line: 1, shape: { k: 'record', fields: { url: { k: 'prim', t: 'str' }, open: { k: 'prim', t: 'bool' } } }, src: 'literal' },
      { name: 'maybe', scope: 'local', line: 2, shape: { k: 'union', of: [{ k: 'list', of: { k: 'unknown' } }, { k: 'prim', t: 'none' }] }, src: 'mutation' },
    ] } },
  }
  const s = buildDataScene(g, 'x.py::f')
  const outer = s.nodes.find(n => n.data.glyph === 'list' && n.data.elem === 'of tuple[int]')
  assert.equal(outer.data.cells.length, 2, 'exact cells when len is known')
  assert.equal(glyphs(s, 'tuple').length, 2)
  assert.equal(glyphs(s, 'record')[0].data.entries.length, 2)
  const opt = s.nodes.find(n => n.data.optional)
  assert.equal(opt.data.glyph, 'list')
  assert.equal(opt.data.cells.length, 4, '3 cells + … when len is unknown')
  assert.equal(edgesOf(s, 'cursor').length, 1)
  assert.ok(s.nodes[0].data.entries.some(e => e.section === 'globals'))
  savePng(renderScene(s), 'glyphs')
})

test('every scene draws to a canvas without throwing (PNGs in test-results/l3/)', () => {
  const names = {}
  for (const id of [...frameIds, ...classIds]) names[id] = (frameIds.includes(id) ? 'frame-' : 'class-') + id.split('::').pop().replace(/[^\w.-]/g, '_')
  for (const [id, name] of Object.entries(names)) {
    const s = scene(id)
    s.nodes[0].selected = true
    if (s.edges[0]) s.edges[0].highlight = true
    const canvas = renderScene(s)
    assert.ok(canvas.width > 50 && canvas.height > 30)
    savePng(canvas, name)
    // zoomed out: labels hidden, still draws
    renderScene(s, { scale: 0.3, showLabels: false })
  }
})

test('drawing respects a dimmed globalAlpha set by graph.js and restores ctx state', async () => {
  const { createCanvas } = await import('@napi-rs/canvas')
  const ctx = createCanvas(400, 300).getContext('2d')
  const s = scene(`${F}grid`)
  for (const d of [...s.edges, ...s.nodes]) {
    ctx.globalAlpha = 0.3
    d.draw(ctx, { k: 1, showLabels: true })
    assert.ok(Math.abs(ctx.globalAlpha - 0.3) < 0.01, `${d.id} restores globalAlpha`)
  }
  ctx.globalAlpha = 1
})
