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
 * classes / classEdges / frames are the LAYERS additions (see "layers" below). They are optional so
 * v1 producers and fixtures stay valid; a layers-aware server always emits all three (possibly empty).
 * CodeNode may also carry `cls`: the CodeClass id of its innermost enclosing class; functions
 * outside any class (including the '<module>' node) use moduleClassId(file). Non-Python: null.
 * @typedef {{ version: 1, root: string, builtAt: number, nodes: CodeNode[],
 *   edges: CodeEdge[], errors: string[],
 *   classes?: CodeClass[], classEdges?: ClassEdge[], frames?: Record<string, Frame> }} CodeGraph */

// ---------------------------------------------------------------- layers (L1 classes, L3 data)
// Python only for now: other languages produce no classes and no frames.

/** A data shape (L3). Recursion through classes is broken by {k:'obj'}: an instance refers to its
 * class by id, and the class's fields carry their own shapes.
 * @typedef {{ k: 'prim', t: 'int'|'float'|'str'|'bool'|'bytes'|'none' }
 *   | { k: 'list'|'set'|'tuple', of: Shape, len?: number }
 *   | { k: 'dict', key: Shape, val: Shape }
 *   | { k: 'record', fields: Record<string, Shape> }
 *   | { k: 'obj', cls: string }
 *   | { k: 'union', of: Shape[] }
 *   | { k: 'unknown' }} Shape */

/** Where a shape came from, strongest first. 'runtime' = captured by the tracer.
 * @typedef {'annotation'|'literal'|'ctor'|'mutation'|'return'|'runtime'|'unknown'} ShapeSrc */

/** One class field. type = annotation / constructor source text ("" if none). shape is filled by infer.
 * @typedef {{ name: string, type: string, line: number, shape?: Shape, src?: ShapeSrc }} ClassField */

/** One class (kind 'class'), or one file's module-level functions grouped as a pseudo-class
 * (kind 'module', qname '<module>', name = file basename, id = moduleClassId(file)).
 * id = nodeId(file, qname). bases = raw base-class source text ("BaseConfig", "Generic[T]").
 * methods = CodeNode ids whose `cls` is this class.
 * structure = recursive data structure detected from self-referencing fields (null if none).
 * @typedef {{ id: string, name: string, qname: string, file: string, line: number,
 *   kind: 'class'|'module', bases: string[], fields: ClassField[], methods: string[],
 *   structure?: null|'linked-list'|'doubly-linked-list'|'tree'|'graph' }} CodeClass */

/** An edge between two CodeClass ids. id = classEdgeId(from, to, kind). weight = how many
 * underlying facts produced it (call edges for 'uses', fields for 'composes', ...), >= 1.
 * @typedef {{ id: string, from: string, to: string,
 *   kind: 'inherits'|'composes'|'instantiates'|'uses', weight: number }} ClassEdge */

/** A parameter / local / touched global / self field of one function (L3 frame view).
 * @typedef {{ name: string, scope: 'param'|'local'|'global'|'self', line: number,
 *   shape: Shape, src: ShapeSrc }} FrameVar */

/** A loop and what it walks. over = the iterated variable name ("d.items()" -> "d"),
 * var = the loop target ("row", "k, v"), step = for while-loops that advance a pointer
 * ("node = node.next" -> "next"). Unknown parts are "".
 * @typedef {{ kind: 'for'|'while', line: number, var: string, over: string, step: string }} Loop */

/** Keyed by CodeNode id in CodeGraph.frames.
 * @typedef {{ vars: FrameVar[], loops: Loop[] }} Frame */

// ---------------------------------------------------------------- layout (persisted by server)

/** World coordinates of a box's TOP-LEFT corner.
 * @typedef {{ x: number, y: number }} Pos */

/** nodes:   key = CodeNode.id
 *  groups:  key = directory of the member files ("app", "web/api"), "." for the repo root
 *  orphans: key = the id the node had when it disappeared; body = its body hash; since = epoch ms
 *  classes: key = CodeClass.id; positions in the L1 classes layer. Optional, and a separate
 *           namespace so moving a class box never moves a function box. L3 is never saved.
 * @typedef {{ version: 1, nodes: Record<string, Pos>,
 *   groups: Record<string, {x:number,y:number,w:number,h:number}>,
 *   orphans: Record<string, Pos & { body: string, since: number }>,
 *   classes?: Record<string, Pos>,
 *   camera?: { x: number, y: number, k: number } }} Layout */

