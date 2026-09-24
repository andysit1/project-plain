// L3 static inference (design doc section 3). Gives every param, local, touched global, self field
// and class field a Shape by abstract interpretation over a small type lattice, iterated to a fixed
// point (max 5 rounds), then classifies self-referencing classes as linked lists / trees / graphs.
// Pure: consumes extractPythonData() output plus CodeGraph nodes/edges/classes; no tree-sitter.
//
// Internally a `bottom` shape means "no evidence yet" (it joins as the identity); tuples may carry
// per-position `items`. Both are stripped by finalize() before anything is returned.

import { nodeId } from '../../shared/contracts.js'

const RANK = { annotation: 0, runtime: 0, literal: 1, ctor: 2, mutation: 3, return: 4, unknown: 5 }
const MAX_ROUNDS = 5, INNER_ROUNDS = 5, MAX_DEPTH = 6, MAX_UNION = 8
const BOTTOM = Object.freeze({ k: 'bottom' })
const UNKNOWN = Object.freeze({ k: 'unknown' })
const prim = t => ({ k: 'prim', t })
const NONE = prim('none')
const ev = (shape, src) => ({ shape, src })
const UNK_EV = ev(UNKNOWN, 'unknown')
const isBottom = s => !s || s.k === 'bottom'
const isKnown = s => !isBottom(s) && s.k !== 'unknown'

// ================================================================ lattice

/** Canonical text of a shape (record fields sorted), used for equality and dedupe. */
function canon(s) {
  if (!s) return 'bottom'
  switch (s.k) {
    case 'prim': return s.t
    case 'list': case 'set': case 'tuple':
      return `${s.k}<${canon(s.of)}${s.items ? `|${s.items.map(canon).join(',')}` : ''}>`
    case 'dict': return `dict<${canon(s.key)},${canon(s.val)}>`
    case 'record': return `{${Object.keys(s.fields).sort().map(k => `${k}:${canon(s.fields[k])}`).join(',')}}`
    case 'obj': return `obj:${s.cls}`
    case 'union': return `(${s.of.map(canon).join('|')})`
    default: return s.k
  }
}
const same = (a, b) => canon(a) === canon(b)

/** Merges two shapes of the same kind when one side only lacks evidence (bottom slots); else null. */
function mergeSameKind(a, b) {
  const slot = (x, y) => isBottom(x) ? y : isBottom(y) ? x : same(x, y) ? x : null
  if (a.k === 'dict' && b.k === 'record' && isBottom(a.key) && isBottom(a.val)) return b
  if (b.k === 'dict' && a.k === 'record' && isBottom(b.key) && isBottom(b.val)) return a
  if (a.k !== b.k) return null
  if (a.k === 'list' || a.k === 'set' || a.k === 'tuple') {
    if (a.items || b.items) return null
    const of = slot(a.of, b.of)
    return of ? { k: a.k, of } : null
  }
  if (a.k === 'dict') {
    const key = slot(a.key, b.key), val = slot(a.val, b.val)
    return key && val ? { k: 'dict', key, val } : null
  }
  return null
}

/** Joins shapes: bottom is the identity, nested unions flatten, duplicates drop, one member collapses. */
export function unionOf(shapes) {
  const flat = []
  const push = s => {
    if (isBottom(s)) return
    if (s.k === 'union') return s.of.forEach(push)
    for (let i = 0; i < flat.length; i++) {
      if (same(flat[i], s)) return
      const m = mergeSameKind(flat[i], s)
      if (m) { flat[i] = m; return }
    }
    flat.push(s)
  }
  shapes.forEach(push)
  if (!flat.length) return BOTTOM
  if (flat.length === 1) return flat[0]
  if (flat.length > MAX_UNION) return UNKNOWN
  return { k: 'union', of: flat }
}
export const joinShapes = (a, b) => unionOf([a, b])

/** Strongest evidence wins; equal strength joins into a union. Unknown shapes are the weakest. */
export function pickStrongest(evs) {
  const known = evs.filter(e => e && isKnown(e.shape))
  if (!known.length) return evs.some(e => e && e.shape.k === 'unknown') ? UNK_EV : ev(BOTTOM, 'unknown')
  const best = Math.min(...known.map(e => RANK[e.src] ?? 5))
  const top = known.filter(e => (RANK[e.src] ?? 5) === best)
  return ev(unionOf(top.map(e => e.shape)), top[0].src)
}

const weaker = (a, b) => (RANK[a] ?? 5) >= (RANK[b] ?? 5) ? a : b
const tupleOf = items => ({ k: 'tuple', of: unionOf(items), len: items.length, items })

/** Caps depth (recursion through obj refs is already cut, this guards list<list<...>> growth). */
function cap(s, depth = 0) {
  if (isBottom(s)) return s
  if (depth >= MAX_DEPTH) return UNKNOWN
  switch (s.k) {
    case 'list': case 'set': case 'tuple': {
      const out = { ...s, of: cap(s.of, depth + 1) }
      if (s.items) out.items = s.items.map(x => cap(x, depth + 1))
      return out
    }
    case 'dict': return { k: 'dict', key: cap(s.key, depth + 1), val: cap(s.val, depth + 1) }
    case 'record': return { k: 'record', fields: mapValues(s.fields, v => cap(v, depth + 1)) }
    case 'union': return unionOf(s.of.map(x => cap(x, depth)))
    default: return s
  }
}

