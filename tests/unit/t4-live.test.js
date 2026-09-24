import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  connect, loadLayout, saveLayout, flushLayout, _resetForTests,
} from '../../frontend/graph/components/live.js'
import { emptyLayout } from '../../shared/contracts.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

function jsonResponse(body, opts = {}) {
  return { ok: opts.ok !== false, status: opts.status ?? 200, json: async () => body }
}

// -------------------------------------------------------------- fake EventSource

class FakeEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.onopen = null
    this.onerror = null
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb)
  }
  close() { this.closed = true }
  emit(type, data) {
    for (const cb of this.listeners[type] || []) cb({ data: JSON.stringify(data) })
  }
}
FakeEventSource.instances = []

let openConnections = []

beforeEach(() => {
  _resetForTests()
  FakeEventSource.instances = []
  delete globalThis.fetch
  delete globalThis.EventSource
  openConnections = []
})

afterEach(() => {
  for (const c of openConnections) c.close()
  delete globalThis.fetch
  delete globalThis.EventSource
})

// -------------------------------------------------------------- saveLayout / loadLayout

test('10 patches within 200ms produce exactly one POST containing all 10', async () => {
  const posts = []
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, '/layout')
    if (!opts) return jsonResponse(emptyLayout())
    posts.push(JSON.parse(opts.body))
    return jsonResponse(null, { status: 204 })
  }

  for (let i = 0; i < 10; i++) {
    saveLayout({ nodes: { [`n${i}`]: { x: i, y: i } } })
  }
  await flushLayout()

  assert.equal(posts.length, 1)
  assert.equal(Object.keys(posts[0].nodes).length, 10)
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(posts[0].nodes[`n${i}`], { x: i, y: i })
  }
})

test('null deletions in a patch are honoured in the posted layout', async () => {
  const posts = []
  globalThis.fetch = async (url, opts) => {
    if (!opts) return jsonResponse({ version: 1, nodes: { a: { x: 0, y: 0 } }, groups: {}, orphans: {} })
    posts.push(JSON.parse(opts.body))
    return jsonResponse(null, { status: 204 })
  }

  await loadLayout()
  saveLayout({ nodes: { a: null, b: { x: 1, y: 2 } } })
  await flushLayout()

  assert.equal(posts.length, 1)
  assert.equal(posts[0].nodes.a, undefined)
  assert.deepEqual(posts[0].nodes.b, { x: 1, y: 2 })
})

test('a failing POST is retried and eventually posts the combined patches', async () => {
  const posts = []
  let attempts = 0
  globalThis.fetch = async (url, opts) => {
    if (!opts) return jsonResponse(emptyLayout())
    attempts++
    if (attempts === 1) return jsonResponse({ error: 'boom' }, { ok: false, status: 500 })
    posts.push(JSON.parse(opts.body))
    return jsonResponse(null, { status: 204 })
  }

  saveLayout({ nodes: { a: { x: 1, y: 1 } } })
  // let the first (failing) flush happen, and merge in a second patch before the retry fires
  await sleep(600)
  saveLayout({ nodes: { b: { x: 2, y: 2 } } })
  await flushLayout()

  assert.equal(attempts, 2)
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].nodes.a, { x: 1, y: 1 })
  assert.deepEqual(posts[0].nodes.b, { x: 2, y: 2 })
})

test('empty patches are ignored and never trigger a POST', async () => {
  let postCount = 0
  globalThis.fetch = async (url, opts) => {
    if (!opts) return jsonResponse(emptyLayout())
    postCount++
    return jsonResponse(null, { status: 204 })
  }
  saveLayout({})
  saveLayout({ nodes: {} })
  await flushLayout()
  assert.equal(postCount, 0)
})

// -------------------------------------------------------------- connect (SSE)

test('connect delivers parsed graph/status/hello events and connection states', async () => {
  globalThis.EventSource = FakeEventSource

  const events = []
  const conn = connect({
    onHello: h => events.push(['hello', h]),
    onGraph: g => events.push(['graph', g]),
    onStatus: s => events.push(['status', s]),
    onConnection: st => events.push(['state', st]),
  })
  openConnections.push(conn)

  assert.equal(FakeEventSource.instances.length, 1)
  const es = FakeEventSource.instances[0]
  assert.equal(es.url, '/events')
  assert.deepEqual(events[0], ['state', 'connecting'])

  es.onopen()
  assert.deepEqual(events[1], ['state', 'open'])

  const hello = { root: 'C:/code/myrepo' }
  const graph = { version: 1, root: 'C:/code/myrepo', builtAt: 1, nodes: [], edges: [], errors: [] }
  const status = { reason: 'start', at: 1, ms: 5, changed: 0 }
  es.emit('hello', hello)
  es.emit('graph', graph)
  es.emit('status', status)

  assert.deepEqual(events[2], ['hello', hello])
  assert.deepEqual(events[3], ['graph', graph])
  assert.deepEqual(events[4], ['status', status])

  conn.close()
})

test('connect reconnects with backoff after an error, and close() stops it', async () => {
  globalThis.EventSource = FakeEventSource

  const states = []
  const conn = connect({ onConnection: st => states.push(st) })
  openConnections.push(conn)

  assert.equal(FakeEventSource.instances.length, 1)
  const es1 = FakeEventSource.instances[0]
  es1.onopen()

  es1.onerror()
  assert.ok(es1.closed)
  assert.equal(states[states.length - 1], 'closed')

  // backoff starts at 1s after a successful open; wait past it
  await sleep(1200)
  assert.equal(FakeEventSource.instances.length, 2, 'should have reconnected after backoff')

  const es2 = FakeEventSource.instances[1]
  const before = FakeEventSource.instances.length
  conn.close()
  es2.onerror() // simulate a stray error after close; must not reconnect
  await sleep(1200)
  assert.equal(FakeEventSource.instances.length, before, 'close() must stop reconnection')
})
