// Frozen contracts shared by map (server) and frontend/graph (canvas).
// Plain ES module, no imports: loads in Node and the browser alike.
// Owned by T0 / the coordinator. Wave-1 agents must NOT edit this file;
// file a change request in tasks/requests/ instead.
//
// Import paths:
//   from map/src/*.js                      -> '../../shared/contracts.js'
//   from frontend/graph/index.js           -> '../../shared/contracts.js'
//   from frontend/graph/components/*.js    -> '../../../shared/contracts.js'
//   from frontend/graph/utils/*.js         -> '../../../shared/contracts.js'
//   from tests/unit/*.js                   -> '../../shared/contracts.js'
// These resolve both on disk (Node tests) and over HTTP (server maps /shared/* to shared/).

// ---------------------------------------------------------------- graph (server -> canvas)

/** One function, method or module-level block.
 * id    = `${file}::${qname}`, e.g. "app/main.py::load_config", "app/config.py::Config.validate"
 * file  = repo-relative, forward slashes
 * line  = 1-based line of the definition
 * params  = source text of the parameter list without parens, whitespace collapsed ("a, b=1")
 * returns = source text of the return annotation, "" if none ("str", "Promise<User>")
 * sig   = hash8(`${params}->${returns}`)
 * body  = hash8(bodyText with every whitespace run collapsed to one space, trimmed)
 * @typedef {{ id: string, name: string, qname: string, file: string, line: number,
 *   kind: 'fn'|'method'|'module', params: string, returns: string,
 *   sig: string, body: string }} CodeNode */

/** A resolved call. id = `${from}>${to}`. Both ends must be node ids in the same graph.
 * @typedef {{ id: string, from: string, to: string, kind: 'call' }} CodeEdge */

/** root = absolute path of the watched repo. builtAt = epoch ms. errors = human-readable parse errors.
 * @typedef {{ version: 1, root: string, builtAt: number, nodes: CodeNode[],
 *   edges: CodeEdge[], errors: string[] }} CodeGraph */

// ---------------------------------------------------------------- layout (persisted by server)

/** World coordinates of a box's TOP-LEFT corner.
 * @typedef {{ x: number, y: number }} Pos */

/** nodes:   key = CodeNode.id
 *  groups:  key = directory of the member files ("app", "web/api"), "." for the repo root
 *  orphans: key = the id the node had when it disappeared; body = its body hash; since = epoch ms
 * @typedef {{ version: 1, nodes: Record<string, Pos>,
 *   groups: Record<string, {x:number,y:number,w:number,h:number}>,
 *   orphans: Record<string, Pos & { body: string, since: number }>,
 *   camera?: { x: number, y: number, k: number } }} Layout */

/** A partial layout. Record entries are merged key by key; a value of null DELETES that key.
 * Apply with applyLayoutPatch(). Top-level `version` is ignored.
 * @typedef {{ nodes?: Record<string, Pos|null>, groups?: Record<string, object|null>,
 *   orphans?: Record<string, object|null>, camera?: {x:number,y:number,k:number} }} LayoutPatch */

// ---------------------------------------------------------------- scene (merge -> canvas)

/** w/h are NODE_W/NODE_H in functions mode. changed = sig differs from the previous graph.
 * @typedef {CodeNode & Pos & { w: number, h: number, changed: boolean }} SceneNode */
/** id = the directory key (same as Layout.groups), title = directory shown top-left.
 * @typedef {{ id: string, title: string, x: number, y: number, w: number, h: number }} SceneGroup */
/** total = node count of the full CodeGraph (before any ceiling).
 * mode 'files': one SceneNode per file (id = file path, kind 'module', name = basename,
 *   qname = file, line = 1, params = `${n} functions`, returns = "", sig = body = ""),
 *   edges aggregated per file pair (id = `${fromFile}>${toFile}`), layoutPatch = {} (never saved).
 * @typedef {{ mode: 'functions'|'files', nodes: SceneNode[], groups: SceneGroup[],
 *   edges: CodeEdge[], layoutPatch: LayoutPatch, total: number }} Scene */

// ---------------------------------------------------------------- drawing

