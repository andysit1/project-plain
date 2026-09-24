// L1 server: classes, classEdges and node `cls` from buildGraph (Python only).
// Main fixture: tests/layers-repo; regression: tests/demo-repo; edge cases: a temp repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGraph, nodeId, classEdgeId, moduleClassId } from '../../shared/contracts.js'
import { buildGraph, clearCache } from '../../map/src/graph.js'
import { extractFile } from '../../map/src/extract.js'

const here = dirname(fileURLToPath(import.meta.url))
const LAYERS = join(here, '..', 'layers-repo')
const DEMO = join(here, '..', 'demo-repo')
const S = 'app/structures.py'
const C = 'app/config.py'
const cid = q => nodeId(S, q)
const fixture = JSON.parse(readFileSync(join(here, '..', '..', 'shared', 'fixtures', 'graph.classes.json'), 'utf8'))

let layersGraph
async function layers() {
  if (!layersGraph) layersGraph = await buildGraph(LAYERS)
  return layersGraph
}
const edge = (g, from, to, kind) => g.classEdges.find(e => e.id === classEdgeId(from, to, kind))
const cls = (g, id) => g.classes.find(c => c.id === id)

test('layers-repo: graph validates and carries classes, classEdges, frames', async () => {
  const g = await layers()
  validateGraph(g)
  assert.ok(Array.isArray(g.classes))
  assert.ok(Array.isArray(g.classEdges))
  // frames come from the infer pass; the fixture's hand-written frames must match exactly
  const fx = JSON.parse(readFileSync(join(here, '..', '..', 'shared', 'fixtures', 'graph.classes.json'), 'utf8'))
  for (const [id, frame] of Object.entries(fx.frames)) assert.deepEqual(g.frames[id], frame, id)
})

test('layers-repo: class list', async () => {
  const g = await layers()
  assert.deepEqual(g.classes.map(c => c.id), [
    moduleClassId(C),
    ...['ListNode', 'DNode', 'TreeNode', 'GraphNode', 'Point', 'Polygon', 'Shape', 'Square', 'Registry'].map(cid),
    moduleClassId(S),
  ])
  const mod = cls(g, moduleClassId(S))
  assert.equal(mod.kind, 'module')
  assert.equal(mod.qname, '<module>')
  assert.equal(mod.name, 'structures.py')
  assert.equal(mod.line, 1)
  const sq = cls(g, cid('Square'))
  assert.equal(sq.kind, 'class')
  assert.equal(sq.line, 51)
  assert.deepEqual(sq.bases, ['Shape'])
  assert.equal(sq.structure, null)
  const structures = Object.fromEntries(g.classes.filter(c => c.structure).map(c => [c.name, c.structure]))
  assert.deepEqual(structures, { ListNode: 'linked-list', DNode: 'doubly-linked-list', TreeNode: 'tree', GraphNode: 'graph' })
})

test('layers-repo: dataclass fields of Point and Polygon', async () => {
  const g = await layers()
  const float = { k: 'prim', t: 'float' }
  assert.deepEqual(cls(g, cid('Point')).fields, [
    { name: 'x', type: 'float', line: 36, shape: float, src: 'annotation' },
    { name: 'y', type: 'float', line: 37, shape: float, src: 'annotation' },
  ])
  assert.deepEqual(cls(g, cid('Polygon')).fields.map(({ name, type, line }) => ({ name, type, line })), [
    { name: 'name', type: 'str', line: 42 },
    { name: 'points', type: 'list[Point]', line: 43 },
  ])
  // untyped fields get their composes edge from the inferred shape (items/by_name hold Squares)
  assert.equal(edge(g, cid('Registry'), cid('Square'), 'composes').weight, 2)
  // self.x fields: annotation, ctor callee, or "" when neither
  assert.deepEqual(cls(g, cid('Registry')).fields.map(f => [f.name, f.type]), [
    ['items', ''], ['by_name', ''], ['tags', ''], ['root', 'TreeNode'],
  ])
  assert.deepEqual(cls(g, cid('Square')).fields.map(f => [f.name, f.type]), [['side', 'float'], ['corner', 'Point']])
})

test('layers-repo: node cls for methods and module functions', async () => {
  const g = await layers()
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  assert.equal(byId.get(cid('Square.area')).cls, cid('Square'))
  assert.equal(byId.get(cid('Registry.build')).cls, cid('Registry'))
  assert.equal(byId.get(cid('make_list')).cls, moduleClassId(S))
  assert.equal(byId.get(cid('linked_sum')).cls, moduleClassId(S))
  assert.equal(byId.get(nodeId(C, 'load_config')).cls, moduleClassId(C))
  assert.deepEqual(cls(g, cid('Registry')).methods, ['__init__', 'add', 'build'].map(m => cid(`Registry.${m}`)))
  assert.deepEqual(cls(g, cid('Point')).methods, [])
  for (const n of g.nodes) assert.ok(cls(g, n.cls).methods.includes(n.id), n.id)
})

