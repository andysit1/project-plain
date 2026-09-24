// Writes shared/fixtures/graph.classes.json: a hand-built layers graph (classes, classEdges,
// frames) modelled on tests/layers-repo, so the frontend can build L1/L3 before the server does.
// Run: node shared/fixtures/make-classes-fixture.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { nodeId, edgeId, classEdgeId, moduleClassId, validateGraph } from '../contracts.js'

const S = 'app/structures.py'
const C = 'app/config.py'
const hash8 = t => createHash('sha1').update(t).digest('hex').slice(0, 8)

const prim = t => ({ k: 'prim', t })
const obj = cls => ({ k: 'obj', cls })
const opt = s => ({ k: 'union', of: [s, prim('none')] })
const unknown = { k: 'unknown' }

const cid = q => nodeId(S, q)
const classes = []
const nodes = []

function cls(qname, line, bases, fields, methods, structure = null) {
  const id = cid(qname)
  classes.push({ id, name: qname, qname, file: S, line, kind: 'class', bases, fields, methods: [], structure })
  for (const [name, mline, params, returns] of methods) addNode(S, `${qname}.${name}`, name, mline, 'method', params, returns, id)
}
function addNode(file, qname, name, line, kind, params, returns, owner) {
  const id = nodeId(file, qname)
  nodes.push({ id, name, qname, file, line, kind, params, returns, sig: hash8(`${params}->${returns}`), body: hash8(qname), cls: owner })
  classes.find(c => c.id === owner).methods.push(id)
}
const f = (name, type, line, shape, src) => ({ name, type, line, shape, src })

cls('ListNode', 8, [], [
  f('value', 'int', 10, prim('int'), 'annotation'),
  f('next', 'Optional[ListNode]', 11, opt(obj(cid('ListNode'))), 'annotation'),
], [['__init__', 9, 'self, value: int, next: "Optional[ListNode]" = None', '']], 'linked-list')
cls('DNode', 14, [], [
  f('value', '', 16, unknown, 'unknown'),
  f('prev', 'Optional["DNode"]', 17, opt(obj(cid('DNode'))), 'annotation'),
  f('next', 'Optional["DNode"]', 18, opt(obj(cid('DNode'))), 'annotation'),
], [['__init__', 15, 'self, value', '']], 'doubly-linked-list')
cls('TreeNode', 21, [], [
  f('key', 'int', 23, prim('int'), 'annotation'),
  f('left', 'Optional["TreeNode"]', 24, opt(obj(cid('TreeNode'))), 'annotation'),
  f('right', 'Optional["TreeNode"]', 25, opt(obj(cid('TreeNode'))), 'annotation'),
], [['__init__', 22, 'self, key: int', '']], 'tree')
cls('GraphNode', 28, [], [
  f('name', 'str', 30, prim('str'), 'annotation'),
  f('neighbors', 'list["GraphNode"]', 31, { k: 'list', of: obj(cid('GraphNode')) }, 'annotation'),
], [['__init__', 29, 'self, name: str', '']], 'graph')
cls('Point', 35, [], [
  f('x', 'float', 36, prim('float'), 'annotation'),
  f('y', 'float', 37, prim('float'), 'annotation'),
], [])
cls('Polygon', 41, [], [
  f('name', 'str', 42, prim('str'), 'annotation'),
  f('points', 'list[Point]', 43, { k: 'list', of: obj(cid('Point')) }, 'annotation'),
], [])
cls('Shape', 46, [], [], [['area', 47, 'self', 'float']])
cls('Square', 51, ['Shape'], [
  f('side', 'float', 53, prim('float'), 'annotation'),
  f('corner', 'Point', 54, obj(cid('Point')), 'ctor'),
], [['__init__', 52, 'self, side: float', ''], ['area', 56, 'self', 'float']])
cls('Registry', 60, [], [
  f('items', '', 62, { k: 'list', of: obj(cid('Square')) }, 'mutation'),
  f('by_name', '', 63, { k: 'dict', key: prim('str'), val: obj(cid('Square')) }, 'mutation'),
  f('tags', '', 64, { k: 'set', of: prim('str') }, 'mutation'),
  f('root', 'TreeNode', 65, obj(cid('TreeNode')), 'ctor'),
], [['__init__', 61, 'self', ''], ['add', 67, 'self, name, shape', ''], ['build', 73, 'self', '']])

