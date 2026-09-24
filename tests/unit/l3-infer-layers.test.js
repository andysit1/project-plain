// L3 inference end to end: tests/layers-repo against shared/fixtures/graph.classes.json, and a
// smoke run over tests/demo-repo. Parses with the real tree-sitter python grammar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateShape, validateFrame, STRUCTURES, SHAPE_SRCS } from '../../shared/contracts.js'
import { inferLayers } from '../../map/src/infer.js'
import { extractRepo, makeResolveClass, synthGraph } from './helpers/l3-parse.js'

const root = p => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const fixture = JSON.parse(readFileSync(root('shared/fixtures/graph.classes.json'), 'utf8'))
const S = 'app/structures.py::'
const obj = q => ({ k: 'obj', cls: S + q })
const P = t => ({ k: 'prim', t })

let cached = null
async function layers() {
  if (!cached) {
    const dataByFile = await extractRepo(root('tests/layers-repo'))
    const { nodes, edges, classes } = fixture
    cached = inferLayers({ nodes, edges, classes, dataByFile, resolveClass: makeResolveClass(classes) })
  }
  return cached
}

test('every emitted frame and field shape passes the contract validators', async () => {
  const r = await layers()
  const ids = new Set(fixture.nodes.map(n => n.id))
  for (const [id, fr] of Object.entries(r.frames)) {
    assert.ok(ids.has(id), `frame for unknown node ${id}`)
    validateFrame(fr, id)
  }
  for (const [cls, fields] of Object.entries(r.fieldShapes)) {
    for (const [name, { shape, src }] of Object.entries(fields)) {
      validateShape(shape, `${cls}.${name}`)
      assert.ok(SHAPE_SRCS.includes(src))
      if (shape.k === 'unknown') assert.equal(src, 'unknown')
    }
  }
})

for (const q of ['linked_sum', 'grid', 'count_words']) {
  test(`frame of ${q} matches the fixture`, async () => {
    const r = await layers()
    assert.deepEqual(r.frames[S + q], fixture.frames[S + q])
  })
}

test('frame of Registry.add matches the fixture (name via call-site evidence)', async () => {
  const r = await layers()
  // `name` has no mutation: its str comes from the call site `self.add("sq", sq)`, which ranks as 'return'
  assert.deepEqual(r.frames[`${S}Registry.add`], fixture.frames[`${S}Registry.add`])
})

test('methods do not show up as self fields; locals from ctor and call returns', async () => {
  const r = await layers()
  const build = r.frames[`${S}Registry.build`]
  assert.deepEqual(build.vars.map(v => [v.name, v.scope, v.src]), [['sq', 'local', 'ctor'], ['cfg', 'local', 'return']])
  assert.deepEqual(build.vars[1].shape, { k: 'record', fields: { path: P('str') } })
  const make = r.frames[`${S}make_list`]
  assert.deepEqual(make.vars.find(v => v.name === 'head').shape, { k: 'union', of: [P('none'), obj('ListNode')] })
  assert.deepEqual(make.loops, [{ kind: 'for', line: 91, var: 'v', over: 'values', step: '' }])
})

test('structures: recursive classes are classified, everything else is null', async () => {
  const r = await layers()
  const want = { ListNode: 'linked-list', DNode: 'doubly-linked-list', TreeNode: 'tree', GraphNode: 'graph' }
  for (const c of fixture.classes) {
    const got = r.structures[c.id]
    assert.equal(got, want[c.qname] ?? null, c.id)
    if (got !== null) assert.ok(STRUCTURES.includes(got))
    if (c.structure !== undefined) assert.equal(got, c.structure, `${c.id} vs fixture`)
  }
})

test('Registry field shapes come from mutations across methods', async () => {
  const f = (await layers()).fieldShapes[`${S}Registry`]
  assert.deepEqual(f.items, { shape: { k: 'list', of: obj('Square') }, src: 'mutation' })
  assert.deepEqual(f.by_name, { shape: { k: 'dict', key: P('str'), val: obj('Square') }, src: 'mutation' })
  assert.deepEqual(f.tags, { shape: { k: 'set', of: P('str') }, src: 'mutation' })
  assert.deepEqual(f.root, { shape: obj('TreeNode'), src: 'ctor' })
})

test('field shapes agree with the fixture class fields', async () => {
  const r = await layers()
  for (const c of fixture.classes) {
    for (const fld of c.fields) {
      assert.deepEqual(r.fieldShapes[c.id][fld.name], { shape: fld.shape, src: fld.src }, `${c.id}.${fld.name}`)
    }
  }
})

test('demo-repo: runs without throwing, _CONNECTIONS is a dict', async () => {
  const dataByFile = await extractRepo(root('tests/demo-repo'))
  const g = synthGraph(dataByFile)
  const r = inferLayers({ ...g, dataByFile, resolveClass: makeResolveClass(g.classes) })
  for (const [id, fr] of Object.entries(r.frames)) validateFrame(fr, id)
  const open = r.frames['app/db.py::connect._open']
  const conns = open.vars.find(v => v.name === '_CONNECTIONS')
  assert.equal(conns.scope, 'global')
  assert.equal(conns.shape.k, 'dict')
  assert.equal(conns.src, 'mutation')
  const local = open.vars.find(v => v.name === 'conn')
  assert.ok(local.shape.of.some(s => s.k === 'record' && s.fields.open.t === 'bool'))
  assert.deepEqual(r.fieldShapes['app/config.py::Config'].values.shape.k, 'dict')
  assert.equal(r.frames['app/main.py::run'].vars.find(v => v.name === 'cfg').shape.cls, 'app/config.py::Config')
})

test('inferLayers tolerates empty input and missing data', () => {
  assert.deepEqual(inferLayers({}), { frames: {}, fieldShapes: {}, structures: {} })
  const r = inferLayers({ nodes: fixture.nodes, edges: fixture.edges, classes: fixture.classes, dataByFile: {} })
  assert.deepEqual(r.frames, {})
})