/** A partial layout. Record entries are merged key by key; a value of null DELETES that key.
 * Apply with applyLayoutPatch(). Top-level `version` is ignored.
 * @typedef {{ nodes?: Record<string, Pos|null>, groups?: Record<string, object|null>,
 *   orphans?: Record<string, object|null>, classes?: Record<string, Pos|null>,
 *   camera?: {x:number,y:number,k:number} }} LayoutPatch */

// ---------------------------------------------------------------- scene (merge -> canvas)

/** w/h are NODE_W/NODE_H in functions mode. changed = sig differs from the previous graph.
 * @typedef {CodeNode & Pos & { w: number, h: number, changed: boolean }} SceneNode */
/** id = the directory key (same as Layout.groups), title = directory shown top-left.
 * @typedef {{ id: string, title: string, x: number, y: number, w: number, h: number }} SceneGroup */
/** total = node count of the full CodeGraph (before any ceiling).
 * mode 'files': one SceneNode per file (id = file path, kind 'module', name = basename,
 *   qname = file, line = 1, params = `${n} functions`, returns = "", sig = body = ""),
 *   edges aggregated per file pair (id = `${fromFile}>${toFile}`), layoutPatch = {} (never saved).
 * mode 'classes': one SceneNode per CodeClass: id/name/qname/file/line from the class,
 *   kind 'module' for module pseudo-classes and 'method' for real classes (NODE_KINDS unchanged),
 *   params = `${fields.length} fields · ${methods.length} methods`, returns = bases.join(', '),
 *   sig = body = "", w = NODE_W, h = class box height; edges = the ClassEdges;
 *   layoutPatch only ever touches `classes`.
 * @typedef {{ mode: 'functions'|'files'|'classes', nodes: SceneNode[], groups: SceneGroup[],
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
export const LAYERS = Object.freeze(['classes', 'functions', 'data'])
export const CLASS_KINDS = Object.freeze(['class', 'module'])
export const CLASS_EDGE_KINDS = Object.freeze(['inherits', 'composes', 'instantiates', 'uses'])
export const SHAPE_KINDS = Object.freeze(['prim', 'list', 'set', 'tuple', 'dict', 'record', 'obj', 'union', 'unknown'])
export const PRIM_TYPES = Object.freeze(['int', 'float', 'str', 'bool', 'bytes', 'none'])
export const SHAPE_SRCS = Object.freeze(['annotation', 'literal', 'ctor', 'mutation', 'return', 'runtime', 'unknown'])
export const FRAME_SCOPES = Object.freeze(['param', 'local', 'global', 'self'])
export const STRUCTURES = Object.freeze(['linked-list', 'doubly-linked-list', 'tree', 'graph'])
/** Opacity of nodes/edges outside the highlight set (L1 -> L2 drill-down). */
export const DIM_ALPHA = 0.3

// ---------------------------------------------------------------- helpers

export const nodeId = (file, qname) => `${file}::${qname}`
export const edgeId = (from, to) => `${from}>${to}`
export const classEdgeId = (from, to, kind) => `${from}>${to}:${kind}`
/** Id of a file's module pseudo-class. */
export const moduleClassId = (file) => nodeId(file, '<module>')
/** Directory key of a repo-relative file: "app/main.py" -> "app", "main.py" -> "." */
export function dirOf(file) {
  const i = file.lastIndexOf('/')
  return i < 0 ? '.' : file.slice(0, i)
}

export function emptyLayout() { return { version: 1, nodes: {}, groups: {}, orphans: {} } }

// Record-valued Layout keys that patches merge key by key. `classes` is optional in a Layout.
const PATCH_KEYS = ['nodes', 'groups', 'orphans', 'classes']

/** True when a LayoutPatch would change nothing. */
export function isEmptyPatch(patch) {
  if (!patch) return true
  if (patch.camera) return false
  return PATCH_KEYS.every(k => !patch[k] || Object.keys(patch[k]).length === 0)
}

