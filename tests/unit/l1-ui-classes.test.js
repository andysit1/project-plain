// L1 classes layer: buildClassScene on the classes fixture, ClassNode sizing/drawing and
// ClassEdge styling, drawn for real on @napi-rs/canvas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { emptyLayout, NODE_W, NODE_H, LABEL_MIN_ZOOM, validateLayoutPatch } from '../../shared/contracts.js'
import { buildClassScene } from '../../frontend/graph/components/classes.js'
import { ClassNode, classBoxHeight, MAX_ROWS, ROW_H } from '../../frontend/graph/components/class_node.js'
import { ClassEdge, buildClassEdges, CLASS_EDGE_STYLES } from '../../frontend/graph/components/class_edge.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', 'graph.classes.json'), 'utf8'))

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// ---------------------------------------------------------------- buildClassScene

test('buildClassScene places every class once, without overlaps', () => {
  const g = fixture()
  const scene = buildClassScene(g, emptyLayout())
  assert.equal(scene.mode, 'classes')
  assert.equal(scene.total, g.classes.length)
  assert.deepEqual(scene.nodes.map(n => n.id).sort(), g.classes.map(c => c.id).sort())
  for (const n of scene.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} has a position`)
    assert.equal(n.w, NODE_W)
    assert.ok(n.h >= NODE_H)
  }
  for (let i = 0; i < scene.nodes.length; i++) {
    for (let j = i + 1; j < scene.nodes.length; j++) {
      assert.ok(!overlap(scene.nodes[i], scene.nodes[j]), `${scene.nodes[i].id} overlaps ${scene.nodes[j].id}`)
    }
  }
})

test('class SceneNodes follow the Scene "classes" contract', () => {
  const g = fixture()
  const scene = buildClassScene(g, emptyLayout())
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const square = byId.get('app/structures.py::Square')
  assert.equal(square.kind, 'method')
  assert.equal(square.params, '2 fields · 2 methods')
  assert.equal(square.returns, 'Shape')
  assert.equal(square.sig, '')
  assert.equal(square.body, '')
  assert.equal(square.changed, false)
  const mod = byId.get('app/structures.py::<module>')
  assert.equal(mod.kind, 'module')
  assert.equal(mod.classKind, 'module')
  assert.equal(mod.h, classBoxHeight(g.classes.find(c => c.id === mod.id)))
})

test('edges are the ClassEdges, and parents sit above their subclasses', () => {
  const g = fixture()
  const scene = buildClassScene(g, emptyLayout())
  assert.deepEqual(scene.edges.map(e => e.id).sort(), g.classEdges.map(e => e.id).sort())
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  for (const e of g.classEdges.filter(e => e.kind === 'inherits')) {
    assert.ok(byId.get(e.to).y + byId.get(e.to).h <= byId.get(e.from).y, `${e.to} above ${e.from}`)
  }
})

test('layoutPatch only touches classes, and saved positions win', () => {
  const g = fixture()
  const first = buildClassScene(g, emptyLayout())
  assert.deepEqual(Object.keys(first.layoutPatch), ['classes'])
  assert.equal(Object.keys(first.layoutPatch.classes).length, g.classes.length)
  validateLayoutPatch(first.layoutPatch)

  // with every class saved: same positions, nothing to patch
  const layout = { ...emptyLayout(), classes: first.layoutPatch.classes }
  const again = buildClassScene(g, layout)
  assert.deepEqual(again.layoutPatch, {})
  for (const n of again.nodes) assert.deepEqual({ x: n.x, y: n.y }, layout.classes[n.id])

  // a moved class stays where the user put it; a vanished one is dropped from the layout
  const moved = { ...layout.classes, 'app/structures.py::Point': { x: 5000, y: 5000 }, 'gone.py::Old': { x: 0, y: 0 } }
  const third = buildClassScene(g, { ...emptyLayout(), classes: moved })
  assert.deepEqual(third.nodes.find(n => n.id === 'app/structures.py::Point').x, 5000)
  assert.deepEqual(third.layoutPatch, { classes: { 'gone.py::Old': null } })
})

test('a class added later lands next to a relative without overlapping', () => {
  const g = fixture()
  const first = buildClassScene(g, emptyLayout())
  const saved = { ...first.layoutPatch.classes }
  delete saved['app/structures.py::Square'] // Square is "new": it inherits Shape (placed)
  const scene = buildClassScene(g, { ...emptyLayout(), classes: saved })
  assert.deepEqual(Object.keys(scene.layoutPatch.classes), ['app/structures.py::Square'])
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const sq = byId.get('app/structures.py::Square'), shape = byId.get('app/structures.py::Shape')
  assert.ok(sq.y >= shape.y + shape.h, 'new subclass goes below its parent')
  for (const n of scene.nodes) if (n !== sq) assert.ok(!overlap(sq, n), `overlaps ${n.id}`)
})

test('no classes (missing or empty) gives an empty scene', () => {
  const g = fixture()
  for (const classes of [undefined, []]) {
    const scene = buildClassScene({ ...g, classes, classEdges: undefined }, emptyLayout())
    assert.deepEqual(scene, { mode: 'classes', nodes: [], groups: [], edges: [], layoutPatch: {}, total: 0 })
  }
})

test('buildClassScene does not mutate its inputs', () => {
  const g = fixture()
  const layout = emptyLayout()
  const before = JSON.stringify([g, layout])
  buildClassScene(g, layout)
  assert.equal(JSON.stringify([g, layout]), before)
})

// ---------------------------------------------------------------- ClassNode

test('class box height grows with field rows and caps at MAX_ROWS', () => {
  const f = n => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, type: 'int', line: 1 }))
  const h1 = classBoxHeight({ kind: 'class', fields: f(1) })
  const h3 = classBoxHeight({ kind: 'class', fields: f(3) })
  assert.equal(h3 - h1, 2 * ROW_H)
  assert.equal(classBoxHeight({ kind: 'class', fields: f(40) }), classBoxHeight({ kind: 'class', fields: f(MAX_ROWS) }))
  assert.equal(classBoxHeight({ kind: 'module', fields: f(5) }), NODE_H)
})

function recordingCtx() {
  const texts = []
  const ctx = createCanvas(10, 10).getContext('2d')
  const orig = ctx.fillText.bind(ctx)
  ctx.fillText = (t, x, y) => { texts.push(String(t)); orig(t, x, y) }
  return { ctx, texts }
}

test('ClassNode draws title, field rows, +N more and a method count', () => {
  const fields = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, type: 'int' }))
  const data = { id: 'a::A', name: 'Account', x: 0, y: 0, w: NODE_W, h: classBoxHeight({ kind: 'class', fields }),
    classKind: 'class', fields, methods: ['a::A.x', 'a::A.y'], structure: 'tree' }
  const { ctx, texts } = recordingCtx()
  new ClassNode(data).draw(ctx, { k: 1, showLabels: true })
  assert.ok(texts.includes('Account'))
  assert.ok(texts.includes('f0'))
  assert.ok(texts.includes(': int'))
  assert.ok(texts.includes(`+${9 - MAX_ROWS + 1} more`))
  assert.ok(texts.includes('2 methods'))
  assert.ok(texts.includes('tree'))
})

test('module pseudo-class shows its function count; zoomed out shows the title only', () => {
  const data = { id: 'm::<module>', name: 'structures.py', x: 0, y: 0, w: NODE_W, h: NODE_H,
    classKind: 'module', fields: [], methods: ['m::a', 'm::b', 'm::c'] }
  let r = recordingCtx()
  new ClassNode(data).draw(r.ctx, { k: 1, showLabels: true })
  assert.ok(r.texts.includes('3 functions'))
  r = recordingCtx()
  new ClassNode(data).draw(r.ctx, { k: LABEL_MIN_ZOOM / 2, showLabels: false })
  assert.deepEqual(r.texts, ['structures.py'])
})

test('ClassNode keeps the CodeNode interface (hitTest, moveTo, bounds, selected)', () => {
  const data = { id: 'a::A', name: 'A', x: 10, y: 20, w: NODE_W, h: 100, classKind: 'class', fields: [], methods: [] }
  const n = new ClassNode(data)
  assert.equal(n.id, 'a::A')
  assert.equal(n.selected, false)
  assert.ok(n.hitTest(15, 110))
  assert.ok(!n.hitTest(15, 125))
  n.moveTo(50, 60)
  assert.deepEqual([data.x, data.y], [50, 60])
  const b = n.bounds()
  assert.ok(b.x < 50 && b.y < 60 && b.w > NODE_W && b.h > 100)
})

// ---------------------------------------------------------------- ClassEdge

function strokeLog() {
  const log = { dashes: [], widths: [], strokes: 0, fills: 0, curves: 0 }
  const ctx = createCanvas(10, 10).getContext('2d')
  const wrap = (name, fn) => { const o = ctx[name].bind(ctx); ctx[name] = (...a) => { fn(...a); return o(...a) } }
  wrap('setLineDash', d => log.dashes.push(d.length))
  wrap('stroke', () => { log.strokes++; log.widths.push(ctx.lineWidth) })
  wrap('fill', () => log.fills++)
  wrap('bezierCurveTo', () => log.curves++)
  return { ctx, log }
}

const boxes = {
  A: { x: 0, y: 0, w: 200, h: 80 },
  B: { x: 0, y: 300, w: 200, h: 80 },
}
const boxOf = id => boxes[id]
const edge = (from, to, kind, weight = 1) => ({ id: `${from}>${to}:${kind}`, from, to, kind, weight })

test('each edge kind has its own look', () => {
  const draw = (e) => { const r = strokeLog(); new ClassEdge(e, boxOf).draw(r.ctx, { k: 1, showLabels: true }); return r.log }
  const inh = draw(edge('B', 'A', 'inherits'))
  assert.equal(inh.fills, 1, 'hollow triangle is filled with the background')
  assert.equal(inh.strokes, 2, 'line + triangle outline')
  const comp = draw(edge('A', 'B', 'composes'))
  assert.equal(comp.fills, 1, 'filled diamond')
  const inst = draw(edge('A', 'B', 'instantiates'))
  assert.ok(inst.dashes.some(n => n > 0), 'dashed')
  const u1 = draw(edge('A', 'B', 'uses', 1)), u8 = draw(edge('A', 'B', 'uses', 8))
  assert.ok(u8.widths[0] > u1.widths[0], 'uses gets wider with weight')
  assert.ok(u1.widths[0] <= CLASS_EDGE_STYLES.inherits.width)
})

test('self-edges draw as a loop; parallel edges get separate lanes', () => {
  const self = new ClassEdge(edge('A', 'A', 'composes'), boxOf)
  const r = strokeLog()
  self.draw(r.ctx, { k: 1, showLabels: true })
  assert.equal(r.log.curves, 1)
  const b = self.bounds()
  assert.ok(b.x + b.w > boxes.A.x + boxes.A.w && b.y < boxes.A.y, 'loop sits off the top-right corner')

  const built = buildClassEdges([edge('A', 'B', 'composes'), edge('A', 'B', 'uses'), edge('B', 'A', 'uses'),
    edge('A', 'A', 'composes'), edge('A', 'Z', 'uses')], boxOf)
  assert.equal(built.length, 4, 'unresolvable end skipped')
  const lanes = built.filter(e => e.data.from !== e.data.to).map(e => e.lane)
  assert.equal(new Set(lanes).size, 3)
})

test('the whole fixture scene renders on a real canvas', () => {
  const g = fixture()
  const scene = buildClassScene(g, emptyLayout())
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const bo = id => byId.get(id)
  const nodes = scene.nodes.map(n => new ClassNode(n))
  const edges = buildClassEdges(scene.edges, bo)
  assert.equal(edges.length, g.classEdges.length)
  const canvas = createCanvas(1600, 900)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, 1600, 900)
  ctx.translate(40, 40)
  for (const d of [...edges, ...nodes]) d.draw(ctx, { k: 1, showLabels: true })
  const px = ctx.getImageData(40 + byId.get('app/structures.py::Registry').x + 5, 40 + byId.get('app/structures.py::Registry').y + 5, 1, 1).data
  assert.notDeepEqual([...px.slice(0, 3)], [0x12, 0x12, 0x12], 'Registry box is painted')
  // L1_UI_PNG=path writes the picture out for a visual check
  if (process.env.L1_UI_PNG) writeFileSync(process.env.L1_UI_PNG, canvas.toBuffer('image/png'))
})