/** Contract-clean copy: bottom -> unknown, tuple `items` dropped, unions re-normalised. */
export function finalize(s) {
  if (isBottom(s)) return { k: 'unknown' }
  switch (s.k) {
    case 'prim': return { k: 'prim', t: s.t }
    case 'list': case 'set': case 'tuple': {
      const out = { k: s.k, of: finalize(s.of) }
      if (s.k === 'tuple' && Number.isInteger(s.len)) out.len = s.len
      return out
    }
    case 'dict': return { k: 'dict', key: finalize(s.key), val: finalize(s.val) }
    case 'record': return { k: 'record', fields: mapValues(s.fields, finalize) }
    case 'obj': return { k: 'obj', cls: s.cls }
    case 'union': {
      const u = unionOf(s.of.map(finalize))
      return u.k === 'union' ? { k: 'union', of: u.of.map(finalize) } : finalize(u)
    }
    default: return { k: 'unknown' }
  }
}
function finalEv(e) {
  const shape = finalize(e ? e.shape : BOTTOM)
  if (shape.k === 'unknown') return { shape, src: 'unknown' }
  return { shape, src: !e.src || e.src === 'unknown' ? 'mutation' : e.src }
}
function mapValues(o, f) {
  const out = {}
  for (const [k, v] of Object.entries(o)) out[k] = f(v)
  return out
}

// ================================================================ type text

const TYPE_PREFIX = /^(typing|typing_extensions|collections\.abc|collections|builtins|t)\./
const LIST_T = new Set(['list', 'List', 'Sequence', 'MutableSequence', 'deque', 'Deque'])
const SET_T = new Set(['set', 'Set', 'frozenset', 'FrozenSet', 'MutableSet', 'AbstractSet'])
const DICT_T = new Set(['dict', 'Dict', 'Mapping', 'MutableMapping', 'defaultdict', 'DefaultDict', 'OrderedDict'])
const WRAP_T = new Set(['Annotated', 'Final', 'ClassVar', 'Required', 'NotRequired', 'ReadOnly'])
const PRIM_T = { int: 'int', float: 'float', str: 'str', bool: 'bool', bytes: 'bytes', bytearray: 'bytes', None: 'none', NoneType: 'none' }

/** Parses annotation text ('list[int]', 'Optional["Node"]', 'X | None', ...) into a Shape.
 * resolveClass(nameText) -> classId | null resolves user class names. */
export function parseTypeText(text, resolveClass = () => null) {
  try { return finalize(parseType(String(text ?? ''), resolveClass, 0)) } catch { return { k: 'unknown' } }
}