/** Anything the canvas draws. bounds() is in world coordinates.
 * @typedef {{ draw(ctx: CanvasRenderingContext2D, view: View): void,
 *   bounds(): {x:number,y:number,w:number,h:number} }} Drawable */
/** k = camera zoom. showLabels = k >= LABEL_MIN_ZOOM. ctx is already transformed to world space.
 * @typedef {{ k: number, showLabels: boolean }} View */

// ---------------------------------------------------------------- SSE payloads

/** event 'hello':  { root: string }
 *  event 'graph':  CodeGraph
 *  event 'status': StatusEvent
 * @typedef {{ reason: 'start'|'change'|'error', at: number, ms: number, changed: number }} StatusEvent
 *   reason: why the rebuild ran; at: epoch ms when it finished; ms: build duration;
 *   changed: number of files re-parsed (0 on a cache-only rebuild). */

// ---------------------------------------------------------------- constants

export const NODE_W = 200, NODE_H = 56, GRID = 25, NODE_GAP = 25
export const GROUP_PAD = 25, CULL_MARGIN = 200, LABEL_MIN_ZOOM = 0.4, NODE_CEILING = 5000
export const SAVE_DEBOUNCE_MS = 500, RING_MS = 2400
export const NODE_KINDS = Object.freeze(['fn', 'method', 'module'])
export const SSE_EVENTS = Object.freeze(['hello', 'graph', 'status'])

// ---------------------------------------------------------------- helpers

export const nodeId = (file, qname) => `${file}::${qname}`
export const edgeId = (from, to) => `${from}>${to}`
/** Directory key of a repo-relative file: "app/main.py" -> "app", "main.py" -> "." */
export function dirOf(file) {
  const i = file.lastIndexOf('/')
  return i < 0 ? '.' : file.slice(0, i)
}

export function emptyLayout() { return { version: 1, nodes: {}, groups: {}, orphans: {} } }

/** True when a LayoutPatch would change nothing. */
export function isEmptyPatch(patch) {
  if (!patch) return true
  if (patch.camera) return false
  return ['nodes', 'groups', 'orphans'].every(k => !patch[k] || Object.keys(patch[k]).length === 0)
}

/** Returns a new Layout with `patch` applied (null values delete keys). Does not mutate inputs. */
export function applyLayoutPatch(layout, patch) {
  const out = {
    version: 1,
    nodes: { ...layout.nodes }, groups: { ...layout.groups }, orphans: { ...layout.orphans },
  }
  if (layout.camera) out.camera = { ...layout.camera }
  if (!patch) return out
  for (const k of ['nodes', 'groups', 'orphans']) {
    for (const [key, v] of Object.entries(patch[k] || {})) {
      if (v === null) delete out[k][key]
      else out[k][key] = { ...v }
    }
  }
  if (patch.camera) out.camera = { ...patch.camera }
  return out
}

/** Merges patch b onto patch a (later wins, null deletions preserved). */
export function combinePatches(a, b) {
  const out = {}
  for (const k of ['nodes', 'groups', 'orphans']) {
    if ((a && a[k]) || (b && b[k])) out[k] = { ...(a && a[k]), ...(b && b[k]) }
  }
  const cam = (b && b.camera) || (a && a.camera)
  if (cam) out.camera = { ...cam }
  return out
}

// ---------------------------------------------------------------- validators
// Each throws Error(`<path>: <problem>`) on the first bad field, and returns its input on success.

const HASH8 = /^[0-9a-f]{8}$/
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = v => typeof v === 'number' && Number.isFinite(v)
function fail(path, msg) { throw new Error(`${path}: ${msg}`) }
function need(cond, path, msg) { if (!cond) fail(path, msg) }
function str(v, path) { need(typeof v === 'string', path, `expected string, got ${typeof v}`) }
function num(v, path) { need(isNum(v), path, `expected finite number, got ${JSON.stringify(v)}`) }

