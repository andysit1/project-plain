import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateGraph, validateShape, validateLayout, validateLayoutPatch,
  applyLayoutPatch, combinePatches, isEmptyPatch, emptyLayout, classEdgeId, moduleClassId,
} from '../../shared/contracts.js'

const FX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'fixtures')
const fx = name => JSON.parse(readFileSync(join(FX, name), 'utf8'))

test('graph.classes.json passes validateGraph', () => {
  const g = fx('graph.classes.json')
  assert.doesNotThrow(() => validateGraph(g))
  assert.ok(g.classes.length > 0 && g.classEdges.length > 0 && Object.keys(g.frames).length > 0)
})

test('v1 graphs without layers fields still validate', () => {
  assert.doesNotThrow(() => validateGraph(fx('graph.small.json')))
})

test('class edge endpoints must be class ids', () => {
  const g = fx('graph.classes.json')
  const e = g.classEdges[0]
  e.to = 'nope.py::X'
  e.id = classEdgeId(e.from, e.to, e.kind)
  assert.throws(() => validateGraph(g), /graph\.classEdges\[0\]\.to: unknown class/)
})

test('node cls must name a known class', () => {
  const g = fx('graph.classes.json')
  g.nodes[0].cls = 'app/structures.py::Ghost'
  assert.throws(() => validateGraph(g), /graph\.nodes\[0\]\.cls: unknown class/)
})

test('validateShape rejects bad shapes with a path', () => {
  assert.doesNotThrow(() => validateShape({ k: 'dict', key: { k: 'prim', t: 'str' }, val: { k: 'list', of: { k: 'unknown' } } }))
  assert.throws(() => validateShape({ k: 'list', of: { k: 'prim', t: 'long' } }), /shape\.of\.t/)
  assert.throws(() => validateShape({ k: 'union', of: [{ k: 'unknown' }] }), /shape\.of/)
})

test('moduleClassId matches the <module> node id form', () => {
  assert.equal(moduleClassId('app/x.py'), 'app/x.py::<module>')
})

test('layout.classes is optional, validated and patchable', () => {
  const base = emptyLayout()
  assert.equal(base.classes, undefined)
  assert.doesNotThrow(() => validateLayout(base))
  const patch = { classes: { 'a.py::A': { x: 1, y: 2 } } }
  assert.equal(isEmptyPatch(patch), false)
  assert.doesNotThrow(() => validateLayoutPatch(patch))
  const l = applyLayoutPatch(base, patch)
  assert.deepEqual(l.classes, { 'a.py::A': { x: 1, y: 2 } })
  assert.doesNotThrow(() => validateLayout(l))
  const l2 = applyLayoutPatch(l, { classes: { 'a.py::A': null } })
  assert.deepEqual(l2.classes, {})
  assert.deepEqual(combinePatches({ classes: { a: { x: 0, y: 0 } } }, { classes: { b: null } }).classes, { a: { x: 0, y: 0 }, b: null })
  assert.throws(() => validateLayout({ ...base, classes: { a: { x: 1 } } }), /layout\.classes/)
})
