// L3 test helper: loads web-tree-sitter + the python grammar the same way map/src/extract.js does,
// runs extractPythonData over a set of files, and builds the resolvers/graphs the tests need.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { extractPythonData } from '../../../map/src/extract-data.js'
import { nodeId, moduleClassId } from '../../../shared/contracts.js'

// resolve from map/src so we pick up map/node_modules, exactly like extract.js
const require = createRequire(new URL('../../../map/src/extract.js', import.meta.url))
let parserPromise = null

async function loadParser() {
  const Parser = (await import(pathToFileURL(require.resolve('web-tree-sitter')).href)).default
  await Parser.init()
  const lang = await Parser.Language.load(require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm'))
  const parser = new Parser()
  parser.setLanguage(lang)
  return parser
}

/** Parses Python source and returns extractPythonData(root). */
export async function extractSource(source) {
  if (!parserPromise) parserPromise = loadParser()
  const parser = await parserPromise
  const tree = parser.parse(source)
  try { return extractPythonData(tree.rootNode) } finally { tree.delete() }
}

/** Every .py file under root, repo-relative with forward slashes -> extractPythonData output. */
export async function extractRepo(root) {
  const out = {}
  for (const rel of listPy(root, '')) out[rel] = await extractSource(readFileSync(join(root, rel), 'utf8'))
  return out
}

function listPy(root, rel) {
  const files = []
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name
    if (statSync(join(root, r)).isDirectory()) files.push(...listPy(root, r))
    else if (name.endsWith('.py')) files.push(r)
  }
  return files
}

/** resolveClass over CodeClass[]: same-file qname first, then a unique class name repo-wide. */
export function makeResolveClass(classes) {
  const real = classes.filter(c => c.kind === 'class')
  return (file, text) => {
    const name = String(text).trim().replace(/^['"]|['"]$/g, '')
    const same = real.find(c => c.file === file && c.qname === name)
    if (same) return same.id
    const last = name.split('.').pop()
    const hits = real.filter(c => c.name === last)
    return hits.length === 1 ? hits[0].id : null
  }
}

/** A minimal CodeGraph (nodes/edges/classes) synthesised from extract output, for repos without a fixture. */
export function synthGraph(dataByFile) {
  const classes = [], nodes = []
  for (const [file, d] of Object.entries(dataByFile)) {
    const cq = Object.keys(d.classFields)
    classes.push({ id: moduleClassId(file), name: file.split('/').pop(), qname: '<module>', file, line: 1, kind: 'module', bases: [], fields: [], methods: [] })
    for (const q of cq) classes.push({ id: nodeId(file, q), name: q.split('.').pop(), qname: q, file, line: 1, kind: 'class', bases: [], fields: [], methods: [] })
    for (const [q, fn] of Object.entries(d.functions)) {
      const owner = cq.filter(c => q.startsWith(`${c}.`)).sort((a, b) => b.length - a.length)[0]
      nodes.push({
        id: nodeId(file, q), name: q.split('.').pop(), qname: q, file, line: fn.line,
        kind: owner && q.split('.').length === owner.split('.').length + 1 ? 'method' : 'fn',
        cls: owner ? nodeId(file, owner) : moduleClassId(file), params: '', returns: fn.returnType,
      })
    }
  }
  const edges = []
  const seen = new Set()
  for (const [file, d] of Object.entries(dataByFile)) {
    for (const [q, fn] of Object.entries(d.functions)) {
      for (const call of fn.calls) {
        const to = resolveCall(nodes, classes, file, call)
        const id = `${nodeId(file, q)}>${to}`
        if (to && !seen.has(id)) { seen.add(id); edges.push({ id, from: nodeId(file, q), to, kind: 'call' }) }
      }
    }
  }
  return { nodes, edges, classes }
}

function resolveCall(nodes, classes, file, call) {
  const cls = classes.filter(c => c.kind === 'class' && c.name === call.callee)
  if (cls.length === 1) return nodes.find(n => n.qname === `${cls[0].qname}.__init__` && n.file === cls[0].file)?.id || null
  const same = nodes.filter(n => n.name === call.callee && n.file === file)
  if (same.length === 1) return same[0].id
  const all = nodes.filter(n => n.name === call.callee)
  return all.length === 1 ? all[0].id : null
}