export function validateGraph(g) {
  need(isObj(g), 'graph', 'expected object')
  need(g.version === 1, 'graph.version', `expected 1, got ${JSON.stringify(g.version)}`)
  str(g.root, 'graph.root')
  num(g.builtAt, 'graph.builtAt')
  need(Array.isArray(g.nodes), 'graph.nodes', 'expected array')
  need(Array.isArray(g.edges), 'graph.edges', 'expected array')
  need(Array.isArray(g.errors), 'graph.errors', 'expected array')
  g.errors.forEach((e, i) => str(e, `graph.errors[${i}]`))

  const ids = new Set()
  g.nodes.forEach((n, i) => {
    const p = `graph.nodes[${i}]`
    need(isObj(n), p, 'expected object')
    for (const f of ['id', 'name', 'qname', 'file', 'params', 'returns', 'sig', 'body']) str(n[f], `${p}.${f}`)
    need(Number.isInteger(n.line) && n.line >= 1, `${p}.line`, `expected integer >= 1, got ${JSON.stringify(n.line)}`)
    need(NODE_KINDS.includes(n.kind), `${p}.kind`, `expected one of ${NODE_KINDS.join('|')}, got ${JSON.stringify(n.kind)}`)
    need(n.id === nodeId(n.file, n.qname), `${p}.id`, `expected "${nodeId(n.file, n.qname)}", got "${n.id}"`)
    need(!n.file.includes('\\'), `${p}.file`, 'must use forward slashes')
    need(HASH8.test(n.sig), `${p}.sig`, `expected 8 lowercase hex chars, got "${n.sig}"`)
    need(HASH8.test(n.body), `${p}.body`, `expected 8 lowercase hex chars, got "${n.body}"`)
    need(!ids.has(n.id), `${p}.id`, `duplicate id "${n.id}"`)
    ids.add(n.id)
  })

  const eids = new Set()
  g.edges.forEach((e, i) => {
    const p = `graph.edges[${i}]`
    need(isObj(e), p, 'expected object')
    for (const f of ['id', 'from', 'to']) str(e[f], `${p}.${f}`)
    need(e.kind === 'call', `${p}.kind`, `expected "call", got ${JSON.stringify(e.kind)}`)
    need(e.id === edgeId(e.from, e.to), `${p}.id`, `expected "${edgeId(e.from, e.to)}", got "${e.id}"`)
    need(ids.has(e.from), `${p}.from`, `unknown node "${e.from}"`)
    need(ids.has(e.to), `${p}.to`, `unknown node "${e.to}"`)
    need(!eids.has(e.id), `${p}.id`, `duplicate id "${e.id}"`)
    eids.add(e.id)
  })
  return g
}

function pos(v, p) {
  need(isObj(v), p, 'expected object')
  num(v.x, `${p}.x`); num(v.y, `${p}.y`)
}
function rect(v, p) {
  pos(v, p)
  num(v.w, `${p}.w`); num(v.h, `${p}.h`)
  need(v.w >= 0 && v.h >= 0, p, 'w and h must be >= 0')
}
function orphan(v, p) {
  pos(v, p)
  str(v.body, `${p}.body`)
  num(v.since, `${p}.since`)
}
function camera(v, p) {
  pos(v, p)
  num(v.k, `${p}.k`)
  need(v.k > 0, `${p}.k`, 'must be > 0')
}
function record(v, p, check, allowNull) {
  need(isObj(v), p, 'expected object')
  for (const [k, e] of Object.entries(v)) {
    if (allowNull && e === null) continue
    check(e, `${p}[${JSON.stringify(k)}]`)
  }
}

export function validateLayout(l) {
  need(isObj(l), 'layout', 'expected object')
  need(l.version === 1, 'layout.version', `expected 1, got ${JSON.stringify(l.version)}`)
  record(l.nodes, 'layout.nodes', pos, false)
  record(l.groups, 'layout.groups', rect, false)
  record(l.orphans, 'layout.orphans', orphan, false)
  if (l.camera !== undefined) camera(l.camera, 'layout.camera')
  return l
}

export function validateLayoutPatch(patch) {
  need(isObj(patch), 'patch', 'expected object')
  if (patch.nodes !== undefined) record(patch.nodes, 'patch.nodes', pos, true)
  if (patch.groups !== undefined) record(patch.groups, 'patch.groups', rect, true)
  if (patch.orphans !== undefined) record(patch.orphans, 'patch.orphans', orphan, true)
  if (patch.camera !== undefined) camera(patch.camera, 'patch.camera')
  return patch
}