function parseType(text, rc, depth) {
  let t = text.trim()
  if (!t || depth > 8) return UNKNOWN
  const q = /^(['"])(.*)\1$/s.exec(t)
  if (q) return parseType(q[2], rc, depth + 1)
  const alts = splitTop(t, '|')
  if (alts.length > 1) return unionOf(alts.map(a => parseType(a, rc, depth + 1)))
  const m = /^([A-Za-z_][\w.]*)\s*(?:\[(.*)\])?$/s.exec(t)
  if (!m) return UNKNOWN
  const args = m[2] === undefined ? null : splitTop(m[2], ',').filter(a => a.trim())
  return fromName(m[1].replace(TYPE_PREFIX, ''), args, m[1], rc, depth)
}

function fromName(name, args, raw, rc, depth) {
  const arg = i => args && args[i] !== undefined ? parseType(args[i], rc, depth + 1) : UNKNOWN
  if (PRIM_T[name]) return prim(PRIM_T[name])
  if (name === 'Optional') return unionOf([arg(0), NONE])
  if (name === 'Union') return unionOf((args || []).map((_, i) => arg(i)))
  if (LIST_T.has(name)) return { k: 'list', of: arg(0) }
  if (SET_T.has(name)) return { k: 'set', of: arg(0) }
  if (DICT_T.has(name)) return { k: 'dict', key: arg(0), val: arg(1) }
  if (name === 'Counter') return { k: 'dict', key: arg(0), val: prim('int') }
  if (WRAP_T.has(name)) return arg(0)
  if (name === 'Literal') return unionOf((args || []).map(literalType))
  if (name === 'tuple' || name === 'Tuple') {
    if (!args || !args.length) return { k: 'tuple', of: UNKNOWN }
    if (args.length === 2 && args[1].trim() === '...') return { k: 'tuple', of: arg(0) }
    return tupleOf(args.map((_, i) => arg(i)))
  }
  const cls = rc(raw) || (raw !== name ? rc(name) : null)
  return cls ? { k: 'obj', cls } : UNKNOWN
}

function literalType(a) {
  const t = a.trim()
  if (/^['"]/.test(t)) return prim('str')
  if (/^b['"]/.test(t)) return prim('bytes')
  if (/^-?\d+$/.test(t)) return prim('int')
  if (t === 'True' || t === 'False') return prim('bool')
  if (t === 'None') return NONE
  return UNKNOWN
}

/** Splits on `sep` at bracket depth 0, outside quotes. */
function splitTop(s, sep) {
  const parts = []
  let depth = 0, quote = '', start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if ('[({'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === sep && depth === 0) { parts.push(s.slice(start, i)); start = i + 1 }
  }
  parts.push(s.slice(start))
  return parts
}

// ================================================================ world

function buildWorld({ nodes, edges, classes, dataByFile, resolveClass }) {
  const w = { rc: resolveClass, dataByFile, allClassIds: classes.map(c => c.id), fns: new Map(), classes: new Map(), modules: new Map(), nodes: new Map(), out: new Map() }
  for (const n of nodes) w.nodes.set(n.id, n)
  for (const c of classes) {
    if (c.kind !== 'class') continue
    w.classes.set(c.id, { id: c.id, cls: c, file: c.file, entries: [], muts: [], state: new Map(), methods: new Map() })
  }
  for (const [file, d] of Object.entries(dataByFile)) {
    if (d) w.modules.set(file, { file, defs: d.moduleVars || {}, assigns: [], muts: [], state: new Map() })
  }
  for (const n of nodes) {
    const data = dataByFile[n.file]?.functions?.[n.qname]
    if (!data) continue
    const C = w.classes.get(n.cls)
    const F = { id: n.id, node: n, file: n.file, data, cls: C ? C.id : null, vars: new Map(), loopVars: new Map(), ret: BOTTOM, callers: [], parent: null }
    for (const p of data.params) F.vars.set(p.name, ev(BOTTOM, 'unknown'))
    for (const l of data.locals) F.vars.set(l.name, ev(BOTTOM, 'unknown'))
    w.fns.set(n.id, F)
    if (C && n.kind === 'method') C.methods.set(n.name, n.id)
  }
  for (const F of w.fns.values()) {
    const i = F.node.qname.lastIndexOf('.')
    if (i > 0) F.parent = w.fns.get(nodeId(F.file, F.node.qname.slice(0, i))) || null
  }
  for (const e of edges) {
    if (!w.out.has(e.from)) w.out.set(e.from, [])
    const to = w.nodes.get(e.to)
    if (to) w.out.get(e.from).push(to)
  }
  linkCallers(w, edges)
  linkClassEvidence(w, dataByFile)
  linkModuleEvidence(w)
  // everything starts at bottom ('no evidence yet') so a first-round unknown never sticks
  for (const M of w.modules.values()) for (const name of Object.keys(M.defs)) M.state.set(name, ev(BOTTOM, 'unknown'))
  for (const C of w.classes.values()) for (const { entry } of C.entries) C.state.set(entry.name, ev(BOTTOM, 'unknown'))
  for (const C of w.classes.values()) C.bases = C.cls.bases.map(b => resolveClass(C.file, b)).filter(Boolean)
  return w
}

const ctxOf = (w, F, file) => ({ w, F, file: F ? F.file : file, overlay: null })

/** Callers of each function: edges into it, matched to the caller's call expressions by name. */
function linkCallers(w, edges) {
  for (const e of edges) {
    const from = w.fns.get(e.from), to = w.fns.get(e.to)
    if (!from || !to) continue
    const ctorName = to.node.name === '__init__' && to.cls ? w.classes.get(to.cls).cls.name : null
    for (const call of from.data.calls || []) {
      const ctor = ctorName && call.callee === ctorName
      if (call.callee === to.node.name || ctor) to.callers.push({ F: from, call, ctor })
    }
  }
}

/** Class fields: class-body + self.x assignments (evaluated in their method), and self.x mutations. */
function linkClassEvidence(w, dataByFile) {
  for (const C of w.classes.values()) {
    for (const entry of dataByFile[C.file]?.classFields?.[C.cls.qname] || []) {
      const F = entry.method ? w.fns.get(nodeId(C.file, entry.method)) : null
      C.entries.push({ entry, ctx: ctxOf(w, F, C.file) })
    }
  }
  for (const F of w.fns.values()) {
    const C = F.cls && w.classes.get(F.cls)
    if (!C) continue
    for (const m of F.data.mutations) {
      const name = /^self\.(\w+)$/.exec(m.target)?.[1]
      if (name && m.op !== 'assign' && m.op !== 'augassign') C.muts.push({ name, m, ctx: ctxOf(w, F) })
    }
  }
}

/** Module vars: rebinds under `global` and mutations from any function that touches the name. */
function linkModuleEvidence(w) {
  for (const M of w.modules.values()) {
    for (const m of w.dataByFile[M.file]?.moduleMutations || []) addModuleMut(M, m, ctxOf(w, null, M.file))
  }
  for (const F of w.fns.values()) {
    const M = w.modules.get(F.file)
    if (!M) continue
    for (const m of F.data.mutations) if (F.data.globals.includes(m.target)) addModuleMut(M, m, ctxOf(w, F))
  }
}
function addModuleMut(M, m, ctx) {
  if (m.op === 'assign' || m.op === 'augassign') M.assigns.push({ name: m.target, m, ctx })
  else M.muts.push({ name: m.target, m, ctx })
}

// ================================================================ expressions

function lookup(ctx, name) {
  if (ctx.overlay?.has(name)) return ctx.overlay.get(name)
  for (let F = ctx.F; F; F = F.parent) {
    if (name === 'self' && F.data.selfParam && F.cls) return ev({ k: 'obj', cls: F.cls }, 'annotation')
    const v = F.vars.get(name), l = F.loopVars.get(name)
    if (v && l) return ev(unionOf([v.shape, l]), v.src)
    if (v) return v
    if (l) return ev(l, 'literal')
  }
  const M = ctx.w.modules.get(ctx.file)
  if (M?.state.has(name)) return M.state.get(name)
  return UNK_EV
}

function inScope(ctx, name) {
  if (ctx.overlay?.has(name)) return true
  for (let F = ctx.F; F; F = F.parent) if (F.vars.has(name) || F.loopVars.has(name)) return true
  return !!ctx.w.modules.get(ctx.file)?.state.has(name)
}

function evalExpr(e, ctx) {
  if (!e) return UNK_EV
  switch (e.kind) {
    case 'str': case 'int': case 'float': case 'bool': case 'none': case 'bytes':
      return ev(prim(e.kind), 'literal')
    case 'compare': case 'not': return ev(prim('bool'), 'literal')
    case 'list': case 'set': return ev({ k: e.kind, of: unionOf(e.items.map(x => evalExpr(x, ctx).shape)) }, 'literal')
    case 'tuple': return ev(tupleOf(e.items.map(x => evalExpr(x, ctx).shape)), 'literal')
    case 'dict': return ev(dictShape(e, ctx), 'literal')
    case 'comprehension': return ev(compShape(e, ctx), 'literal')
    case 'ref': {
      const base = lookup(ctx, e.name)
      return e.attr === undefined ? base : attrOf(base, e.attr, ctx)
    }
    case 'attr': return attrOf(evalExpr(e.of, ctx), e.attr, ctx)
    case 'subscript': {
      const base = evalExpr(e.of, ctx)
      if (e.index?.kind === 'slice') return base
      return ev(itemOf(base.shape, e.index), base.src)
    }
    case 'item': {
      const base = evalExpr(e.of, ctx)
      return ev(itemAt(base.shape, e.index), base.src)
    }
    case 'call': return evalCall(e, ctx)
    case 'binop': {
      const a = evalExpr(e.left, ctx), b = evalExpr(e.right, ctx)
      return ev(binop(e.op, a.shape, b.shape), weaker(a.src, b.src))
    }
    case 'boolop': case 'cond': {
      const a = evalExpr(e.left || e.a, ctx), b = evalExpr(e.right || e.b, ctx)
      return ev(unionOf([a.shape, b.shape]), weaker(a.src, b.src))
    }
    case 'unary': {
      const a = evalExpr(e.of, ctx)
      if (e.op === '~') return ev(prim('int'), a.src)
      return ev(isNum(a.shape) || isBottom(a.shape) ? a.shape : UNKNOWN, a.src)
    }
    case 'instance': {
      const cls = ctx.w.rc(ctx.file, e.cls)
      return cls ? ev({ k: 'obj', cls }, 'ctor') : UNK_EV
    }
    default: return UNK_EV
  }
}

function dictShape(e, ctx) {
  const pairs = e.entries.filter(x => !x.spread)
  const spreads = e.entries.filter(x => x.spread).map(x => evalExpr(x.spread, ctx).shape)
  if (pairs.length && !spreads.length && pairs.every(p => p.key.kind === 'str' && p.key.value !== undefined)) {
    const fields = {}
    for (const p of pairs) fields[p.key.value] = unionOf([fields[p.key.value], evalExpr(p.val, ctx).shape])
    return { k: 'record', fields }
  }
  const keys = pairs.map(p => evalExpr(p.key, ctx).shape), vals = pairs.map(p => evalExpr(p.val, ctx).shape)
  for (const s of spreads) {
    if (s.k === 'dict') { keys.push(s.key); vals.push(s.val) } else if (!isBottom(s)) { keys.push(UNKNOWN); vals.push(UNKNOWN) }
  }
  return { k: 'dict', key: unionOf(keys), val: unionOf(vals) }
}

function withGens(gens, ctx) {
  const inner = { ...ctx, overlay: new Map(ctx.overlay || []) }
  for (const g of gens) bindSpec(g.targets, iterElem(g.iter, inner), inner.overlay)
  return inner
}

function compShape(e, ctx) {
  const inner = withGens(e.gens, ctx)
  const elt = evalExpr(e.elt, inner).shape
  if (e.of === 'dict') return { k: 'dict', key: evalExpr(e.key, inner).shape, val: elt }
  if (e.of === 'gen') return UNKNOWN // a generator is not a container; iterElem() looks through it
  return { k: e.of, of: elt }
}

/** Binds loop / comprehension targets ('x' or nested ['k', 'v']) into a Map name -> Ev. */
function bindSpec(spec, shape, into) {
  if (typeof spec === 'string') {
    const prev = into.get(spec)
    into.set(spec, ev(prev ? unionOf([prev.shape, shape]) : shape, 'literal'))
  } else if (Array.isArray(spec)) spec.forEach((sub, i) => bindSpec(sub, itemAt(shape, i), into))
}

function attrOf(base, attr, ctx) {
  const members = base.shape.k === 'union' ? base.shape.of.filter(s => !(s.k === 'prim' && s.t === 'none')) : [base.shape]
  if (members.length && members.every(isBottom)) return ev(BOTTOM, base.src)
  const evs = members.map(s => s.k === 'obj' ? fieldLookup(ctx.w, s.cls, attr) : isBottom(s) ? ev(BOTTOM, 'unknown') : UNK_EV)
  if (!evs.length) return UNK_EV
  const shape = unionOf(evs.map(x => x.shape))
  return ev(shape, evs.map(x => x.src).reduce(weaker))
}

function fieldLookup(w, clsId, name, seen = new Set()) {
  const C = w.classes.get(clsId)
  if (!C || seen.has(clsId)) return UNK_EV
  seen.add(clsId)
  if (C.state.has(name)) return C.state.get(name)
  for (const b of C.bases || []) {
    const r = fieldLookup(w, b, name, seen)
    if (r !== UNK_EV) return r
  }
  return UNK_EV
}

function methodLookup(w, clsId, name, seen = new Set()) {
  const C = w.classes.get(clsId)
  if (!C || seen.has(clsId)) return null
  seen.add(clsId)
  if (C.methods.has(name)) return w.fns.get(C.methods.get(name)) || null
  for (const b of C.bases || []) {
    const r = methodLookup(w, b, name, seen)
    if (r) return r
  }
  return null
}

function itemOf(s, index) {
  switch (s.k) {
    case 'bottom': return BOTTOM
    case 'list': return s.of
    case 'tuple': return s.items && index?.kind === 'int' ? unionOf(s.items) : s.of
    case 'dict': return s.val
    case 'record':
      if (index?.kind === 'str' && index.value !== undefined) return s.fields[index.value] || UNKNOWN
      return unionOf(Object.values(s.fields))
    case 'prim': return s.t === 'str' ? s : s.t === 'bytes' ? prim('int') : UNKNOWN
    case 'union': return unionOf(s.of.filter(x => !(x.k === 'prim' && x.t === 'none')).map(x => itemOf(x, index)))
    default: return UNKNOWN
  }
}

function itemAt(s, i) {
  if (isBottom(s)) return BOTTOM
  if (s.k === 'tuple' && s.items) return s.items[i] ?? UNKNOWN
  if (s.k === 'list' || s.k === 'tuple') return s.of
  if (s.k === 'union') return unionOf(s.of.map(x => itemAt(x, i)))
  return UNKNOWN
}

/** Shape of one element produced by iterating `e` (for-loops, comprehensions, extend()). */
function iterElem(e, ctx) {
  if (e?.kind === 'call' && !e.receiver) {
    const a = e.args
    switch (e.callee) {
      case 'range': return prim('int')
      case 'enumerate': return tupleOf([prim('int'), a[0] ? iterElem(a[0], ctx) : UNKNOWN])
      case 'zip': return tupleOf(a.map(x => iterElem(x, ctx)))
      case 'reversed': case 'sorted': case 'iter': case 'list': case 'tuple': case 'set': case 'frozenset':
        if (a[0] && !inScope(ctx, e.callee)) return iterElem(a[0], ctx)
        break
      case 'filter': if (a[1]) return iterElem(a[1], ctx)
    }
  }
  if (e?.kind === 'comprehension') {
    const inner = withGens(e.gens, ctx)
    return e.of === 'dict' ? evalExpr(e.key, inner).shape : evalExpr(e.elt, inner).shape
  }
  return elemOfShape(evalExpr(e, ctx).shape)
}

function elemOfShape(s) {
  switch (s.k) {
    case 'bottom': return BOTTOM
    case 'list': case 'set': case 'tuple': return s.of
    case 'dict': return s.key
    case 'record': return prim('str')
    case 'prim': return s.t === 'str' ? s : s.t === 'bytes' ? prim('int') : UNKNOWN
    case 'union': return unionOf(s.of.filter(x => !(x.k === 'prim' && x.t === 'none')).map(elemOfShape))
    default: return UNKNOWN
  }
}

const isNum = s => s.k === 'prim' && (s.t === 'int' || s.t === 'float' || s.t === 'bool')
const isPrim = (s, t) => s.k === 'prim' && s.t === t

function binop(op, a, b) {
  if (isBottom(a) || isBottom(b)) return BOTTOM
  if (a.k === 'union' || b.k === 'union') {
    const as = a.k === 'union' ? a.of : [a], bs = b.k === 'union' ? b.of : [b]
    return unionOf(as.flatMap(x => bs.map(y => binop(op, x, y))))
  }
  if (isNum(a) && isNum(b)) {
    if ('&|^'.includes(op) && isPrim(a, 'bool') && isPrim(b, 'bool')) return prim('bool')
    if (op === '/') return prim('float')
    if (op === '@') return UNKNOWN
    return isPrim(a, 'float') || isPrim(b, 'float') ? prim('float') : prim('int')
  }
  for (const t of ['str', 'bytes']) {
    if (op === '+' && isPrim(a, t) && isPrim(b, t)) return prim(t)
    if (op === '%' && isPrim(a, t)) return prim(t)
    if (op === '*' && ((isPrim(a, t) && isPrim(b, 'int')) || (isPrim(b, t) && isPrim(a, 'int')))) return prim(t)
  }
  if (op === '+' && a.k === b.k && (a.k === 'list' || a.k === 'tuple')) return { k: a.k, of: unionOf([a.of, b.of]) }
  if (op === '*' && a.k === 'list' && isPrim(b, 'int')) return a
  if ('|&-^'.includes(op) && a.k === 'set' && b.k === 'set') return { k: 'set', of: unionOf([a.of, b.of]) }
  if (op === '|' && a.k === 'dict' && b.k === 'dict') return { k: 'dict', key: unionOf([a.key, b.key]), val: unionOf([a.val, b.val]) }
  return UNKNOWN
}

// ================================================================ calls

const TYPE_CTORS = { str: 'str', int: 'int', float: 'float', bool: 'bool', bytes: 'bytes' }
const RET_PRIM = {
  repr: 'str', chr: 'str', input: 'str', format: 'str', hex: 'str', oct: 'str', bin: 'str', ascii: 'str',
  len: 'int', ord: 'int', hash: 'int', id: 'int',
  isinstance: 'bool', issubclass: 'bool', callable: 'bool', hasattr: 'bool', all: 'bool', any: 'bool',
}

function evalCall(e, ctx) {
  if (e.receiver) {
    if (e.receiver.kind === 'ref' && e.receiver.attr === undefined && !inScope(ctx, e.receiver.name) && e.receiver.name !== 'self') {
      const cls = ctx.w.rc(ctx.file, e.calleeText)
      if (cls) return ev({ k: 'obj', cls }, 'ctor')
    }
    const r = evalExpr(e.receiver, ctx)
    return methodCall(r.shape, e, ctx) || edgeCall(ctx, e.callee) || UNK_EV
  }
  if (!e.callee) return UNK_EV
  if (inScope(ctx, e.callee)) return UNK_EV // calling a variable (callback): cannot know
  const cls = ctx.w.rc(ctx.file, e.callee)
  if (cls) return ev({ k: 'obj', cls }, 'ctor')
  return edgeCall(ctx, e.callee) || builtinCall(e, ctx) || UNK_EV
}

/** Follows the resolved L2 call edges from the current function to functions named `name`. */
function edgeCall(ctx, name) {
  if (!ctx.F) return null
  const targets = (ctx.w.out.get(ctx.F.id) || []).filter(n => n.name === name)
  if (!targets.length) return null
  const shapes = targets.map(n => {
    const T = ctx.w.fns.get(n.id)
    return !T ? UNKNOWN : T.node.name === '__init__' && T.cls ? { k: 'obj', cls: T.cls } : T.ret
  })
  return ev(unionOf(shapes), 'return')
}

function methodCall(recv, e, ctx) {
  if (isBottom(recv)) return ev(BOTTOM, 'return')
  const members = recv.k === 'union' ? recv.of.filter(s => !isPrim(s, 'none')) : [recv]
  const shapes = members.map(s => {
    if (s.k === 'obj') { const T = methodLookup(ctx.w, s.cls, e.callee); return T ? T.ret : null }
    return builtinMethod(s, e, ctx)
  })
  if (!shapes.length || shapes.every(s => s === null)) return null
  return ev(unionOf(shapes.map(s => s || UNKNOWN)), 'return')
}

const STR_TO_STR = new Set(['strip', 'lstrip', 'rstrip', 'lower', 'upper', 'replace', 'join', 'format', 'title',
  'capitalize', 'casefold', 'center', 'ljust', 'rjust', 'zfill', 'expandtabs', 'swapcase', 'removeprefix', 'removesuffix'])
const STR_TO_BOOL = new Set(['startswith', 'endswith', 'isdigit', 'isalnum', 'isalpha', 'isspace', 'islower',
  'isupper', 'isnumeric', 'isdecimal', 'isidentifier', 'istitle'])
const STR_TO_INT = new Set(['find', 'rfind', 'index', 'rindex', 'count'])

function builtinMethod(s, e, ctx) {
  const m = e.callee
  const arg = i => e.args[i] ? evalExpr(e.args[i], ctx).shape : null
  if (s.k === 'prim' && (s.t === 'str' || s.t === 'bytes')) {
    if (/^(split|rsplit|splitlines)$/.test(m)) return { k: 'list', of: s }
    if (/^(partition|rpartition)$/.test(m)) return tupleOf([s, s, s])
    if (STR_TO_STR.has(m)) return s
    if (STR_TO_BOOL.has(m)) return prim('bool')
    if (STR_TO_INT.has(m)) return prim('int')
    if (m === 'encode') return prim('bytes')
    if (m === 'decode') return prim('str')
    return null
  }
  if (s.k === 'list') {
    if (m === 'pop') return s.of
    if (m === 'copy') return s
    if (m === 'index' || m === 'count') return prim('int')
    return null
  }
  if (s.k === 'set') return /^(copy|union|intersection|difference|symmetric_difference)$/.test(m) ? s : m === 'pop' ? s.of : null
  if (s.k === 'dict' || s.k === 'record') return dictMethod(s, m, arg, e)
  return null
}

function dictMethod(s, m, arg, e) {
  const isRec = s.k === 'record'
  const key = isRec ? prim('str') : s.key
  const k0 = e.args[0]
  const val = isRec ? (k0?.kind === 'str' && k0.value !== undefined ? s.fields[k0.value] || UNKNOWN : unionOf(Object.values(s.fields))) : s.val
  switch (m) {
    case 'get': return unionOf([val, arg(1) || NONE])
    case 'pop': return unionOf([val, arg(1) || BOTTOM])
    case 'setdefault': return unionOf([val, arg(1) || NONE])
    case 'keys': return { k: 'list', of: key }
    case 'values': return { k: 'list', of: val }
    case 'items': return { k: 'list', of: tupleOf([key, val]) }
    case 'copy': return s
    default: return null
  }
}

function builtinCall(e, ctx) {
  const a = e.args
  const c = e.callee
  if (TYPE_CTORS[c]) return ev(prim(TYPE_CTORS[c]), 'ctor')
  if (RET_PRIM[c]) return ev(prim(RET_PRIM[c]), 'return')
  switch (c) {
    case 'list': case 'set': case 'tuple': case 'frozenset':
      return ev({ k: c === 'frozenset' ? 'set' : c, of: a[0] ? iterElem(a[0], ctx) : BOTTOM }, 'ctor')
    case 'dict': {
      if (!a[0] && !Object.keys(e.kwargs).length) return ev({ k: 'dict', key: BOTTOM, val: BOTTOM }, 'ctor')
      if (!a[0]) return ev({ k: 'record', fields: mapValues(e.kwargs, x => evalExpr(x, ctx).shape) }, 'ctor')
      const s = evalExpr(a[0], ctx).shape
      return ev(s.k === 'dict' || s.k === 'record' ? s : UNKNOWN, 'ctor')
    }
    case 'sorted': return ev({ k: 'list', of: a[0] ? iterElem(a[0], ctx) : UNKNOWN }, 'return')
    case 'min': case 'max':
      if (a.length === 1) return ev(iterElem(a[0], ctx), 'return')
      return ev(unionOf(a.map(x => evalExpr(x, ctx).shape)), 'return')
    case 'abs': case 'round':
      return a[0] && a.length === 1 ? ev(c === 'round' ? prim('int') : evalExpr(a[0], ctx).shape, 'return') : null
    case 'field': { // dataclasses.field(default=..., default_factory=list)
      const f = e.kwargs.default_factory
      if (f?.kind === 'ref' && /^(list|dict|set)$/.test(f.name) && f.attr === undefined) {
        return ev(f.name === 'dict' ? { k: 'dict', key: BOTTOM, val: BOTTOM } : { k: f.name, of: BOTTOM }, 'ctor')
      }
      return e.kwargs.default ? evalExpr(e.kwargs.default, ctx) : null
    }
    default: return null
  }
}

// ================================================================ variables

/** Joins every assignment to one variable (flow-insensitive), then fills empty containers from
 * mutation evidence. src stays the first assignment's unless later code changed the shape. */
function flowEv(evs, muts) {
  if (!evs.length) return ev(BOTTOM, 'unknown')
  const base = evs[0]
  let shape = unionOf(evs.map(x => x.shape)), src = base.src
  if (!same(shape, base.shape)) src = 'mutation'
  const refined = refine(shape, muts)
  if (!same(refined, shape)) { shape = refined; src = 'mutation' }
  return fix(ev(cap(shape), src))
}
function fix(e) {
  if (isBottom(e.shape)) return ev(BOTTOM, 'unknown')
  if (e.shape.k === 'unknown') return UNK_EV
  return e.src === 'unknown' ? ev(e.shape, 'mutation') : e
}

const ELEM_OPS = new Set(['append', 'appendleft', 'add', 'push', 'insert'])

/** Fills bottom element/key/value slots of containers from mutations [{m, ctx}]. */
function refine(shape, muts) {
  if (!muts.length || isBottom(shape)) return shape
  if (shape.k === 'union') return unionOf(shape.of.map(s => refine(s, muts)))
  if ((shape.k === 'list' || shape.k === 'set') && isBottom(shape.of)) {
    const vals = muts.map(({ m, ctx }) =>
      ELEM_OPS.has(m.op) || (m.op === 'setitem' && shape.k === 'list') ? evalExpr(m.value, ctx).shape
        : m.op === 'extend' || m.op === 'update' ? iterElem(m.value, ctx) : BOTTOM)
    return { k: shape.k, of: unionOf(vals) }
  }
  if (shape.k === 'dict' && (isBottom(shape.key) || isBottom(shape.val))) {
    const keys = [], vals = []
    for (const { m, ctx } of muts) {
      if (m.op === 'setitem' || m.op === 'setdefault') {
        keys.push(evalExpr(m.key, ctx).shape); vals.push(evalExpr(m.value, ctx).shape)
      } else if (m.op === 'update') {
        const s = evalExpr(m.value, ctx).shape
        if (s.k === 'dict') { keys.push(s.key); vals.push(s.val) }
        if (s.k === 'record') { keys.push(prim('str')); vals.push(unionOf(Object.values(s.fields))) }
      }
    }
    return { k: 'dict', key: isBottom(shape.key) ? unionOf(keys) : shape.key, val: isBottom(shape.val) ? unionOf(vals) : shape.val }
  }
  if (shape.k === 'record') {
    const extra = muts.filter(({ m }) => m.op === 'setitem' && m.key?.kind === 'str' && m.key.value !== undefined && !(m.key.value in shape.fields))
    if (!extra.length) return shape
    const fields = { ...shape.fields }
    for (const { m, ctx } of extra) fields[m.key.value] = unionOf([fields[m.key.value], evalExpr(m.value, ctx).shape])
    return { k: 'record', fields }
  }
  return shape
}

function annEv(text, file, w) {
  if (!text) return null
  const s = parseType(text, name => w.rc(file, name), 0)
  return isKnown(s) ? ev(s, 'annotation') : null
}

function localEv(F, loc, ctx) {
  const a = annEv(loc.annotation, F.file, ctx.w)
  if (a) return a
  const rebinds = F.data.mutations.filter(m => m.target === loc.name && (m.op === 'assign' || m.op === 'augassign'))
  const evs = [loc.init, ...rebinds.map(m => m.value)].filter(Boolean).map(x => evalExpr(x, ctx))
  const muts = F.data.mutations.filter(m => m.target === loc.name && m.op !== 'assign' && m.op !== 'augassign').map(m => ({ m, ctx }))
  return evs.length ? flowEv(evs, muts) : UNK_EV
}

function paramEv(F, p, idx, ctx) {
  const a = annEv(p.annotation, F.file, ctx.w)
  if (p.star) {
    const inner = a ? a.shape : UNKNOWN
    return ev(p.star === '*' ? { k: 'tuple', of: inner } : { k: 'dict', key: prim('str'), val: inner }, a ? 'annotation' : 'literal')
  }
  if (a) return a
  const evs = []
  if (p.default && p.default.kind !== 'none') evs.push(evalExpr(p.default, ctxOf(ctx.w, F.parent, F.file)))
  for (const c of F.callers) {
    const arg = argFor(c, F, p, idx)
    if (arg) evs.push(ev(evalExpr(arg, ctxOf(ctx.w, c.F)).shape, 'return'))
  }
  let r = pickStrongest(evs)
  if (p.default?.kind === 'none') r = isKnown(r.shape) ? ev(unionOf([r.shape, NONE]), r.src) : ev(NONE, 'literal')
  return fix(ev(cap(r.shape), r.src))
}

/** The argument expression a call site passes for param `p` (position `idx`), or null. */
function argFor({ call, ctor }, F, p, idx) {
  if (call.kwargs && Object.hasOwn(call.kwargs, p.name)) return call.kwargs[p.name]
  const bound = F.data.selfParam && (call.receiver || ctor) ? 1 : 0
  const pos = idx - bound
  if (pos < 0) return null
  for (let i = 0; i <= pos && i < call.args.length; i++) if (call.args[i].kind === 'splat') return null
  return call.args[pos] || null
}

function retShape(F, ctx) {
  const a = annEv(F.node.returns || F.data.returnType, F.file, ctx.w)
  if (a) return a.shape
  if (F.data.isGenerator) return UNKNOWN
  if (!F.data.returns.length) return NONE
  return cap(unionOf(F.data.returns.map(r => evalExpr(r.expr, ctx).shape)))
}

function fieldEv(C, name) {
  const entries = C.entries.filter(x => x.entry.name === name)
  const annotated = entries.find(x => x.entry.annotation)
  const a = annotated && annEv(annotated.entry.annotation, C.file, annotated.ctx.w)
  if (a) return a
  const evs = entries.filter(x => x.entry.init).map(x => evalExpr(x.entry.init, x.ctx))
  return evs.length ? flowEv(evs, C.muts.filter(x => x.name === name)) : UNK_EV
}

function moduleEv(M, name, w) {
  const def = M.defs[name]
  const a = annEv(def.annotation, M.file, w)
  if (a) return a
  const ctx = ctxOf(w, null, M.file)
  const evs = [def.init ? evalExpr(def.init, ctx) : null, ...M.assigns.filter(x => x.name === name).map(x => evalExpr(x.m.value, x.ctx))].filter(Boolean)
  return evs.length ? flowEv(evs, M.muts.filter(x => x.name === name)) : UNK_EV
}

// ================================================================ fixed point

function stepFunction(F, w) {
  const ctx = ctxOf(w, F)
  for (let i = 0; i < INNER_ROUNDS; i++) {
    const before = snapFn(F)
    F.data.params.forEach((p, idx) => {
      if (!(idx === 0 && F.data.selfParam)) F.vars.set(p.name, paramEv(F, p, idx, ctx))
    })
    for (const loc of F.data.locals) F.vars.set(loc.name, localEv(F, loc, ctx))
    const loopVars = new Map()
    for (const l of F.data.loops) if (l.kind === 'for' && l.targets) bindSpec(l.targets, iterElem(l.iter, ctx), loopVars)
    F.loopVars = new Map([...loopVars].map(([k, v]) => [k, cap(v.shape)]))
    F.ret = retShape(F, ctx)
    if (snapFn(F) === before) break
  }
}
const snapFn = F => [...F.vars].map(([k, v]) => `${k}=${canon(v.shape)}/${v.src}`).join(';') +
  [...F.loopVars].map(([k, v]) => `${k}=${canon(v)}`).join(';') + canon(F.ret)

function stepAll(w) {
  for (const M of w.modules.values()) for (const name of Object.keys(M.defs)) M.state.set(name, moduleEv(M, name, w))
  for (const C of w.classes.values()) {
    for (const name of new Set(C.entries.map(x => x.entry.name))) C.state.set(name, fieldEv(C, name))
  }
  for (const F of w.fns.values()) stepFunction(F, w)
}

function snapshot(w) {
  const parts = []
  for (const M of w.modules.values()) for (const [k, v] of M.state) parts.push(`${M.file}:${k}=${canon(v.shape)}/${v.src}`)
  for (const C of w.classes.values()) for (const [k, v] of C.state) parts.push(`${C.id}.${k}=${canon(v.shape)}/${v.src}`)
  for (const F of w.fns.values()) parts.push(`${F.id}:${snapFn(F)}`)
  return parts.join('\n')
}

// ================================================================ structures

const GRAPH_NAME = /neighbou?r|edge|adj|link|conn|succ|pred|peer|out_|in_|incoming|outgoing|targets?$/i
const CHILD_NAME = /child|kid|sub|branch|left|right|leaves|leaf/i
const PREV_NAME = /^_*(prev|previous|back|before|last)$/i
const NEXT_NAME = /^_*(next|forward|after|succ)$/i

/** Class ids referenced by a shape, each with whether it sits inside a container (and which). */
function refsOf(s, inside = null, acc = []) {
  switch (s.k) {
    case 'obj': acc.push({ cls: s.cls, inside }); break
    case 'union': s.of.forEach(x => refsOf(x, inside, acc)); break
    case 'list': case 'set': case 'tuple': refsOf(s.of, inside || s.k, acc); break
    case 'dict': refsOf(s.key, 'dict', acc); refsOf(s.val, 'dict', acc); break
    case 'record': Object.values(s.fields).forEach(x => refsOf(x, inside || 'dict', acc)); break
  }
  return acc
}

/** Tarjan SCC over the class -> class graph; returns Map classId -> component size. */
function sccSizes(graph) {
  let index = 0
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], size = new Map()
  const visit = v => {
    idx.set(v, index); low.set(v, index); index++
    stack.push(v); onStack.add(v)
    for (const u of graph.get(v) || []) {
      if (!idx.has(u)) { visit(u); low.set(v, Math.min(low.get(v), low.get(u))) } else if (onStack.has(u)) low.set(v, Math.min(low.get(v), idx.get(u)))
    }
    if (low.get(v) === idx.get(v)) {
      const comp = []
      let x
      do { x = stack.pop(); onStack.delete(x); comp.push(x) } while (x !== v)
      for (const c of comp) size.set(c, comp.length)
    }
  }
  for (const v of graph.keys()) if (!idx.has(v)) visit(v)
  return size
}

/** Classification of one self-reaching class from its direct self-referencing fields. */
export function classifyStructure(selfFields, viaOtherClasses) {
  if (!selfFields.length) return viaOtherClasses ? 'graph' : null
  const containers = selfFields.filter(f => f.inside)
  const scalars = selfFields.filter(f => !f.inside)
  if (containers.some(f => GRAPH_NAME.test(f.name))) return 'graph'
  if (containers.some(f => f.inside === 'dict' && !CHILD_NAME.test(f.name))) return 'graph'
  if (!containers.length && scalars.length === 2 && scalars.some(f => PREV_NAME.test(f.name)) && scalars.some(f => NEXT_NAME.test(f.name))) {
    return 'doubly-linked-list'
  }
  if (selfFields.length === 1 && scalars.length === 1) return 'linked-list'
  return 'tree'
}

function detectStructures(w, fieldShapes) {
  const graph = new Map(), selfRefs = new Map()
  for (const C of w.classes.values()) {
    const targets = new Set(), direct = []
    for (const [name, { shape }] of Object.entries(fieldShapes[C.id] || {})) {
      const refs = refsOf(shape).filter(r => w.classes.has(r.cls))
      refs.forEach(r => targets.add(r.cls))
      const mine = refs.filter(r => r.cls === C.id)
      if (mine.length) direct.push({ name, inside: mine.find(r => r.inside)?.inside || null })
    }
    graph.set(C.id, [...targets])
    selfRefs.set(C.id, direct)
  }
  const size = sccSizes(graph)
  const out = {}
  for (const id of w.allClassIds) {
    const direct = selfRefs.get(id) || []
    const multi = (size.get(id) || 1) > 1
    out[id] = direct.length || multi ? classifyStructure(direct, multi) : null
  }
  return out
}

// ================================================================ output

function frameOf(F, w) {
  const vars = []
  const push = (name, scope, line, e) => vars.push({ name, scope, line, ...finalEv(e) })
  F.data.params.forEach((p, i) => { if (!(i === 0 && F.data.selfParam)) push(p.name, 'param', p.line, F.vars.get(p.name)) })
  for (const l of F.data.locals) push(l.name, 'local', l.line, F.vars.get(l.name))
  const M = w.modules.get(F.file)
  for (const g of F.data.globals) push(g, 'global', F.data.globalLines[g] || F.data.line, M?.state.get(g))
  const seen = new Set()
  const selfCls = F.cls
  for (const s of [...F.data.selfFields].sort((a, b) => a.line - b.line)) {
    if (seen.has(s.name) || !selfCls) continue
    const f = fieldLookup(w, selfCls, s.name)
    if (f === UNK_EV && (s.op === 'call' || methodLookup(w, selfCls, s.name))) continue // a method, not a field
    seen.add(s.name)
    push(s.name, 'self', s.line, f)
  }
  const loops = F.data.loops.map(l => ({ kind: l.kind, line: l.line, var: l.var || '', over: l.over || '', step: l.step || '' }))
  return vars.length || loops.length ? { vars, loops } : null
}

/** Runs the whole inference. See the header and the design doc, section 3. */
export function inferLayers({ nodes = [], edges = [], classes = [], dataByFile = {}, resolveClass = () => null }) {
  const w = buildWorld({ nodes, edges, classes, dataByFile, resolveClass: (f, t) => resolveClass(f, t) || null })
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = snapshot(w)
    stepAll(w)
    if (snapshot(w) === before) break
  }
  const frames = {}
  for (const F of w.fns.values()) {
    const fr = frameOf(F, w)
    if (fr) frames[F.id] = fr
  }
  const fieldShapes = {}
  for (const C of w.classes.values()) {
    fieldShapes[C.id] = {}
    for (const [name, e] of C.state) fieldShapes[C.id][name] = finalEv(e)
  }
  return { frames, fieldShapes, structures: detectStructures(w, fieldShapes) }
}