// module pseudo-classes
classes.push({ id: moduleClassId(S), name: 'structures.py', qname: '<module>', file: S, line: 1, kind: 'module', bases: [], fields: [], methods: [] })
classes.push({ id: moduleClassId(C), name: 'config.py', qname: '<module>', file: C, line: 1, kind: 'module', bases: [], fields: [], methods: [] })
addNode(S, 'linked_sum', 'linked_sum', 80, 'fn', 'head: ListNode', 'int', moduleClassId(S))
addNode(S, 'make_list', 'make_list', 89, 'fn', 'values', '', moduleClassId(S))
addNode(S, 'grid', 'grid', 96, 'fn', 'n', '', moduleClassId(S))
addNode(S, 'count_words', 'count_words', 106, 'fn', 'lines: list[str]', 'dict[str, int]', moduleClassId(S))
addNode(C, 'load_config', 'load_config', 4, 'fn', 'path=".env"', '', moduleClassId(C))

const n = q => nodeId(S, q)
const edges = [
  [n('Registry.add'), n('Square.area')],
  [n('Registry.build'), n('Square.__init__')],
  [n('Registry.build'), n('Registry.add')],
  [n('Registry.build'), nodeId(C, 'load_config')],
  [n('Registry.__init__'), n('TreeNode.__init__')],
  [n('make_list'), n('ListNode.__init__')],
].map(([from, to]) => ({ id: edgeId(from, to), from, to, kind: 'call' }))

const ce = (from, to, kind, weight = 1) => ({ id: classEdgeId(from, to, kind), from, to, kind, weight })
const classEdges = [
  ce(cid('Square'), cid('Shape'), 'inherits'),
  ce(cid('Square'), cid('Point'), 'composes'),
  ce(cid('Polygon'), cid('Point'), 'composes'),
  ce(cid('Registry'), cid('TreeNode'), 'composes'),
  ce(cid('Registry'), cid('Square'), 'composes', 2),
  ce(cid('ListNode'), cid('ListNode'), 'composes'),
  ce(cid('DNode'), cid('DNode'), 'composes', 2),
  ce(cid('TreeNode'), cid('TreeNode'), 'composes', 2),
  ce(cid('GraphNode'), cid('GraphNode'), 'composes'),
  ce(cid('Registry'), cid('Square'), 'instantiates'),
  ce(cid('Registry'), cid('TreeNode'), 'instantiates'),
  ce(cid('Square'), cid('Point'), 'instantiates'),
  ce(moduleClassId(S), cid('ListNode'), 'instantiates'),
  ce(cid('Registry'), moduleClassId(C), 'uses'),
]

const v = (name, scope, line, shape, src) => ({ name, scope, line, shape, src })
const intList = { k: 'list', of: prim('int') }
const frames = {
  [n('linked_sum')]: {
    vars: [
      v('head', 'param', 80, obj(cid('ListNode')), 'annotation'),
      v('total', 'local', 81, prim('int'), 'literal'),
      v('node', 'local', 82, opt(obj(cid('ListNode'))), 'mutation'),
    ],
    loops: [{ kind: 'while', line: 83, var: 'node', over: 'node', step: 'next' }],
  },
  [n('grid')]: {
    vars: [
      v('n', 'param', 96, unknown, 'unknown'),
      v('rows', 'local', 97, { k: 'list', of: intList }, 'mutation'),
      v('row', 'local', 99, intList, 'mutation'),
    ],
    loops: [
      { kind: 'for', line: 98, var: 'i', over: 'range(n)', step: '' },
      { kind: 'for', line: 100, var: 'j', over: 'range(n)', step: '' },
    ],
  },
  [n('count_words')]: {
    vars: [
      v('lines', 'param', 106, { k: 'list', of: prim('str') }, 'annotation'),
      v('counts', 'local', 107, { k: 'dict', key: prim('str'), val: prim('int') }, 'mutation'),
    ],
    loops: [
      { kind: 'for', line: 108, var: 'line', over: 'lines', step: '' },
      { kind: 'for', line: 109, var: 'word', over: 'line.split()', step: '' },
    ],
  },
  [n('Registry.add')]: {
    vars: [
      v('name', 'param', 67, prim('str'), 'return'),
      v('shape', 'param', 67, obj(cid('Square')), 'return'),
      v('items', 'self', 68, { k: 'list', of: obj(cid('Square')) }, 'mutation'),
      v('by_name', 'self', 69, { k: 'dict', key: prim('str'), val: obj(cid('Square')) }, 'mutation'),
      v('tags', 'self', 70, { k: 'set', of: prim('str') }, 'mutation'),
    ],
    loops: [],
  },
}

const graph = validateGraph({
  version: 1, root: '/fixtures/layers-repo', builtAt: 1758700000000,
  nodes, edges, errors: [], classes, classEdges, frames,
})
const out = join(dirname(fileURLToPath(import.meta.url)), 'graph.classes.json')
writeFileSync(out, JSON.stringify(graph, null, 2) + '\n')
console.log(`wrote ${out}: ${classes.length} classes, ${nodes.length} nodes, ${classEdges.length} class edges`)
