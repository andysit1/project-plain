// Regenerates shared/fixtures/*.json deterministically. Run: npm run fixtures
// Hash rules match shared/contracts.js: sig = hash8(`${params}->${returns}`),
// body = hash8(body text with whitespace collapsed).
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NODE_W, NODE_H, GROUP_PAD, nodeId, edgeId, dirOf, validateGraph, validateLayout,
} from '../contracts.js'

const here = dirname(fileURLToPath(import.meta.url))
const hash8 = s => createHash('sha1').update(s).digest('hex').slice(0, 8)
const collapse = s => s.replace(/\s+/g, ' ').trim()
const ROOT = '/fixtures/demo-repo'
const BUILT_AT = 1758700000000

function fn(file, qname, line, params, returns, body, kind = 'fn') {
  const name = qname.split('.').pop()
  return {
    id: nodeId(file, qname), name, qname, file, line, kind, params, returns,
    sig: hash8(`${params}->${returns}`), body: hash8(collapse(body)),
  }
}
const call = (from, to) => ({ id: edgeId(from, to), from, to, kind: 'call' })
function graph(nodes, pairs, builtAt = BUILT_AT) {
  const byName = Object.fromEntries(nodes.map(n => [n.qname, n.id]))
  const edges = pairs.map(([a, b]) => call(byName[a], byName[b]))
  return validateGraph({ version: 1, root: ROOT, builtAt, nodes, edges, errors: [] })
}

// ------------------------------------------------------------------ small (15 functions)
const smallNodes = [
  fn('app/main.py', 'main', 5, '', 'None', 'cfg = load_config() run(cfg)'),
  fn('app/main.py', 'run', 10, 'cfg', 'None', 'db = connect(cfg.url) query(db, slugify(cfg.name)) close(db)'),
  fn('app/config.py', 'load_config', 8, 'path=".env"', 'Config', 'env = parse_env(read_file(path)) return Config(env).validate()'),
  fn('app/config.py', 'parse_env', 20, 'text', 'dict', 'return dict(l.split("=", 1) for l in text.splitlines() if "=" in l)'),
  fn('app/config.py', 'Config.validate', 30, 'self', 'Config', 'assert self.url return self', 'method'),
  fn('app/utils.py', 'read_file', 3, 'path', 'str', 'with open(path) as f: return f.read()'),
  fn('app/utils.py', 'slugify', 8, 'text', 'str', 'return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")'),
  fn('app/utils.py', 'retry', 12, 'fn, times=3', 'Any', 'for i in range(times): try: return fn() except OSError: sleep(2 ** i)'),
  fn('app/db.py', 'connect', 4, 'url', 'Conn', 'conn = retry(lambda: sqlite3.connect(url)) query(conn, "SELECT 1") return conn'),
  fn('app/db.py', 'query', 12, 'conn, sql', 'list', 'if conn is None: conn = connect(DEFAULT) return retry(lambda: conn.execute(sql).fetchall())'),
  fn('app/db.py', 'close', 20, 'conn', 'None', 'conn.close()'),
  fn('web/api.ts', 'fetchUser', 3, 'id: string', 'Promise<User>', 'return request(`/users/${id}`)'),
  fn('web/api.ts', 'fetchPosts', 7, 'userId: string', 'Promise<Post[]>', 'return request(`/users/${userId}/posts`)'),
  fn('web/client.ts', 'request', 5, 'path: string', 'Promise<any>', 'const res = await fetch(buildUrl(path)); return res.json()'),
  fn('web/client.ts', 'buildUrl', 12, 'path: string', 'string', 'return BASE + path'),
]
const smallCalls = [
  ['main', 'load_config'], ['main', 'run'],
  ['run', 'connect'], ['run', 'query'], ['run', 'close'], ['run', 'slugify'],
  ['load_config', 'parse_env'], ['load_config', 'read_file'], ['load_config', 'Config.validate'],
  ['connect', 'retry'], ['connect', 'query'], ['query', 'connect'], ['query', 'retry'],
  ['fetchUser', 'request'], ['fetchPosts', 'request'], ['request', 'buildUrl'],
]
const small = graph(smallNodes, smallCalls)