/** Returns a new Layout with `patch` applied (null values delete keys). Does not mutate inputs.
 * `camera` is the functions-layer camera; the classes layer fits to content and is not saved. */
export function applyLayoutPatch(layout, patch) {
  const out = {
    version: 1,
    nodes: { ...layout.nodes }, groups: { ...layout.groups }, orphans: { ...layout.orphans },
  }
  if (layout.classes || (patch && patch.classes)) out.classes = { ...layout.classes }
  if (layout.camera) out.camera = { ...layout.camera }
  if (!patch) return out
  for (const k of PATCH_KEYS) {
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
  for (const k of PATCH_KEYS) {
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
    if (n.cls !== undefined) need(n.cls === null || typeof n.cls === 'string', `${p}.cls`, 'expected string or null')
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

  const cids = new Set()
  if (g.classes !== undefined) {
    need(Array.isArray(g.classes), 'graph.classes', 'expected array')
    g.classes.forEach((c, i) => {
      const p = `graph.classes[${i}]`
      need(isObj(c), p, 'expected object')
      for (const f of ['id', 'name', 'qname', 'file']) str(c[f], `${p}.${f}`)
      need(Number.isInteger(c.line) && c.line >= 1, `${p}.line`, `expected integer >= 1, got ${JSON.stringify(c.line)}`)
      need(CLASS_KINDS.includes(c.kind), `${p}.kind`, `expected one of ${CLASS_KINDS.join('|')}, got ${JSON.stringify(c.kind)}`)
      need(c.id === nodeId(c.file, c.qname), `${p}.id`, `expected "${nodeId(c.file, c.qname)}", got "${c.id}"`)
      need(!cids.has(c.id), `${p}.id`, `duplicate id "${c.id}"`)
      cids.add(c.id)
      need(Array.isArray(c.bases), `${p}.bases`, 'expected array')
      c.bases.forEach((b, j) => str(b, `${p}.bases[${j}]`))
      need(Array.isArray(c.fields), `${p}.fields`, 'expected array')
      c.fields.forEach((f, j) => {
        const fp = `${p}.fields[${j}]`
        need(isObj(f), fp, 'expected object')
        str(f.name, `${fp}.name`)
        str(f.type, `${fp}.type`)
        need(Number.isInteger(f.line) && f.line >= 1, `${fp}.line`, 'expected integer >= 1')
        if (f.shape !== undefined) validateShape(f.shape, `${fp}.shape`)
        if (f.src !== undefined) need(SHAPE_SRCS.includes(f.src), `${fp}.src`, `unknown src ${JSON.stringify(f.src)}`)
      })
      need(Array.isArray(c.methods), `${p}.methods`, 'expected array')
      c.methods.forEach((m, j) => need(ids.has(m), `${p}.methods[${j}]`, `unknown node "${m}"`))
      if (c.structure !== undefined && c.structure !== null) {
        need(STRUCTURES.includes(c.structure), `${p}.structure`, `expected one of ${STRUCTURES.join('|')}`)
      }
    })
    g.nodes.forEach((n, i) => {
      if (n.cls) need(cids.has(n.cls), `graph.nodes[${i}].cls`, `unknown class "${n.cls}"`)
    })
  }

  if (g.classEdges !== undefined) {
    need(Array.isArray(g.classEdges), 'graph.classEdges', 'expected array')
    const ceids = new Set()
    g.classEdges.forEach((e, i) => {
      const p = `graph.classEdges[${i}]`
      need(isObj(e), p, 'expected object')
      for (const f of ['id', 'from', 'to']) str(e[f], `${p}.${f}`)
      need(CLASS_EDGE_KINDS.includes(e.kind), `${p}.kind`, `expected one of ${CLASS_EDGE_KINDS.join('|')}, got ${JSON.stringify(e.kind)}`)
      need(e.id === classEdgeId(e.from, e.to, e.kind), `${p}.id`, `expected "${classEdgeId(e.from, e.to, e.kind)}", got "${e.id}"`)
      need(cids.has(e.from), `${p}.from`, `unknown class "${e.from}"`)
      need(cids.has(e.to), `${p}.to`, `unknown class "${e.to}"`)
      need(Number.isInteger(e.weight) && e.weight >= 1, `${p}.weight`, 'expected integer >= 1')
      need(!ceids.has(e.id), `${p}.id`, `duplicate id "${e.id}"`)
      ceids.add(e.id)
    })
  }

  if (g.frames !== undefined) {
    need(isObj(g.frames), 'graph.frames', 'expected object')
    for (const [id, fr] of Object.entries(g.frames)) {
      const p = `graph.frames[${JSON.stringify(id)}]`
      need(ids.has(id), p, `unknown node "${id}"`)
      validateFrame(fr, p)
    }
  }
  return g
}

/** Validates one Shape, recursively. */
export function validateShape(s, p = 'shape') {
  need(isObj(s), p, 'expected object')
  need(SHAPE_KINDS.includes(s.k), `${p}.k`, `expected one of ${SHAPE_KINDS.join('|')}, got ${JSON.stringify(s.k)}`)
  switch (s.k) {
    case 'prim':
      need(PRIM_TYPES.includes(s.t), `${p}.t`, `expected one of ${PRIM_TYPES.join('|')}, got ${JSON.stringify(s.t)}`)
      break
    case 'list': case 'set': case 'tuple':
      validateShape(s.of, `${p}.of`)
      if (s.len !== undefined) need(Number.isInteger(s.len) && s.len >= 0, `${p}.len`, 'expected integer >= 0')
      break
    case 'dict':
      validateShape(s.key, `${p}.key`)
      validateShape(s.val, `${p}.val`)
      break
    case 'record':
      need(isObj(s.fields), `${p}.fields`, 'expected object')
      for (const [k, v] of Object.entries(s.fields)) validateShape(v, `${p}.fields.${k}`)
      break
    case 'obj':
      str(s.cls, `${p}.cls`)
      break
    case 'union':
      need(Array.isArray(s.of) && s.of.length >= 2, `${p}.of`, 'expected an array of >= 2 shapes')
      s.of.forEach((x, i) => validateShape(x, `${p}.of[${i}]`))
      break
  }
  return s
}

/** Validates one Frame. */
export function validateFrame(fr, p = 'frame') {
  need(isObj(fr), p, 'expected object')
  need(Array.isArray(fr.vars), `${p}.vars`, 'expected array')
  fr.vars.forEach((v, i) => {
    const vp = `${p}.vars[${i}]`
    need(isObj(v), vp, 'expected object')
    str(v.name, `${vp}.name`)
    need(FRAME_SCOPES.includes(v.scope), `${vp}.scope`, `expected one of ${FRAME_SCOPES.join('|')}, got ${JSON.stringify(v.scope)}`)
    need(Number.isInteger(v.line) && v.line >= 1, `${vp}.line`, 'expected integer >= 1')
    validateShape(v.shape, `${vp}.shape`)
    need(SHAPE_SRCS.includes(v.src), `${vp}.src`, `unknown src ${JSON.stringify(v.src)}`)
  })
  need(Array.isArray(fr.loops), `${p}.loops`, 'expected array')
  fr.loops.forEach((l, i) => {
    const lp = `${p}.loops[${i}]`
    need(isObj(l), lp, 'expected object')
    need(l.kind === 'for' || l.kind === 'while', `${lp}.kind`, `expected "for" or "while", got ${JSON.stringify(l.kind)}`)
    need(Number.isInteger(l.line) && l.line >= 1, `${lp}.line`, 'expected integer >= 1')
    for (const f of ['var', 'over', 'step']) str(l[f], `${lp}.${f}`)
  })
  return fr
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
  if (l.classes !== undefined) record(l.classes, 'layout.classes', pos, false)
  if (l.camera !== undefined) camera(l.camera, 'layout.camera')
  return l
}

export function validateLayoutPatch(patch) {
  need(isObj(patch), 'patch', 'expected object')
  if (patch.nodes !== undefined) record(patch.nodes, 'patch.nodes', pos, true)
  if (patch.groups !== undefined) record(patch.groups, 'patch.groups', rect, true)
  if (patch.orphans !== undefined) record(patch.orphans, 'patch.orphans', orphan, true)
  if (patch.classes !== undefined) record(patch.classes, 'patch.classes', pos, true)
  if (patch.camera !== undefined) camera(patch.camera, 'patch.camera')
  return patch
}
