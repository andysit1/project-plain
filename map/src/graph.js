// Builds a CodeGraph (shared/contracts.js) for a repo: walks the tree, extracts every
// file with extract.js, then resolves calls into edges.
//
// Call resolution rules, tried in order for each recorded call { name, receiver }:
//   1. receiver is "self" or "this": resolves to method `name` of the class enclosing
//      the call site, in the same file. No match -> dropped.
//   2. receiver is null (a bare `f()`):
//      a. same-file, searched innermost scope first then outward to the top level
//         (the calling function's own qname, then its enclosing function(s), then
//         the file's top level);
//      b. otherwise, if `name` is an imported local binding, follow the import to its
//         target file (Python dotted/relative modules; TS/JS relative paths with
//         extension/index resolution) and look for a same-named top-level function
//         there;
//      c. otherwise, the unique function named `name` across the whole repo, if there
//         is exactly one.
//   3. receiver is a name bound to an imported module/namespace (`import mod`,
//      `import * as mod`, `const mod = require(...)`): resolves to `name` in that
//      module's file.
//   4. any other receiver (`X.f()`): resolves only if exactly one function or method
//      named `name` exists anywhere in the repo.
// In every case: a call that resolves to its own enclosing function (recursion) is
// dropped, and a call that cannot be resolved unambiguously is dropped. Edges are
// deduplicated by id.
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { extractFile } from './extract.js'
import { nodeId, edgeId, dirOf } from '../../shared/contracts.js'

const EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv', 'venv'])
const TS_RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// Module-level mtime parse cache: absolute path -> { mtimeMs, size, result }.
const parseCache = new Map()

export function clearCache() {
  parseCache.clear()
}

function hash8(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

function toRepoRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/')
}

// ---------------------------------------------------------------- ignore globs

const globCache = new Map()
function globToRegExp(glob) {
  let cached = globCache.get(glob)
  if (cached) return cached
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  re += '$'
  cached = new RegExp(re)
  globCache.set(glob, cached)
  return cached
}

function matchesIgnore(relPath, globs) {
  if (!globs || !globs.length) return false
  return globs.some(g => globToRegExp(g).test(relPath))
}

// ---------------------------------------------------------------- walking

async function walkDir(dir, root, ignoreGlobs, out) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      if (matchesIgnore(toRepoRel(root, abs), ignoreGlobs)) continue
      await walkDir(abs, root, ignoreGlobs, out)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!EXTS.has(ext)) continue
      const rel = toRepoRel(root, abs)
      if (matchesIgnore(rel, ignoreGlobs)) continue
      out.push({ abs, rel })
    }
  }
}

// ---------------------------------------------------------------- import resolution

function splitDir(file) {
  const d = dirOf(file)
  return d === '.' ? [] : d.split('/')
}

/** Resolves a Python import entry ({module, imported}) from `fromFile` to a repo-relative file path, or null. */
function resolvePythonModuleFile(fromFile, entry, filesSet) {
  const moduleSpec = entry.module || ''
  const imported = entry.imported
  let segs
  let rest
  if (moduleSpec.startsWith('.')) {
    let i = 0
    while (moduleSpec[i] === '.') i++
    const levelsUp = i - 1
    rest = moduleSpec.slice(i)
    segs = splitDir(fromFile)
    for (let k = 0; k < levelsUp && segs.length; k++) segs.pop()
  } else {
    segs = []
    rest = moduleSpec
  }
  const restSegs = rest ? rest.split('.').filter(Boolean) : []
  const allSegs = [...segs, ...restSegs]
  const candidates = []
  if (allSegs.length) {
    candidates.push(allSegs.join('/') + '.py')
    candidates.push(allSegs.join('/') + '/__init__.py')
  }
  if (imported) {
    candidates.push([...allSegs, imported].join('/') + '.py')
  }
  for (const c of candidates) {
    if (filesSet.has(c)) return c
  }
  return null
}

/** Resolves a TS/JS relative import spec from `fromFile` to a repo-relative file path, or null. */
function resolveTsModuleFile(fromFile, moduleSpec, filesSet) {
  if (!moduleSpec.startsWith('.')) return null
  const baseSegs = splitDir(fromFile)
  const segs = [...baseSegs]
  for (const part of moduleSpec.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segs.pop()
    else segs.push(part)
  }
  const base = segs.join('/')
  for (const ext of TS_RESOLVE_EXTS) {
    if (filesSet.has(base + ext)) return base + ext
  }
  for (const ext of TS_RESOLVE_EXTS) {
    const candidate = (base ? base + '/' : '') + 'index' + ext
    if (filesSet.has(candidate)) return candidate
  }
  return null
}

