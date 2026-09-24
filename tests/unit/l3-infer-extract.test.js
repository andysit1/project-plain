// L3 extraction (extract-data.js) and small inference rules over inline Python snippets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateFrame } from '../../shared/contracts.js'
import { inferLayers } from '../../map/src/infer.js'
import { extractSource, makeResolveClass, synthGraph } from './helpers/l3-parse.js'

const P = t => ({ k: 'prim', t })
const src = lines => lines.join('\n') + '\n'

/** Extract + infer one file 'm.py'; returns { data, r, frame(q) }. */
async function run(lines) {
  const data = await extractSource(src(lines))
  const dataByFile = { 'm.py': data }
  const g = synthGraph(dataByFile)
  const r = inferLayers({ ...g, dataByFile, resolveClass: makeResolveClass(g.classes) })
  for (const [id, fr] of Object.entries(r.frames)) validateFrame(fr, id)
  const frame = q => r.frames[`m.py::${q}`]
  const v = (q, name) => frame(q).vars.find(x => x.name === name)
  return { data, r, frame, v }
}

test('qnames match extract.js: Class.method, outer.inner, outer.Class.method', async () => {
  const d = await extractSource(src([
    'class A:',
    '    def m(self): pass',
    '    class B:',
    '        def n(self): pass',
    'def outer():',
    '    def inner(): pass',
    '    class C:',
    '        def k(self): pass',
  ]))
  assert.deepEqual(Object.keys(d.functions), ['A.m', 'A.B.n', 'outer', 'outer.inner', 'outer.C.k'])
  assert.deepEqual(Object.keys(d.classFields), ['A', 'A.B', 'outer.C'])
})

test('params, locals, rebinds and self fields are recorded', async () => {
  const d = await extractSource(src([
    'class K:',
    '    x: int',
    '    def __init__(self, a: int, b=2, *rest, **kw):',
    '        self.a = a',
    '        c = [a]',
    '        c = None',
    '        self.items.append(c)',
    '    @staticmethod',
    '    def s(v): return v',
  ]))
  const init = d.functions['K.__init__']
  assert.deepEqual(init.params.map(p => [p.name, p.annotation, p.star || '']),
    [['self', '', ''], ['a', 'int', ''], ['b', '', ''], ['rest', '', '*'], ['kw', '', '**']])
  assert.equal(init.selfParam, 'self')
  assert.equal(d.functions['K.s'].selfParam, null)
  assert.deepEqual(init.locals.map(l => l.name), ['c'])
  assert.deepEqual(init.mutations.map(m => [m.target, m.op]), [['self.a', 'assign'], ['c', 'assign'], ['self.items', 'append']])
  assert.deepEqual(d.classFields.K.map(f => [f.name, f.annotation, f.method]), [['x', 'int', null], ['a', '', 'K.__init__']])
})

test('loops: for over d.items() uses d, while with pointer step', async () => {
  const d = await extractSource(src([
    'def f(d, node):',
    '    for k, v in d.items():',
    '        pass',
    '    for i, x in enumerate(xs):',
    '        pass',
    '    while node is not None:',
    '        node = node.next',
    '    while True:',
    '        break',
  ]))
  const loops = d.functions.f.loops.map(({ kind, line, var: v, over, step }) => ({ kind, line, var: v, over, step }))
  assert.deepEqual(loops, [
    { kind: 'for', line: 2, var: 'k, v', over: 'd', step: '' },
    { kind: 'for', line: 4, var: 'i, x', over: 'xs', step: '' },
    { kind: 'while', line: 6, var: 'node', over: 'node', step: 'next' },
    { kind: 'while', line: 8, var: '', over: '', step: '' },
  ])
})

