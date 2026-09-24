// L3 inference: type-text parsing, union joining and structure classification (pure, no parser).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateShape } from '../../shared/contracts.js'
import { parseTypeText, unionOf, joinShapes, pickStrongest, finalize, classifyStructure } from '../../map/src/infer.js'

const rc = name => ({ Point: 'm.py::Point', Node: 'm.py::Node', ListNode: 'm.py::ListNode', 'models.User': 'models.py::User' })[name] || null
const P = t => ({ k: 'prim', t })
const parse = t => validateShape(parseTypeText(t, rc))

test('parseTypeText: primitives and bare containers', () => {
  assert.deepEqual(parse('int'), P('int'))
  assert.deepEqual(parse('str'), P('str'))
  assert.deepEqual(parse('None'), P('none'))
  assert.deepEqual(parse('bytes'), P('bytes'))
  assert.deepEqual(parse('list'), { k: 'list', of: { k: 'unknown' } })
  assert.deepEqual(parse('dict'), { k: 'dict', key: { k: 'unknown' }, val: { k: 'unknown' } })
})

test('parseTypeText: generics, nesting and typing aliases', () => {
  assert.deepEqual(parse('list[int]'), { k: 'list', of: P('int') })
  assert.deepEqual(parse('List[str]'), { k: 'list', of: P('str') })
  assert.deepEqual(parse('typing.Set[int]'), { k: 'set', of: P('int') })
  assert.deepEqual(parse('dict[str, list[Point]]'),
    { k: 'dict', key: P('str'), val: { k: 'list', of: { k: 'obj', cls: 'm.py::Point' } } })
  assert.deepEqual(parse('Mapping[str, int]'), { k: 'dict', key: P('str'), val: P('int') })
  assert.deepEqual(parse('tuple[int, ...]'), { k: 'tuple', of: P('int') })
  assert.deepEqual(parse('tuple[int, str]'), { k: 'tuple', of: { k: 'union', of: [P('int'), P('str')] }, len: 2 })
  assert.deepEqual(parse('Final[int]'), P('int'))
  assert.deepEqual(parse('Literal["a", "b"]'), P('str'))
})

test('parseTypeText: Optional, Union, | and quoted forward refs', () => {
  const optNode = { k: 'union', of: [{ k: 'obj', cls: 'm.py::Node' }, P('none')] }
  assert.deepEqual(parse('Optional["Node"]'), optNode)
  assert.deepEqual(parse('"Optional[Node]"'), optNode)
  assert.deepEqual(parse("Optional['Node']"), optNode)
  assert.deepEqual(parse('Node | None'), optNode)
  assert.deepEqual(parse('Union[int, str, int]'), { k: 'union', of: [P('int'), P('str')] })
  assert.deepEqual(parse('Optional[Optional[int]]'), { k: 'union', of: [P('int'), P('none')] })
  assert.deepEqual(parse('list["ListNode"]'), { k: 'list', of: { k: 'obj', cls: 'm.py::ListNode' } })
  assert.deepEqual(parse('models.User'), { k: 'obj', cls: 'models.py::User' })
})

test('parseTypeText: never guesses', () => {
  for (const t of ['', 'Any', 'object', 'Callable[[int], str]', 'Unresolved', 'T', 'list[', '???']) {
    assert.deepEqual(parse(t), { k: 'unknown' }, t)
  }
  assert.deepEqual(parse('Optional[Unresolved]'), { k: 'union', of: [{ k: 'unknown' }, P('none')] })
})

test('unionOf: dedupes, flattens, collapses a single member', () => {
  assert.deepEqual(unionOf([P('int'), P('int')]), P('int'))
  assert.deepEqual(unionOf([P('int'), { k: 'union', of: [P('str'), P('int')] }]), { k: 'union', of: [P('int'), P('str')] })
  assert.deepEqual(joinShapes(P('int'), P('str')), { k: 'union', of: [P('int'), P('str')] })
  const rec = n => ({ k: 'record', fields: { a: P('int'), [n]: P('str') } })
  assert.deepEqual(unionOf([rec('b'), rec('b')]), rec('b'))
  assert.equal(unionOf([rec('b'), rec('c')]).of.length, 2)
})

test('unionOf: an empty container joins into the populated one', () => {
  const empty = { k: 'list', of: { k: 'bottom' } } // internal: '[]' before any evidence
  assert.deepEqual(unionOf([empty, { k: 'list', of: P('int') }]), { k: 'list', of: P('int') })
  assert.deepEqual(unionOf([{ k: 'list', of: P('int') }, { k: 'list', of: P('str') }]),
    { k: 'union', of: [{ k: 'list', of: P('int') }, { k: 'list', of: P('str') }] })
})

test('pickStrongest: stronger source wins, equal strength unions', () => {
  const ev = (shape, src) => ({ shape, src })
  assert.deepEqual(pickStrongest([ev(P('int'), 'return'), ev(P('str'), 'annotation')]), ev(P('str'), 'annotation'))
  assert.deepEqual(pickStrongest([ev(P('int'), 'literal'), ev(P('str'), 'literal')]),
    ev({ k: 'union', of: [P('int'), P('str')] }, 'literal'))
  assert.deepEqual(pickStrongest([ev({ k: 'unknown' }, 'unknown'), ev(P('int'), 'return')]), ev(P('int'), 'return'))
  assert.deepEqual(pickStrongest([ev({ k: 'unknown' }, 'unknown')]), ev({ k: 'unknown' }, 'unknown'))
})

test('finalize: strips internal markers and passes validateShape', () => {
  const s = finalize({ k: 'tuple', of: { k: 'bottom' }, len: 2, items: [{ k: 'bottom' }, P('int')] })
  assert.deepEqual(s, { k: 'tuple', of: { k: 'unknown' }, len: 2 })
  validateShape(s)
})

test('classifyStructure: heuristics by self-field names and arity', () => {
  const f = (name, inside = null) => ({ name, inside })
  assert.equal(classifyStructure([f('next')], false), 'linked-list')
  assert.equal(classifyStructure([f('parent')], false), 'linked-list')
  assert.equal(classifyStructure([f('prev'), f('next')], false), 'doubly-linked-list')
  assert.equal(classifyStructure([f('left'), f('right')], false), 'tree')
  assert.equal(classifyStructure([f('children', 'list')], false), 'tree')
  assert.equal(classifyStructure([f('parent'), f('children', 'list')], false), 'tree')
  assert.equal(classifyStructure([f('neighbors', 'list')], false), 'graph')
  assert.equal(classifyStructure([f('adj', 'dict')], false), 'graph')
  assert.equal(classifyStructure([f('links', 'dict')], false), 'graph')
  assert.equal(classifyStructure([f('children', 'dict')], false), 'tree')
  assert.equal(classifyStructure([], true), 'graph')
  assert.equal(classifyStructure([], false), null)
})
