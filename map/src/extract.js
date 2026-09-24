// Per-file extraction: tree-sitter parses one file and we pull out its functions,
// methods, module-level calls and imports, plus (Python only) its classes with their
// bases, decorators and fields. graph.js turns this into a CodeGraph.
//
// Language is chosen by extension: .py python, .ts typescript, .tsx tsx,
// .js/.jsx/.mjs/.cjs javascript. Grammars are loaded lazily from tree-sitter-wasms
// and cached for the lifetime of the process.
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import { extractPythonData } from './extract-data.js'

const require = createRequire(import.meta.url)

const WASM_BY_LANG = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  typescript: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-wasms/out/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm',
}

const EXT_TO_LANG = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
}

let initPromise = null
function ensureInit() {
  if (!initPromise) initPromise = Parser.init()
  return initPromise
}

const languageCache = new Map() // lang -> Promise<Parser.Language>
function getLanguage(lang) {
  if (!languageCache.has(lang)) {
    languageCache.set(lang, ensureInit().then(() => {
      const wasmPath = require.resolve(WASM_BY_LANG[lang])
      return Parser.Language.load(wasmPath)
    }))
  }
  return languageCache.get(lang)
}

function langForPath(relPath) {
  const i = relPath.lastIndexOf('.')
  if (i < 0) return null
  return EXT_TO_LANG[relPath.slice(i).toLowerCase()] || null
}

function basename(relPath) {
  const i = relPath.lastIndexOf('/')
  return i < 0 ? relPath : relPath.slice(i + 1)
}

