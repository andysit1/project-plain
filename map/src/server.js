// map server: static files for the canvas, SSE graph/status stream, layout
// persistence and the editor-open endpoint. See shared/api.md for the contract.
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { validateLayout } from '../../shared/contracts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// map/src/server.js -> project-plain root is two levels up (map/ -> project-plain/)
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..')

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

const WATCH_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const DEFAULT_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__', '.venv', 'venv'])

function simpleGlobToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/**
 * @param {string} root absolute path of the watched repository
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.host]
 * @param {string} [opts.editor]
 * @param {number} [opts.debounce]
 * @param {string[]} [opts.ignore]
 * @param {boolean} [opts.watch]
 * @param {string} [opts.staticRoot] project-plain root override, for tests
 * @param {object} [deps]
 * @param {Function} [deps.buildGraph]
 * @param {object} [deps.layoutStore]
 * @param {Function} [deps.runEditor]
 */
export async function startServer(root, opts = {}, deps = {}) {
  const {
    port = 7070,
    host = '127.0.0.1',
    editor = 'code -g {file}:{line}',
    debounce = 200,
    ignore = [],
    watch = true,
    staticRoot,
  } = opts

  const projectRoot = staticRoot ? path.resolve(staticRoot) : DEFAULT_PROJECT_ROOT
  const graphRoot = path.join(projectRoot, 'frontend', 'graph')
  const sharedRoot = path.join(projectRoot, 'shared')
  const absRoot = path.resolve(root)

  const buildGraph = deps.buildGraph ?? (await import('./graph.js')).buildGraph
  const layoutStore = deps.layoutStore ?? (await import('./layout-store.js'))
  const runEditor = deps.runEditor ?? defaultRunEditor

  const ignoreRegexes = ignore.map(simpleGlobToRegExp)

  /** @type {import('../../shared/contracts.js').CodeGraph | null} */
  let lastGraph = null
  /** @type {{reason:string, at:number, ms:number, changed:number} | null} */
  let lastStatus = null

  /** @type {Set<http.ServerResponse>} */
  const sseClients = new Set()

  function sseSend(res, event, data) {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  function broadcast(event, data) {
    for (const res of sseClients) {
      try { sseSend(res, event, data) } catch { /* client gone */ }
    }
  }

  // ---- rebuild coalescing ----
  let building = false
  let pendingReason = null

  async function rebuild(reason) {
    if (building) {
      pendingReason = reason
      return
    }
    building = true
    const start = Date.now()
    const stats = { changed: 0 }
    try {
      const graph = await buildGraph(absRoot, { ignore, stats })
      lastGraph = graph
      lastStatus = { reason, at: Date.now(), ms: Date.now() - start, changed: stats.changed ?? 0 }
      broadcast('graph', lastGraph)
      broadcast('status', lastStatus)
    } catch (err) {
      lastStatus = { reason: 'error', at: Date.now(), ms: Date.now() - start, changed: stats.changed ?? 0 }
      broadcast('status', lastStatus)
      console.error('map: build failed:', err && err.stack ? err.stack : err)
    } finally {
      building = false
      if (pendingReason !== null) {
        const next = pendingReason
        pendingReason = null
        await rebuild(next)
      }
    }
  }

  // ---- static file serving with traversal guard ----
  async function serveStatic(res, baseDir, relPath) {
    const decoded = decodeURIComponent(relPath)
    const resolved = path.resolve(baseDir, '.' + path.sep + decoded)
    const relCheck = path.relative(baseDir, resolved)
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('Forbidden')
      return
    }
    try {
      const st = await stat(resolved)
      if (st.isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        res.end('Not found')
        return
      }
      const body = await readFile(resolved)
      res.writeHead(200, { 'Content-Type': contentTypeFor(resolved), 'Cache-Control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('Not found')
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', chunk => { data += chunk })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      const pathname = u.pathname

      if (req.method === 'GET' && pathname === '/') {
        await serveStatic(res, graphRoot, '/index.html')
        return
      }
      if (req.method === 'GET' && pathname.startsWith('/graph/')) {
        await serveStatic(res, graphRoot, pathname.slice('/graph'.length))
        return
      }
      if (req.method === 'GET' && pathname.startsWith('/shared/')) {
        await serveStatic(res, sharedRoot, pathname.slice('/shared'.length))
        return
      }
      if (req.method === 'GET' && pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'Connection': 'keep-alive',
        })
        res.write('\n')
        sseSend(res, 'hello', { root: absRoot })
        if (lastGraph) sseSend(res, 'graph', lastGraph)
        if (lastStatus) sseSend(res, 'status', lastStatus)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }
      if (req.method === 'GET' && pathname === '/layout') {
        const layout = await layoutStore.readLayout(absRoot)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(layout))
        return
      }
      if (req.method === 'POST' && pathname === '/layout') {
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'invalid JSON' }))
          return
        }
        try {
          validateLayout(body)
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: err.message }))
          return
        }
        await layoutStore.writeLayout(absRoot, body)
        res.writeHead(204, { 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      if (req.method === 'POST' && pathname === '/open') {
        const file = u.searchParams.get('file')
        const line = u.searchParams.get('line') || '1'
        if (!file) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'file is required' }))
          return
        }
        const absFile = path.resolve(absRoot, file)
        const relCheck = path.relative(absRoot, absFile)
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'file resolves outside repo root' }))
          return
        }
        const cmd = editor.replace('{file}', absFile).replace('{line}', line)
        try {
          runEditor(cmd)
        } catch (err) {
          console.error('map: failed to run editor:', err)
        }
        res.writeHead(204, { 'Cache-Control': 'no-store' })
        res.end()
        return
      }

      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('Not found')
    } catch (err) {
      console.error('map: request handler error:', err && err.stack ? err.stack : err)
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        res.end('Internal error')
      } catch { /* headers already sent */ }
    }
  })

  // ---- SSE ping ----
  const pingInterval = setInterval(() => {
    for (const res of sseClients) {
      try { res.write(': ping\n\n') } catch { /* client gone */ }
    }
  }, 15000)
  pingInterval.unref?.()

  // ---- watcher ----
  let watcher = null
  let debounceTimer = null
  if (watch) {
    const shouldIgnore = (relPath) => {
      const parts = relPath.split(path.sep)
      if (parts.some(p => DEFAULT_IGNORE_DIRS.has(p))) return true
      return ignoreRegexes.some(re => re.test(relPath) || re.test(parts[parts.length - 1]))
    }
    try {
      watcher = fs.watch(absRoot, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const rel = filename.toString()
        const ext = path.extname(rel).toLowerCase()
        if (!WATCH_EXTS.has(ext)) return
        if (shouldIgnore(rel)) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => { rebuild('change') }, debounce)
      })
    } catch (err) {
      console.error('map: failed to start watcher:', err)
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  const actualPort = server.address().port
  const url = `http://${host}:${actualPort}`

  await rebuild('start')

  function close() {
    clearInterval(pingInterval)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (watcher) watcher.close()
    for (const res of sseClients) {
      try { res.end() } catch { /* already closed */ }
    }
    sseClients.clear()
    return new Promise((resolve) => server.close(() => resolve()))
  }

  return { url, port: actualPort, close, rebuild }
}

function defaultRunEditor(cmdString) {
  const child = spawn(cmdString, { shell: true, detached: true, stdio: 'ignore' })
  child.unref()
  return child
}
