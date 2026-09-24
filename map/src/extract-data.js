// L3 data extraction (Python). Walks an already-parsed tree-sitter root and records, per function,
// its params, locals, mutations, loops, returns, touched module globals and self fields, plus class
// fields and module variables. Pure: no I/O, no grammar loading. Expressions are summarised as small
// tagged `Expr` objects that map/src/infer.js turns into Shapes.
//
// qnames follow extract.js exactly: `outer.inner`, `Class.method`, `outer.Class.method`.

const MUTATORS = new Set(['append', 'appendleft', 'extend', 'insert', 'add', 'update', 'setdefault', 'push'])
const MAX_TEXT = 60
const STR_RE = /^([rRbBuUfF]*)('''|"""|'|")/

const collapse = t => t.replace(/\s+/g, ' ').trim()
const lineOf = n => n.startPosition.row + 1
const field = (n, f) => n.childForFieldName(f)
const unknown = n => ({ kind: 'unknown', text: n ? collapse(n.text).slice(0, MAX_TEXT) : '' })

export function extractPythonData(rootNode) {
  const out = { functions: {}, classFields: {}, moduleVars: {}, moduleMutations: [] }
  const sc = { qname: [], fn: null, fnQname: null, cls: null, selfName: null, inClassBody: false }
  for (const c of rootNode.namedChildren) walk(c, sc, out)
  for (const fn of Object.values(out.functions)) finishFn(fn, out.moduleVars)
  return out
}

// ---------------------------------------------------------------- statements

function walk(node, sc, out) {
  switch (node.type) {
    case 'function_definition': return onFunction(node, sc, out, [])
    case 'decorated_definition': return onDecorated(node, sc, out)
    case 'class_definition': return onClass(node, sc, out)
    case 'assignment': return onAssign(node, sc, out)
    case 'augmented_assignment': return onAugAssign(node, sc, out)
    case 'for_statement': return onFor(node, sc, out)
    case 'while_statement': return onWhile(node, sc, out)
    case 'return_statement': return onReturn(node, sc, out)
    case 'global_statement': case 'nonlocal_statement': return onGlobal(node, sc)
    case 'named_expression': return onWalrus(node, sc, out)
    case 'as_pattern': return onAsPattern(node, sc, out)
    case 'attribute': return onAttribute(node, sc, out)
    case 'keyword_argument': return walkOpt(field(node, 'value'), sc, out)
    case 'lambda': return walkOpt(field(node, 'body'), sc, out)
    case 'type': case 'comment': return
    case 'identifier': return noteName(node, sc)
    case 'yield': if (sc.fn) sc.fn.isGenerator = true; break
    case 'call': onCall(node, sc, out); break
  }
  walkChildren(node, sc, out)
}

function walkChildren(node, sc, out) {
  for (const c of node.namedChildren) walk(c, sc, out)
}
function walkOpt(node, sc, out) { if (node) walk(node, sc, out) }

function onDecorated(node, sc, out) {
  const decos = node.namedChildren.filter(c => c.type === 'decorator')
    .map(d => collapse(d.text).replace(/^@/, '').replace(/\(.*$/s, '').split('.').pop())
  const def = field(node, 'definition')
  if (!def) return
  if (def.type === 'function_definition') onFunction(def, sc, out, decos)
  else walk(def, sc, out)
}

function onFunction(node, sc, out, decos) {
  const name = field(node, 'name')?.text || '<anonymous>'
  const parts = [...sc.qname, name]
  const qname = parts.join('.')
  const fn = newFn(lineOf(node))
  fn.returnType = collapse(field(node, 'return_type')?.text || '')
  fn.params = parseParams(field(node, 'parameters'), sc)
  for (const p of fn.params) fn._bound.add(p.name)
  const isMethod = sc.inClassBody
  const plain = !decos.includes('staticmethod') && !decos.includes('classmethod')
  fn.selfParam = isMethod && plain && fn.params[0] && !fn.params[0].star ? fn.params[0].name : null
  if (!out.functions[qname]) out.functions[qname] = fn // first definition wins (property setters etc.)
  const inner = {
    qname: parts, fn, fnQname: qname, cls: sc.cls, inClassBody: false,
    selfName: isMethod ? fn.selfParam : sc.selfName,
  }
  // defaults are evaluated in the enclosing scope
  for (const p of fn.params) if (p._defaultNode) { walk(p._defaultNode, sc, out); delete p._defaultNode }
  const body = field(node, 'body')
  if (body) walkChildren(body, inner, out)
}

function onClass(node, sc, out) {
  const name = field(node, 'name')?.text || '<anonymous>'
  const parts = [...sc.qname, name]
  const qname = parts.join('.')
  if (!out.classFields[qname]) out.classFields[qname] = []
  const inner = { qname: parts, fn: null, fnQname: null, cls: qname, selfName: null, inClassBody: true }
  const body = field(node, 'body')
  if (body) walkChildren(body, inner, out)
}

function newFn(line) {
  return {
    line, params: [], locals: [], mutations: [], loops: [], returns: [], globals: [], globalLines: {},
    selfFields: [], calls: [], returnType: '', isGenerator: false, selfParam: null,
    _names: new Map(), _bound: new Set(), _declared: new Set(), _loopVars: new Set(),
  }
}

function finishFn(fn, moduleVars) {
  for (const [name, line] of fn._names) {
    if (!Object.hasOwn(moduleVars, name) || fn._loopVars.has(name)) continue
    if (fn._bound.has(name) && !fn._declared.has(name)) continue
    fn.globals.push(name)
    fn.globalLines[name] = line
  }
  delete fn._names; delete fn._bound; delete fn._declared; delete fn._loopVars
}

function parseParams(node, sc) {
  if (!node) return []
  const out = []
  for (const c of node.namedChildren) {
    const p = paramOf(c, sc)
    if (p) out.push(p)
  }
  return out
}

function paramOf(c, sc) {
  const base = { annotation: '', default: null, line: lineOf(c) }
  switch (c.type) {
    case 'identifier': return { name: c.text, ...base }
    case 'list_splat_pattern': case 'dictionary_splat_pattern': {
      const id = c.namedChildren[0]
      return id ? { name: id.text, ...base, star: c.type === 'list_splat_pattern' ? '*' : '**' } : null
    }
    case 'typed_parameter': {
      const inner = paramOf(c.namedChildren[0], sc)
      if (inner) inner.annotation = collapse(field(c, 'type')?.text || '')
      return inner
    }
    case 'default_parameter': case 'typed_default_parameter': {
      const val = field(c, 'value')
      return {
        name: field(c, 'name')?.text || '', ...base,
        annotation: collapse(field(c, 'type')?.text || ''),
        default: val ? exprOf(val, sc) : null, _defaultNode: val,
      }
    }
    default: return null
  }
}

// ---------------------------------------------------------------- assignments

function onAssign(node, sc, out) {
  const targets = []
  let cur = node
  let ann = ''
  while (cur && cur.type === 'assignment') {
    targets.push(field(cur, 'left'))
    if (field(cur, 'type')) ann = collapse(field(cur, 'type').text)
    cur = field(cur, 'right')
  }
  const value = cur ? exprOf(cur, sc) : null
  const line = lineOf(node)
  for (const t of targets) if (t) bindTarget(t, value, targets.length === 1 ? ann : '', line, sc, out)
  if (cur) walk(cur, sc, out)
}

function onAugAssign(node, sc, out) {
  const left = field(node, 'left'), right = field(node, 'right')
  if (!left || !right) return
  const op = (field(node, 'operator')?.text || '').replace(/=$/, '')
  const value = { kind: 'binop', op, left: exprOf(left, sc), right: exprOf(right, sc) }
  const line = lineOf(node)
  if (left.type === 'identifier' && sc.fn) {
    const name = left.text
    noteName(left, sc)
    if (sc.fn._bound.has(name) || sc.fn._declared.has(name)) {
      sc.fn.mutations.push({ target: name, op: 'augassign', value, line })
    } else bindTarget(left, value, '', line, sc, out)
  } else bindTarget(left, value, '', line, sc, out)
  walk(right, sc, out)
}

function onWalrus(node, sc, out) {
  const name = field(node, 'name'), val = field(node, 'value')
  if (name && val) bindTarget(name, exprOf(val, sc), '', lineOf(node), sc, out)
  walkOpt(val, sc, out)
}

function onAsPattern(node, sc, out) {
  const [value] = node.namedChildren
  const alias = field(node, 'alias')
  const target = alias?.namedChildren[0]
  if (target && value) {
    const init = node.parent?.type === 'except_clause' && /^[\w.]+$/.test(value.text)
      ? { kind: 'instance', cls: value.text } : unknown(node)
    bindTarget(target, init, '', lineOf(node), sc, out)
  }
  walkOpt(value, sc, out)
}

function bindTarget(t, value, ann, line, sc, out) {
  switch (t.type) {
    case 'identifier': return bindName(t.text, value, ann, line, sc, out)
    case 'attribute': return bindAttr(t, value, ann, line, sc, out)
    case 'subscript': return bindSubscript(t, value, line, sc, out)
    case 'parenthesized_expression': return t.namedChildren[0] && bindTarget(t.namedChildren[0], value, ann, line, sc, out)
    case 'pattern_list': case 'tuple_pattern': case 'list_pattern': case 'tuple': case 'list':
      t.namedChildren.forEach((c, index) => {
        const v = c.type === 'list_splat_pattern' ? unknown(c) : { kind: 'item', of: value, index }
        bindTarget(c.type === 'list_splat_pattern' ? c.namedChildren[0] || c : c, v, '', line, sc, out)
      })
  }
}

function bindName(name, value, ann, line, sc, out) {
  const init = value || { kind: 'unknown', text: '' }
  if (sc.fn) {
    const fn = sc.fn
    if (!fn._names.has(name)) fn._names.set(name, line)
    if (fn._declared.has(name) || fn._bound.has(name)) {
      if (value) fn.mutations.push({ target: name, op: 'assign', value, line })
      return
    }
    fn._bound.add(name)
    fn.locals.push({ name, line, annotation: ann, init: value ? init : null })
  } else if (sc.inClassBody) {
    out.classFields[sc.cls].push({ name, line, annotation: ann, init: value, method: null })
  } else if (!out.moduleVars[name]) {
    out.moduleVars[name] = { line, annotation: ann, init: value }
  } else if (value) {
    out.moduleMutations.push({ target: name, op: 'assign', value, line })
  }
}

function bindAttr(t, value, ann, line, sc, out) {
  const obj = field(t, 'object'), attr = field(t, 'attribute')?.text || ''
  if (isSelf(obj, sc) && sc.cls && out.classFields[sc.cls]) {
    out.classFields[sc.cls].push({ name: attr, line, annotation: ann, init: value, method: sc.fnQname })
    sc.fn.selfFields.push({ name: attr, line, op: 'write' })
    sc.fn.mutations.push({ target: `self.${attr}`, op: 'assign', value, line })
    return
  }
  pushMutation(sc, out, { target: targetText(obj, sc), op: 'setattr', key: { kind: 'str', value: attr }, value, line })
  walkOpt(obj, sc, out)
}

function bindSubscript(t, value, line, sc, out) {
  const obj = field(t, 'value'), idx = field(t, 'subscript')
  pushMutation(sc, out, { target: targetText(obj, sc), op: 'setitem', key: idx ? exprOf(idx, sc) : unknown(null), value, line })
  walkOpt(obj, sc, out)
  walkOpt(idx, sc, out)
}

function onGlobal(node, sc) {
  if (!sc.fn) return
  for (const id of node.namedChildren) {
    sc.fn._declared.add(id.text)
    if (!sc.fn._names.has(id.text)) sc.fn._names.set(id.text, lineOf(node))
  }
}

// ---------------------------------------------------------------- loops, returns, calls, reads

function onFor(node, sc, out) {
  const left = field(node, 'left'), right = field(node, 'right')
  if (sc.fn && left && right) {
    const targets = targetSpec(left)
    sc.fn.loops.push({
      kind: 'for', line: lineOf(node), var: collapse(left.text), over: overText(right), step: '',
      iter: exprOf(right, sc), targets,
    })
    for (const n of specNames(targets)) sc.fn._loopVars.add(n)
  }
  walkOpt(right, sc, out)
  walkOpt(field(node, 'body'), sc, out)
  walkOpt(field(node, 'alternative'), sc, out)
}

function onWhile(node, sc, out) {
  const cond = field(node, 'condition'), body = field(node, 'body')
  if (sc.fn) {
    const v = condVar(cond)
    sc.fn.loops.push({ kind: 'while', line: lineOf(node), var: v, over: v, step: v && body ? findStep(body, v) : '', iter: null, targets: null })
  }
  walkOpt(cond, sc, out)
  walkOpt(body, sc, out)
  walkOpt(field(node, 'alternative'), sc, out)
}

function onReturn(node, sc, out) {
  const e = node.namedChildren[0]
  if (sc.fn) sc.fn.returns.push({ expr: e ? exprOf(e, sc) : { kind: 'none' }, line: lineOf(node) })
  walkOpt(e, sc, out)
}

function onCall(node, sc, out) {
  const e = exprOf(node, sc)
  if (sc.fn) sc.fn.calls.push(e)
  const fnNode = field(node, 'function')
  if (fnNode?.type !== 'attribute' || !MUTATORS.has(e.callee)) return
  const obj = field(fnNode, 'object')
  if (obj.type !== 'identifier' && !isSelfAttr(obj, sc)) return
  const [a0, a1] = e.args
  const m = { target: targetText(obj, sc), op: e.callee, line: lineOf(node) }
  if (e.callee === 'insert') Object.assign(m, { key: a0, value: a1 })
  else if (e.callee === 'setdefault') Object.assign(m, { key: a0, value: a1 || { kind: 'none' } })
  else if (e.callee === 'update' && !a0 && Object.keys(e.kwargs).length) {
    m.value = { kind: 'dict', entries: Object.entries(e.kwargs).map(([k, v]) => ({ key: { kind: 'str', value: k }, val: v })) }
  } else m.value = a0
  if (!m.value) return
  pushMutation(sc, out, m)
  if (isSelfAttr(obj, sc)) sc.fn.selfFields.push({ name: field(obj, 'attribute').text, line: m.line, op: 'mutate' })
}

function onAttribute(node, sc, out) {
  const obj = field(node, 'object')
  if (sc.fn && isSelf(obj, sc)) {
    const called = node.parent?.type === 'call' && field(node.parent, 'function')?.startIndex === node.startIndex
    sc.fn.selfFields.push({ name: field(node, 'attribute')?.text || '', line: lineOf(node), op: called ? 'call' : 'read' })
    return
  }
  walkOpt(obj, sc, out)
}

function noteName(node, sc) {
  if (sc.fn && !sc.fn._names.has(node.text)) sc.fn._names.set(node.text, lineOf(node))
}

function pushMutation(sc, out, m) {
  if (sc.fn) sc.fn.mutations.push(m)
  else if (!sc.inClassBody) out.moduleMutations.push(m)
}

const isSelf = (n, sc) => !!(n && sc.selfName && n.type === 'identifier' && n.text === sc.selfName)
const isSelfAttr = (n, sc) => n?.type === 'attribute' && isSelf(field(n, 'object'), sc)

function targetText(obj, sc) {
  if (!obj) return ''
  if (isSelf(obj, sc)) return 'self'
  if (isSelfAttr(obj, sc)) return `self.${field(obj, 'attribute').text}`
  return collapse(obj.text)
}

/** The iterated variable for the loop cursor: `d.items()` -> "d", `enumerate(xs)` -> "xs". */
function overText(n) {
  if (n.type === 'call') {
    const f = field(n, 'function'), args = field(n, 'arguments')
    if (f?.type === 'attribute' && /^(items|keys|values)$/.test(field(f, 'attribute')?.text) && !args?.namedChildren.length) {
      return collapse(field(f, 'object').text)
    }
    const a0 = args?.namedChildren[0]
    if (f?.type === 'identifier' && /^(enumerate|reversed|sorted|iter)$/.test(f.text) && a0 &&
      (a0.type === 'identifier' || a0.type === 'attribute')) return collapse(a0.text)
  }
  return collapse(n.text)
}

/** `while node:` / `while node is not None:` -> "node"; anything else -> "". */
function condVar(c) {
  if (!c) return ''
  if (c.type === 'parenthesized_expression') return condVar(c.namedChildren[0])
  if (c.type === 'identifier') return c.text
  if (c.type === 'comparison_operator') {
    const [a, b] = c.namedChildren
    if (a?.type === 'identifier' && b?.type === 'none') return a.text
  }
  return ''
}

/** `node = node.next` somewhere in the body -> "next". Does not enter nested defs. */
function findStep(body, v) {
  for (const c of body.namedChildren) {
    if (c.type === 'function_definition' || c.type === 'class_definition') continue
    if (c.type === 'assignment') {
      const l = field(c, 'left'), r = field(c, 'right')
      if (l?.type === 'identifier' && l.text === v && r?.type === 'attribute' &&
        field(r, 'object')?.type === 'identifier' && field(r, 'object').text === v) return field(r, 'attribute').text
    }
    const s = findStep(c, v)
    if (s) return s
  }
  return ''
}

/** Loop / comprehension target: "x" -> 'x', "k, v" -> ['k', 'v'], nested tuples nest; others null. */
function targetSpec(n) {
  switch (n.type) {
    case 'identifier': return n.text
    case 'parenthesized_expression': return n.namedChildren[0] ? targetSpec(n.namedChildren[0]) : null
    case 'pattern_list': case 'tuple_pattern': case 'list_pattern': case 'tuple': case 'list':
      return n.namedChildren.map(targetSpec)
    default: return null
  }
}
function specNames(s) {
  if (typeof s === 'string') return [s]
  return Array.isArray(s) ? s.flatMap(specNames) : []
}

// ---------------------------------------------------------------- expressions

function exprOf(n, sc) {
  switch (n.type) {
    case 'identifier': return { kind: 'ref', name: isSelf(n, sc) ? 'self' : n.text }
    case 'attribute': {
      const o = field(n, 'object'), attr = field(n, 'attribute')?.text || ''
      if (o.type === 'identifier') return { kind: 'ref', name: isSelf(o, sc) ? 'self' : o.text, attr }
      return { kind: 'attr', of: exprOf(o, sc), attr }
    }
    case 'string': return strExpr(n.text)
    case 'concatenated_string': { const s = strExpr(n.namedChildren[0]?.text || '""'); delete s.value; return s }
    case 'integer': return { kind: 'int' }
    case 'float': return { kind: 'float' }
    case 'true': case 'false': return { kind: 'bool' }
    case 'none': return { kind: 'none' }
    case 'list': case 'set': case 'tuple':
      return { kind: n.type, items: n.namedChildren.filter(c => c.type !== 'comment').map(c => exprOf(c, sc)) }
    case 'expression_list': return { kind: 'tuple', items: n.namedChildren.map(c => exprOf(c, sc)) }
    case 'parenthesized_expression': return n.namedChildren[0] ? exprOf(n.namedChildren[0], sc) : unknown(n)
    case 'dictionary': return dictExpr(n, sc)
    case 'list_comprehension': return compExpr(n, 'list', sc)
    case 'set_comprehension': return compExpr(n, 'set', sc)
    case 'generator_expression': return compExpr(n, 'gen', sc)
    case 'dictionary_comprehension': return compExpr(n, 'dict', sc)
    case 'call': return callExpr(n, sc)
    case 'binary_operator':
      return { kind: 'binop', op: field(n, 'operator')?.text || '', left: exprOf(field(n, 'left'), sc), right: exprOf(field(n, 'right'), sc) }
    case 'boolean_operator':
      return { kind: 'boolop', op: field(n, 'operator')?.text || '', left: exprOf(field(n, 'left'), sc), right: exprOf(field(n, 'right'), sc) }
    case 'comparison_operator': return { kind: 'compare' }
    case 'not_operator': return { kind: 'not' }
    case 'unary_operator': return { kind: 'unary', op: n.child(0)?.text || '', of: exprOf(field(n, 'argument'), sc) }
    case 'conditional_expression': {
      const [a, , b] = n.namedChildren
      return a && b ? { kind: 'cond', a: exprOf(a, sc), b: exprOf(b, sc) } : unknown(n)
    }
    case 'subscript': {
      const idx = field(n, 'subscript')
      return { kind: 'subscript', of: exprOf(field(n, 'value'), sc), index: !idx ? unknown(null) : idx.type === 'slice' ? { kind: 'slice' } : exprOf(idx, sc) }
    }
    case 'named_expression': return exprOf(field(n, 'value'), sc)
    default: return unknown(n)
  }
}

function strExpr(text) {
  const m = STR_RE.exec(text)
  if (!m) return { kind: 'str' }
  const prefix = m[1].toLowerCase()
  if (prefix.includes('b')) return { kind: 'bytes' }
  if (prefix.includes('f')) return { kind: 'str' }
  return { kind: 'str', value: text.slice(m[0].length, text.length - m[2].length) }
}

function dictExpr(n, sc) {
  const entries = []
  for (const c of n.namedChildren) {
    if (c.type === 'pair') entries.push({ key: exprOf(field(c, 'key'), sc), val: exprOf(field(c, 'value'), sc) })
    else if (c.type === 'dictionary_splat') entries.push({ spread: exprOf(c.namedChildren[0], sc) })
  }
  return { kind: 'dict', entries }
}

function compExpr(n, of, sc) {
  const body = field(n, 'body')
  const gens = n.namedChildren.filter(c => c.type === 'for_in_clause').map(c => ({
    targets: targetSpec(field(c, 'left')), iter: exprOf(field(c, 'right'), sc),
  }))
  if (of === 'dict' && body?.type === 'pair') {
    return { kind: 'comprehension', of, key: exprOf(field(body, 'key'), sc), elt: exprOf(field(body, 'value'), sc), gens }
  }
  return { kind: 'comprehension', of, elt: body ? exprOf(body, sc) : unknown(null), gens }
}

function callExpr(n, sc) {
  const f = field(n, 'function'), argsNode = field(n, 'arguments')
  const e = { kind: 'call', callee: '', calleeText: collapse(f?.text || ''), receiver: null, args: [], kwargs: {}, line: lineOf(n) }
  if (f?.type === 'identifier') e.callee = f.text
  else if (f?.type === 'attribute') {
    e.callee = field(f, 'attribute')?.text || ''
    e.receiver = exprOf(field(f, 'object'), sc)
  }
  if (argsNode?.type === 'generator_expression') e.args.push(exprOf(argsNode, sc))
  else for (const a of argsNode?.namedChildren || []) {
    if (a.type === 'keyword_argument') e.kwargs[field(a, 'name')?.text || ''] = exprOf(field(a, 'value'), sc)
    else if (a.type === 'list_splat' || a.type === 'dictionary_splat') e.args.push({ kind: 'splat' })
    else if (a.type !== 'comment') e.args.push(exprOf(a, sc))
  }
  return e
}