test('layers-repo: class edges', async () => {
  const g = await layers()
  assert.ok(edge(g, cid('Square'), cid('Shape'), 'inherits'))
  assert.ok(edge(g, cid('Square'), cid('Point'), 'composes'))
  assert.ok(edge(g, cid('Polygon'), cid('Point'), 'composes'))
  assert.ok(edge(g, cid('Registry'), cid('TreeNode'), 'composes'))
  assert.equal(edge(g, cid('ListNode'), cid('ListNode'), 'composes').weight, 1)
  assert.equal(edge(g, cid('DNode'), cid('DNode'), 'composes').weight, 2)
  assert.equal(edge(g, cid('TreeNode'), cid('TreeNode'), 'composes').weight, 2)
  assert.ok(edge(g, cid('GraphNode'), cid('GraphNode'), 'composes'))
  assert.ok(edge(g, moduleClassId(S), cid('ListNode'), 'instantiates'))
  assert.ok(edge(g, cid('Registry'), cid('Square'), 'instantiates'))
  assert.ok(edge(g, cid('Registry'), cid('TreeNode'), 'instantiates'))
  assert.ok(edge(g, cid('Square'), cid('Point'), 'instantiates'))
  assert.ok(edge(g, cid('Registry'), moduleClassId(C), 'uses'))
  for (const e of g.classEdges) {
    if (e.kind !== 'composes') assert.notEqual(e.from, e.to, `self edge ${e.id}`)
  }
})

test('layers-repo: classes and classEdges agree with the hand-written fixture where they overlap', async () => {
  const g = await layers()
  // every real class in the fixture exists, with the same line, bases, fields (name/type/line) and methods
  for (const fc of fixture.classes) {
    const c = cls(g, fc.id)
    assert.ok(c, `missing class ${fc.id}`)
    assert.equal(c.kind, fc.kind)
    assert.equal(c.line, fc.line, fc.id)
    assert.deepEqual(c.bases, fc.bases, fc.id)
    assert.deepEqual(c.fields.map(f => [f.name, f.type, f.line]), fc.fields.map(f => [f.name, f.type, f.line]), fc.id)
    for (const m of fc.methods) assert.ok(c.methods.includes(m), `${fc.id} missing method ${m}`)
  }
  // Constructor calls are 'instantiates', never call edges to __init__, so they add no 'uses'.
  const mine = new Map(g.classEdges.map(e => [e.id, e]))
  for (const fe of fixture.classEdges) {
    assert.ok(mine.has(fe.id), `missing class edge ${fe.id}`)
    assert.equal(mine.get(fe.id).weight, fe.weight, fe.id)
  }
  const fixtureIds = new Set(fixture.classEdges.map(e => e.id))
  assert.deepEqual([...mine.keys()].filter(id => !fixtureIds.has(id)), [])
})

// ---- demo-repo regression: same nodes and call edges as before L1 ----

const DEMO_EDGES = [
  'app/config.py::load_config>app/utils.py::read_file',
  'app/config.py::load_config>app/config.py::parse_env',
  'app/config.py::load_config>app/config.py::Config.validate',
  'app/db.py::connect>app/utils.py::retry',
  'app/db.py::query>app/utils.py::retry',
  'app/main.py::<module>>app/main.py::main',
  'app/main.py::main>app/config.py::load_config',
  'app/main.py::main>app/main.py::run',
  'app/main.py::run>app/db.py::connect',
  'app/main.py::run>app/db.py::query',
  'app/main.py::run>app/db.py::close',
  'app/main.py::run>app/utils.py::slugify',
  'web/api.ts::fetchUser>web/client.ts::request',
  'web/api.ts::fetchPosts>web/client.ts::request',
  'web/client.ts::request>web/client.ts::buildUrl',
]

test('demo-repo: node count and call edges unchanged; TS nodes have cls null', async () => {
  const g = await buildGraph(DEMO)
  validateGraph(g)
  const py = g.nodes.filter(n => n.file.endsWith('.py'))
  assert.equal(py.length, 15)
  assert.equal(g.nodes.length, 19)
  assert.deepEqual(g.edges.map(e => e.id), DEMO_EDGES)
  for (const n of g.nodes) {
    if (n.file.endsWith('.py')) assert.equal(typeof n.cls, 'string', n.id)
    else assert.equal(n.cls, null, n.id)
  }
  assert.ok(g.classes.every(c => c.file.endsWith('.py')))
  assert.equal(cls(g, nodeId('app/config.py', 'Config')).methods.length, 2)
  assert.ok(edge(g, moduleClassId('app/main.py'), moduleClassId('app/db.py'), 'uses').weight === 3)
})