function resolveImportFile(fromFile, entry, filesSet) {
  if (fromFile.endsWith('.py')) return resolvePythonModuleFile(fromFile, entry, filesSet)
  return resolveTsModuleFile(fromFile, entry.module, filesSet)
}

// ---------------------------------------------------------------- call resolution

function resolveCall(fromId, info, call, file, imports, fileNodeIds, globalByName, filesSet) {
  const { name, receiver } = call

  if (receiver === 'self' || receiver === 'this') {
    if (!info.className) return null
    const map = fileNodeIds.get(file)
    return (map && map.get(`${info.className}.${name}`)) || null
  }

  if (receiver == null) {
    const map = fileNodeIds.get(file)
    if (map) {
      for (const prefix of info.scopeChain) {
        const q = prefix ? `${prefix}.${name}` : name
        if (map.has(q)) return map.get(q)
      }
    }
    const entry = imports[name]
    if (entry) {
      const targetFile = resolveImportFile(file, entry, filesSet)
      if (targetFile) {
        const targetMap = fileNodeIds.get(targetFile)
        const targetQname = entry.imported || name
        if (targetMap && targetMap.has(targetQname)) return targetMap.get(targetQname)
      }
    }
    const candidates = globalByName.get(name)
    if (candidates && candidates.length === 1) return candidates[0]
    return null
  }

  const entry = imports[receiver]
  if (entry && (entry.kind === 'namespace' || entry.kind === 'module')) {
    const targetFile = resolveImportFile(file, entry, filesSet)
    if (targetFile) {
      const targetMap = fileNodeIds.get(targetFile)
      if (targetMap && targetMap.has(name)) return targetMap.get(name)
    }
    return null
  }

  const candidates = globalByName.get(name)
  if (candidates && candidates.length === 1) return candidates[0]
  return null
}

// ---------------------------------------------------------------- buildGraph

export async function buildGraph(root, opts = {}) {
  const absRoot = path.resolve(root)
  const errors = []
  const files = []
  await walkDir(absRoot, absRoot, opts.ignore, files)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  let changed = 0
  const fileResults = new Map() // rel -> { functions, imports, errors }
  for (const { abs, rel } of files) {
    let st
    try {
      st = await stat(abs)
    } catch (e) {
      errors.push(`${rel}: ${e.message}`)
      continue
    }
    const cached = parseCache.get(abs)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      fileResults.set(rel, cached.result)
      if (cached.result.errors) errors.push(...cached.result.errors)
      continue
    }
    try {
      const source = await readFile(abs, 'utf8')
      const result = await extractFile(rel, source)
      parseCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, result })
      fileResults.set(rel, result)
      errors.push(...result.errors)
      changed++
    } catch (e) {
      errors.push(`${rel}: ${e.message}`)
    }
  }
  if (opts.stats) opts.stats.changed = changed

  const filesSet = new Set(fileResults.keys())
  const nodes = []
  const nodeInfo = new Map() // id -> { file, qname, className, scopeChain, calls }
  const fileNodeIds = new Map() // file -> Map(qname -> id)
  const globalByName = new Map() // simple name -> [id...]

  for (const rel of [...fileResults.keys()].sort()) {
    const { functions } = fileResults.get(rel)
    for (const fn of functions) {
      const id = nodeId(rel, fn.qname)
      const sig = hash8(`${fn.params}->${fn.returns}`)
      const body = hash8(fn.bodyText.replace(/\s+/g, ' ').trim())
      nodes.push({
        id, name: fn.name, qname: fn.qname, file: rel, line: fn.line, kind: fn.kind,
        params: fn.params, returns: fn.returns, sig, body,
      })
      nodeInfo.set(id, {
        file: rel, qname: fn.qname, className: fn.className || null,
        scopeChain: fn.scopeChain || [''], calls: fn.calls || [],
      })
      if (!fileNodeIds.has(rel)) fileNodeIds.set(rel, new Map())
      fileNodeIds.get(rel).set(fn.qname, id)
      if (!globalByName.has(fn.name)) globalByName.set(fn.name, [])
      globalByName.get(fn.name).push(id)
    }
  }

  const edgeMap = new Map()
  for (const [id, info] of nodeInfo) {
    const imports = (fileResults.get(info.file) || {}).imports || {}
    for (const call of info.calls) {
      const targetId = resolveCall(id, info, call, info.file, imports, fileNodeIds, globalByName, filesSet)
      if (!targetId || targetId === id) continue
      const eid = edgeId(id, targetId)
      if (!edgeMap.has(eid)) edgeMap.set(eid, { id: eid, from: id, to: targetId, kind: 'call' })
    }
  }

  return {
    version: 1,
    root: absRoot.split(path.sep).join('/'),
    builtAt: Date.now(),
    nodes,
    edges: [...edgeMap.values()],
    errors,
  }
}