test('globals: module names read or written, not shadowed by locals', async () => {
  const { data, v, frame } = await run([
    'CACHE = {}',
    'COUNT = 0',
    'NAMES = []',
    'def put(k: str, val: int):',
    '    global COUNT',
    '    CACHE[k] = val',
    '    COUNT += 1',
    'def shadow():',
    '    NAMES = 3',
    '    return NAMES',
    'def reads():',
    '    NAMES.append("x")',
  ])
  assert.deepEqual(data.functions.put.globals.sort(), ['CACHE', 'COUNT'])
  assert.deepEqual(data.functions.shadow.globals, [])
  assert.deepEqual(v('put', 'CACHE'), { name: 'CACHE', scope: 'global', line: 6, shape: { k: 'dict', key: P('str'), val: P('int') }, src: 'mutation' })
  assert.deepEqual(v('put', 'COUNT').shape, P('int'))
  assert.deepEqual(v('reads', 'NAMES').shape, { k: 'list', of: P('str') })
  assert.equal(frame('shadow').vars[0].scope, 'local')
})

test('literal vs annotation vs ctor strength; records and comprehensions', async () => {
  const { v } = await run([
    'class Pt:',
    '    pass',
    'def f(xs: list[int]):',
    '    a: float = 1',
    '    b = {"url": "u", "open": True}',
    '    c = [x * 2 for x in xs]',
    '    d = {k: str(k) for k in xs}',
    '    e = Pt()',
    '    g = (1, "s")',
    '    h, i = g',
  ])
  assert.deepEqual(v('f', 'a'), { name: 'a', scope: 'local', line: 4, shape: P('float'), src: 'annotation' })
  assert.deepEqual(v('f', 'b').shape, { k: 'record', fields: { url: P('str'), open: P('bool') } })
  assert.deepEqual(v('f', 'c'), { name: 'c', scope: 'local', line: 6, shape: { k: 'list', of: P('int') }, src: 'literal' })
  assert.deepEqual(v('f', 'd').shape, { k: 'dict', key: P('int'), val: P('str') })
  assert.deepEqual(v('f', 'e'), { name: 'e', scope: 'local', line: 8, shape: { k: 'obj', cls: 'm.py::Pt' }, src: 'ctor' })
  assert.deepEqual(v('f', 'g').shape, { k: 'tuple', of: { k: 'union', of: [P('int'), P('str')] }, len: 2 })
  assert.deepEqual([v('f', 'h').shape, v('f', 'i').shape], [P('int'), P('str')])
})

test('call returns: annotation, else join of return expressions, through a chain', async () => {
  const { v } = await run([
    'def a() -> str:',
    '    return 1',
    'def b(flag):',
    '    if flag:',
    '        return [1]',
    '    return None',
    'def c():',
    '    return b(True)',
    'def use():',
    '    x = a()',
    '    y = c()',
    '    z = unknown_thing()',
  ])
  assert.deepEqual(v('use', 'x'), { name: 'x', scope: 'local', line: 10, shape: P('str'), src: 'return' })
  assert.deepEqual(v('use', 'y').shape, { k: 'union', of: [{ k: 'list', of: P('int') }, P('none')] })
  assert.deepEqual(v('use', 'z'), { name: 'z', scope: 'local', line: 12, shape: { k: 'unknown' }, src: 'unknown' })
  assert.deepEqual(v('b', 'flag'), { name: 'flag', scope: 'param', line: 3, shape: P('bool'), src: 'return' })
})

test('fixed point terminates on self-recursion and self-growing values', async () => {
  const { v } = await run([
    'def fact(n):',
    '    return n * fact(n - 1) if n else 1',
    'def grow():',
    '    x = []',
    '    for _ in range(3):',
    '        x = [x]',
    '    return x',
  ])
  assert.deepEqual(v('fact', 'n').shape.k, 'unknown')
  assert.ok(['list', 'union', 'unknown'].includes(v('grow', 'x').shape.k))
})

test('cross-class cycle is a graph; unrelated classes stay null', async () => {
  const { r } = await run([
    'class A:',
    '    def __init__(self):',
    '        self.b: "B | None" = None',
    'class B:',
    '    def __init__(self):',
    '        self.a: "A | None" = None',
    'class Trie:',
    '    def __init__(self):',
    '        self.children: dict[str, "Trie"] = {}',
    'class Plain:',
    '    def __init__(self):',
    '        self.n = 0',
  ])
  assert.equal(r.structures['m.py::A'], 'graph')
  assert.equal(r.structures['m.py::B'], 'graph')
  assert.equal(r.structures['m.py::Trie'], 'tree')
  assert.equal(r.structures['m.py::Plain'], null)
  assert.equal(r.structures['m.py::<module>'], null)
})