// ---- edge cases in a temp repo ----

function writeRepo(dir) {
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg', 'base.py'), [
    'class Base:',
    '    pass',
    '',
    'class Generic:',
    '    pass',
    '',
    'class Widget:',
    '    pass',
  ].join('\n'))
  writeFileSync(join(dir, 'pkg', 'models.py'), [
    'import pkg.base as b',
    'from pkg.base import Widget as W',
    'from pkg.base import Generic',
    '',
    'class Model(b.Base, Generic[int], metaclass=Meta):',
    '    count: int = 0',
    '    count: str',
    '    child: "Model | None" = None',
    '    parts: dict[str, W]',
    '',
    '    def __init__(self, w: "W"):',
    '        self.w = w',
    '        self.count = 3',
    '        self.made = b.Widget()',
    '        def helper():',
    '            self.inner = W()',
    '',
    '    class Inner(Model):',
    '        def m(self):',
    '            self.only_inner = 1',
    '',
    'def top():',
    '    def nested():',
    '        return Model(None)',
    '    return nested()',
  ].join('\n'))
  writeFileSync(join(dir, 'pkg', 'ui.ts'), 'export class Box { draw() { return new Box() } }\n')
}

test('temp repo: bases via import alias, generics stripped, metaclass skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1s-'))
  writeRepo(dir)
  clearCache()
  const g = validateGraph(await buildGraph(dir))
  const M = 'pkg/models.py', B = 'pkg/base.py'
  const model = cls(g, nodeId(M, 'Model'))
  assert.deepEqual(model.bases, ['b.Base', 'Generic[int]'])
  assert.ok(edge(g, model.id, nodeId(B, 'Base'), 'inherits'))
  assert.ok(edge(g, model.id, nodeId(B, 'Generic'), 'inherits'))
  // nested class: dotted qname, inherits its outer class, fields go to the right class
  const inner = cls(g, nodeId(M, 'Model.Inner'))
  assert.equal(inner.name, 'Inner')
  assert.ok(edge(g, inner.id, model.id, 'inherits'))
  assert.deepEqual(inner.fields.map(f => f.name), ['only_inner'])
  assert.equal(g.nodes.find(n => n.id === nodeId(M, 'Model.Inner.m')).cls, inner.id)
  // fields: first occurrence wins; param annotation feeds `self.w = w`
  assert.deepEqual(model.fields.map(f => [f.name, f.type]), [
    ['count', 'int'], ['child', 'Model | None'], ['parts', 'dict[str, W]'],
    ['w', 'W'], ['made', 'b.Widget'], ['inner', 'W'],
  ])
  assert.ok(edge(g, model.id, model.id, 'composes'))
  assert.equal(edge(g, model.id, nodeId(B, 'Widget'), 'composes').weight, 4) // parts, w, made, inner
  assert.ok(edge(g, model.id, nodeId(B, 'Widget'), 'instantiates'))
  // functions nested in module-level functions belong to the module pseudo-class
  assert.equal(g.nodes.find(n => n.id === nodeId(M, 'top.nested')).cls, moduleClassId(M))
  assert.ok(edge(g, moduleClassId(M), model.id, 'instantiates'))
  // base.py has no functions: no module pseudo-class for it
  assert.equal(cls(g, moduleClassId(B)), undefined)
  // TS: no classes, cls null
  assert.ok(g.nodes.filter(n => n.file.endsWith('.ts')).every(n => n.cls === null))
  assert.ok(!g.classes.some(c => c.file.endsWith('.ts')))
})

test('extractFile: classes for Python, [] for other languages', async () => {
  const py = await extractFile('a.py', '@dataclass(frozen=True)\nclass A(B, metaclass=M):\n    x: int\n')
  assert.deepEqual(py.classes, [{ qname: 'A', name: 'A', line: 2, bases: ['B'], decorators: ['dataclass'], fields: [{ name: 'x', type: 'int', line: 3 }] }])
  const ts = await extractFile('a.ts', 'class A { x = 1; m() {} }\n')
  assert.deepEqual(ts.classes, [])
  assert.equal(ts.functions.length, 1)
  const none = await extractFile('a.txt', '')
  assert.deepEqual(none.classes, [])
})

test('parse cache: a cached rebuild yields the same classes', async () => {
  clearCache()
  const stats1 = {}
  const g1 = await buildGraph(LAYERS, { stats: stats1 })
  const stats2 = {}
  const g2 = await buildGraph(LAYERS, { stats: stats2 })
  assert.ok(stats1.changed > 0)
  assert.equal(stats2.changed, 0)
  assert.deepEqual(g2.classes, g1.classes)
  assert.deepEqual(g2.classEdges, g1.classEdges)
})