// v2: header change (parse_env), new function (chunk), deletion (close), rename (slugify -> make_slug, same body)
const v2Nodes = smallNodes
  .filter(n => n.qname !== 'close')
  .map(n => {
    if (n.qname === 'parse_env') return fn(n.file, 'parse_env', 20, 'text, strict=False', 'dict', 'return dict(l.split("=", 1) for l in text.splitlines() if "=" in l)')
    if (n.qname === 'slugify') return { ...fn(n.file, 'make_slug', 8, 'text', 'str', 'x'), body: n.body }
    return n
  })
v2Nodes.splice(v2Nodes.findIndex(n => n.qname === 'retry') + 1, 0,
  fn('app/utils.py', 'chunk', 20, 'text, size=4096', 'list', 'return [text[i:i + size] for i in range(0, len(text), size)]'))
const v2Calls = smallCalls
  .filter(([a, b]) => a !== 'close' && b !== 'close')
  .map(([a, b]) => [a === 'slugify' ? 'make_slug' : a, b === 'slugify' ? 'make_slug' : b])
  .concat([['read_file', 'chunk']])
const smallV2 = graph(v2Nodes, v2Calls, BUILT_AT + 60_000)

// layout for the small graph: one column per file, files side by side, a group per directory
const files = [...new Set(smallNodes.map(n => n.file))]
const layoutNodes = {}
files.forEach((file, col) => {
  const members = smallNodes.filter(n => n.file === file)
  const gapForWeb = file.startsWith('web/') ? 100 : 0
  members.forEach((n, row) => {
    layoutNodes[n.id] = { x: col * (NODE_W + 75) + gapForWeb, y: row * (NODE_H + 44) }
  })
})
const layoutGroups = {}
for (const dir of [...new Set(smallNodes.map(n => dirOf(n.file)))]) {
  const ps = smallNodes.filter(n => dirOf(n.file) === dir).map(n => layoutNodes[n.id])
  const x0 = Math.min(...ps.map(p => p.x)) - GROUP_PAD, y0 = Math.min(...ps.map(p => p.y)) - GROUP_PAD
  const x1 = Math.max(...ps.map(p => p.x + NODE_W)) + GROUP_PAD, y1 = Math.max(...ps.map(p => p.y + NODE_H)) + GROUP_PAD
  layoutGroups[dir] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const layoutSmall = validateLayout({
  version: 1, nodes: layoutNodes, groups: layoutGroups, orphans: {}, camera: { x: 80, y: 80, k: 1 },
})

// ------------------------------------------------------------------ large (6,000 functions, 400 files)
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const largeNodes = []
for (let f = 0; f < 400; f++) {
  const file = `pkg${String(Math.floor(f / 20)).padStart(2, '0')}/mod${String(f % 20).padStart(2, '0')}.py`
  for (let i = 0; i < 15; i++) {
    largeNodes.push(fn(file, `f${f}_${i}`, 1 + i * 6, 'a, b', 'int', `return a + b + ${f * 15 + i}`))
  }
}
const largeEdges = new Map()
largeNodes.forEach((n, i) => {
  for (let k = 0; k < 2; k++) {
    // mostly local calls, some cross-file
    const j = rand() < 0.7 ? Math.floor(i / 15) * 15 + Math.floor(rand() * 15) : Math.floor(rand() * largeNodes.length)
    if (j !== i) { const e = call(n.id, largeNodes[j].id); largeEdges.set(e.id, e) }
  }
})
const large = validateGraph({ version: 1, root: '/fixtures/large-repo', builtAt: BUILT_AT, nodes: largeNodes, edges: [...largeEdges.values()], errors: [] })

// ------------------------------------------------------------------ write
const out = { 'graph.small.json': small, 'graph.small.v2.json': smallV2, 'graph.large.json': large, 'layout.small.json': layoutSmall }
for (const [name, data] of Object.entries(out)) {
  writeFileSync(join(here, name), name === 'graph.large.json' ? JSON.stringify(data) : JSON.stringify(data, null, 2) + '\n')
  console.log(`wrote ${name}`)
}