function collapseWs(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function stripParens(text) {
  let t = text.trim()
  if (t.startsWith('(')) t = t.slice(1)
  if (t.endsWith(')')) t = t.slice(0, -1)
  return t
}

function stripQuotes(text) {
  return text.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

// ---------------------------------------------------------------- python

// ctx.classes collects RawClass records ({ qname, name, line, bases, decorators, fields });
// ctx.cls is the record of the innermost enclosing class (null outside classes) and
// ctx.paramTypes maps the current function's annotated parameters to their annotation.
function extractPython(root, basenameStr) {
  const out = []
  const classes = []
  const moduleCalls = []
  walkPy(root, {
    qname: [], parentKind: 'module', callsArr: moduleCalls, fnStack: [], className: null,
    classes, cls: null, paramTypes: null,
  }, out)
  if (moduleCalls.length) {
    out.unshift({
      qname: '<module>', name: basenameStr, kind: 'module', line: 1,
      params: '', returns: '', bodyText: '', calls: moduleCalls,
      className: null, scopeChain: [''],
    })
  }
  return { functions: out, classes }
}

function walkPy(node, ctx, out) {
  for (const child of node.namedChildren) {
    if (child.type === 'call') {
      pushCallPy(child, ctx.callsArr)
      walkPy(child, ctx, out)
    } else if (child.type === 'function_definition') {
      handleFunctionDefPy(child, ctx, out)
    } else if (child.type === 'class_definition') {
      handleClassDefPy(child, ctx, out)
    } else if (child.type === 'assignment') {
      handleAssignmentPy(child, ctx)
      walkPy(child, ctx, out)
    } else {
      walkPy(child, ctx, out)
    }
  }
}

// A whole-string annotation ("Optional[X]") is a forward ref: drop the outer quotes.
function annotationText(typeNode) {
  const t = collapseWs(typeNode.text)
  const m = /^(['"])(.*)\1$/.exec(t)
  return m && !/['"]/.test(m[2]) ? m[2] : t
}

// Field type from an assignment's right-hand side: `Point(0, 0)` -> "Point" (capitalised
// callee only), a bare annotated parameter -> its annotation, otherwise "".
function rhsTypePy(right, ctx) {
  if (!right) return ''
  if (right.type === 'call') {
    const fn = right.childForFieldName('function')
    if (!fn || (fn.type !== 'identifier' && fn.type !== 'attribute')) return ''
    const last = fn.type === 'identifier' ? fn.text : (fn.childForFieldName('attribute') || fn).text
    return /^[A-Z]/.test(last) ? collapseWs(fn.text) : ''
  }
  if (right.type === 'identifier' && ctx.paramTypes && ctx.paramTypes.has(right.text)) {
    return ctx.paramTypes.get(right.text)
  }
  return ''
}

// Records class fields: annotated names in a class body, and `self.x = ...` in its methods
// (ctx.cls is reset by a nested class, so its methods feed that class instead).
function handleAssignmentPy(node, ctx) {
  const rec = ctx.cls
  const left = node.childForFieldName('left')
  if (!rec || !left) return
  const typeNode = node.childForFieldName('type')
  let name = null
  if (ctx.parentKind === 'class') {
    if (left.type === 'identifier' && typeNode) name = left.text
  } else if (ctx.parentKind === 'fn' && left.type === 'attribute') {
    const obj = left.childForFieldName('object')
    const attr = left.childForFieldName('attribute')
    if (obj && obj.type === 'identifier' && obj.text === 'self' && attr) name = attr.text
  }
  if (!name || rec.fields.some(f => f.name === name)) return
  const type = typeNode ? annotationText(typeNode) : rhsTypePy(node.childForFieldName('right'), ctx)
  rec.fields.push({ name, type, line: node.startPosition.row + 1 })
}

function paramTypesPy(paramsNode) {
  const types = new Map()
  if (!paramsNode) return types
  for (const p of paramsNode.namedChildren) {
    if (p.type !== 'typed_parameter' && p.type !== 'typed_default_parameter') continue
    const typeNode = p.childForFieldName('type')
    const nameNode = p.childForFieldName('name') || p.namedChildren.find(c => c.type === 'identifier')
    if (typeNode && nameNode && nameNode.type === 'identifier') types.set(nameNode.text, annotationText(typeNode))
  }
  return types
}

function pushCallPy(node, callsArr) {
  const fn = node.childForFieldName('function')
  if (!fn) return
  if (fn.type === 'identifier') {
    callsArr.push({ name: fn.text, receiver: null })
  } else if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (attr) callsArr.push({ name: attr.text, receiver: obj ? obj.text : null })
  }
}

function handleFunctionDefPy(node, ctx, out) {
  const nameNode = node.childForFieldName('name')
  const name = nameNode ? nameNode.text : '<anonymous>'
  const qnameParts = [...ctx.qname, name]
  const qname = qnameParts.join('.')
  const kind = ctx.parentKind === 'class' ? 'method' : 'fn'
  const paramsNode = node.childForFieldName('parameters')
  const params = paramsNode ? collapseWs(stripParens(paramsNode.text)) : ''
  const returnNode = node.childForFieldName('return_type')
  const returns = returnNode ? collapseWs(returnNode.text.replace(/^->\s*/, '')) : ''
  const bodyNode = node.childForFieldName('body')
  const bodyText = bodyNode ? bodyNode.text : ''
  const calls = []
  const fnStack = [...ctx.fnStack, qname]
  const scopeChain = [...fnStack].reverse()
  scopeChain.push('')
  out.push({ qname, name, kind, line: node.startPosition.row + 1, params, returns, bodyText, calls, className: ctx.className, scopeChain })
  if (bodyNode) {
    walkPy(bodyNode, {
      qname: qnameParts, parentKind: 'fn', callsArr: calls, fnStack, className: ctx.className,
      classes: ctx.classes, cls: ctx.cls, paramTypes: paramTypesPy(paramsNode),
    }, out)
  }
}

// `@dataclass` -> "dataclass", `@dataclass(frozen=True)` -> "dataclass".
function decoratorNamesPy(node) {
  const parent = node.parent
  if (!parent || parent.type !== 'decorated_definition') return []
  const names = []
  for (const d of parent.namedChildren) {
    if (d.type !== 'decorator') continue
    let expr = d.namedChildren.find(c => c.type !== 'comment')
    if (expr && expr.type === 'call') expr = expr.childForFieldName('function')
    if (expr) names.push(collapseWs(expr.text))
  }
  return names
}

// Positional superclass arguments only: `metaclass=...` and other keywords are skipped.
function basesPy(node) {
  const argList = node.childForFieldName('superclasses')
  if (!argList) return []
  return argList.namedChildren
    .filter(c => !['keyword_argument', 'comment', 'list_splat', 'dictionary_splat'].includes(c.type))
    .map(c => collapseWs(c.text))
}

function handleClassDefPy(node, ctx, out) {
  const nameNode = node.childForFieldName('name')
  const name = nameNode ? nameNode.text : '<anonymous>'
  const qnameParts = [...ctx.qname, name]
  const qname = qnameParts.join('.')
  const rec = {
    qname, name, line: node.startPosition.row + 1,
    bases: basesPy(node), decorators: decoratorNamesPy(node), fields: [],
  }
  ctx.classes.push(rec)
  const bodyNode = node.childForFieldName('body')
  if (bodyNode) {
    walkPy(bodyNode, {
      qname: qnameParts, parentKind: 'class', callsArr: ctx.callsArr, fnStack: ctx.fnStack, className: qname,
      classes: ctx.classes, cls: rec, paramTypes: null,
    }, out)
  }
}

function extractPythonImports(root) {
  const imports = {}
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (node.type === 'import_statement') {
      handleImportStatementPy(node, imports)
    } else if (node.type === 'import_from_statement') {
      handleImportFromStatementPy(node, imports)
    } else {
      for (const c of node.namedChildren) stack.push(c)
    }
  }
  return imports
}

function handleImportStatementPy(node, imports) {
  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name') {
      const mod = child.text
      const local = mod.split('.')[0]
      imports[local] = { module: mod, imported: null, kind: 'module' }
    } else if (child.type === 'aliased_import') {
      const nameNode = child.childForFieldName('name')
      const aliasNode = child.childForFieldName('alias')
      if (nameNode && aliasNode) {
        imports[aliasNode.text] = { module: nameNode.text, imported: null, kind: 'module' }
      }
    }
  }
}

function handleImportFromStatementPy(node, imports) {
  const moduleNode = node.childForFieldName('module_name')
  const modText = moduleNode ? moduleNode.text : ''
  const modStart = moduleNode ? moduleNode.startIndex : -1
  for (const child of node.namedChildren) {
    if (child.startIndex === modStart && child.type === moduleNode.type) continue
    if (child.type === 'dotted_name') {
      const name = child.text
      imports[name] = { module: modText, imported: name, kind: 'named' }
    } else if (child.type === 'aliased_import') {
      const nameNode = child.childForFieldName('name')
      const aliasNode = child.childForFieldName('alias')
      if (nameNode && aliasNode) {
        imports[aliasNode.text] = { module: modText, imported: nameNode.text, kind: 'named' }
      }
    }
    // wildcard_import: names can't be resolved, skip
  }
}

// ---------------------------------------------------------------- js / ts

const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function', 'function_expression', 'generator_function'])

function extractJsTs(root, basenameStr) {
  const out = []
  const moduleCalls = []
  walkJs(root, { qname: [], parentKind: 'module', callsArr: moduleCalls, fnStack: [], className: null }, out)
  if (moduleCalls.length) {
    out.unshift({
      qname: '<module>', name: basenameStr, kind: 'module', line: 1,
      params: '', returns: '', bodyText: '', calls: moduleCalls,
      className: null, scopeChain: [''],
    })
  }
  return out
}

function walkJs(node, ctx, out) {
  for (const child of node.namedChildren) {
    dispatchJs(child, ctx, out)
  }
}

function dispatchJs(node, ctx, out) {
  switch (node.type) {
    case 'call_expression': {
      pushCallJs(node, ctx.callsArr)
      walkJs(node, ctx, out)
      break
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const nameNode = node.childForFieldName('name')
      const name = nameNode ? nameNode.text : '<anonymous>'
      handleFunctionLikeJs(node, name, ctx, out, ctx.parentKind === 'class' ? 'method' : 'fn')
      break
    }
    case 'class_declaration': {
      const nameNode = node.childForFieldName('name')
      const name = nameNode ? nameNode.text : '<anonymous>'
      const qnameParts = [...ctx.qname, name]
      const body = node.childForFieldName('body')
      if (body) walkJs(body, { qname: qnameParts, parentKind: 'class', callsArr: ctx.callsArr, fnStack: ctx.fnStack, className: qnameParts.join('.') }, out)
      break
    }
    case 'method_definition': {
      const nameNode = node.childForFieldName('name')
      const name = nameNode ? nameNode.text : '<anonymous>'
      handleFunctionLikeJs(node, name, ctx, out, 'method')
      break
    }
    case 'variable_declarator': {
      const nameNode = node.childForFieldName('name')
      const valueNode = node.childForFieldName('value')
      if (nameNode && nameNode.type === 'identifier' && valueNode && FUNCTION_VALUE_TYPES.has(valueNode.type)) {
        handleFunctionLikeJs(valueNode, nameNode.text, ctx, out, ctx.parentKind === 'class' ? 'method' : 'fn')
      } else {
        walkJs(node, ctx, out)
      }
      break
    }
    default:
      walkJs(node, ctx, out)
  }
}

function pushCallJs(node, callsArr) {
  const fn = node.childForFieldName('function')
  if (!fn) return
  if (fn.type === 'identifier') {
    callsArr.push({ name: fn.text, receiver: null })
  } else if (fn.type === 'member_expression') {
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (prop) callsArr.push({ name: prop.text, receiver: obj ? obj.text : null })
  }
}

function handleFunctionLikeJs(node, name, ctx, out, kind) {
  const qnameParts = [...ctx.qname, name]
  const qname = qnameParts.join('.')
  const paramsNode = node.childForFieldName('parameters') || node.childForFieldName('parameter')
  let params = ''
  if (paramsNode) {
    params = paramsNode.type === 'formal_parameters' ? collapseWs(stripParens(paramsNode.text)) : collapseWs(paramsNode.text)
  }
  const returnNode = node.childForFieldName('return_type')
  const returns = returnNode ? collapseWs(returnNode.text.replace(/^:\s*/, '')) : ''
  const bodyNode = node.childForFieldName('body')
  const bodyText = bodyNode ? bodyNode.text : ''
  const calls = []
  const fnStack = [...ctx.fnStack, qname]
  const scopeChain = [...fnStack].reverse()
  scopeChain.push('')
  out.push({ qname, name, kind, line: node.startPosition.row + 1, params, returns, bodyText, calls, className: ctx.className, scopeChain })
  if (bodyNode) {
    walkJs(bodyNode, { qname: qnameParts, parentKind: 'fn', callsArr: calls, fnStack, className: ctx.className }, out)
  }
}

function extractJsTsImports(root) {
  const imports = {}
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (node.type === 'import_statement') {
      handleImportStatementJs(node, imports)
    } else if (node.type === 'variable_declarator') {
      handleRequireDeclarator(node, imports)
    }
    for (const c of node.namedChildren) stack.push(c)
  }
  return imports
}

function handleImportStatementJs(node, imports) {
  const sourceNode = node.childForFieldName('source')
  if (!sourceNode) return
  const mod = stripQuotes(sourceNode.text)
  for (const child of node.namedChildren) {
    if (child.type !== 'import_clause') continue
    for (const c of child.namedChildren) {
      if (c.type === 'identifier') {
        imports[c.text] = { module: mod, imported: 'default', kind: 'default' }
      } else if (c.type === 'namespace_import') {
        const idNode = c.namedChildren.find(x => x.type === 'identifier')
        if (idNode) imports[idNode.text] = { module: mod, imported: null, kind: 'namespace' }
      } else if (c.type === 'named_imports') {
        for (const spec of c.namedChildren) {
          if (spec.type !== 'import_specifier') continue
          const nameNode = spec.childForFieldName('name')
          const aliasNode = spec.childForFieldName('alias')
          const local = aliasNode ? aliasNode.text : (nameNode ? nameNode.text : null)
          const imported = nameNode ? nameNode.text : null
          if (local) imports[local] = { module: mod, imported, kind: 'named' }
        }
      }
    }
  }
}

function handleRequireDeclarator(node, imports) {
  const nameNode = node.childForFieldName('name')
  const valueNode = node.childForFieldName('value')
  if (!nameNode || !valueNode || valueNode.type !== 'call_expression') return
  const fn = valueNode.childForFieldName('function')
  if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return
  const argsNode = valueNode.childForFieldName('arguments')
  const strArg = argsNode && argsNode.namedChildren.find(a => a.type === 'string')
  if (!strArg) return
  const mod = stripQuotes(strArg.text)
  if (nameNode.type === 'identifier') {
    imports[nameNode.text] = { module: mod, imported: null, kind: 'namespace' }
  } else if (nameNode.type === 'object_pattern') {
    for (const p of nameNode.namedChildren) {
      if (p.type === 'shorthand_property_identifier_pattern') {
        imports[p.text] = { module: mod, imported: p.text, kind: 'named' }
      } else if (p.type === 'pair_pattern') {
        const keyNode = p.childForFieldName('key')
        const valNode = p.childForFieldName('value')
        if (keyNode && valNode) imports[valNode.text] = { module: mod, imported: keyNode.text, kind: 'named' }
      }
    }
  }
}

// ---------------------------------------------------------------- entry point

export async function extractFile(relPath, source) {
  const lang = langForPath(relPath)
  if (!lang) return { functions: [], imports: {}, errors: [], classes: [], data: null }

  const language = await getLanguage(lang)
  const parser = new Parser()
  try {
    parser.setLanguage(language)
    const tree = parser.parse(source)
    const errors = []
    if (tree.rootNode.hasError) {
      errors.push(`${relPath}: syntax error`)
    }
    const name = basename(relPath)
    if (lang === 'python') {
      const { functions, classes } = extractPython(tree.rootNode, name)
      // L3 data facts; a failure here must never cost the file its functions and calls.
      let data = null
      try {
        data = extractPythonData(tree.rootNode)
      } catch (e) {
        errors.push(`${relPath}: data extraction failed: ${e.message}`)
      }
      return { functions, imports: extractPythonImports(tree.rootNode), errors, classes, data }
    }
    const functions = extractJsTs(tree.rootNode, name)
    return { functions, imports: extractJsTsImports(tree.rootNode), errors, classes: [], data: null }
  } finally {
    parser.delete()
  }
}
