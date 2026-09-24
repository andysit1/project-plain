// Live data client: SSE graph/status feed + layout load/save.
// Browser-only, no bundler. Imports ONLY shared/contracts.js.
// Owned by T4. See shared/api.md for the /events, /layout contract.

import {
  applyLayoutPatch, combinePatches, isEmptyPatch, validateLayout, SAVE_DEBOUNCE_MS,
} from '../../../shared/contracts.js'

const MAX_BACKOFF_MS = 10000

// ---------------------------------------------------------------- connect (SSE)

/**
 * Wraps EventSource('/events') with JSON parsing and reconnect-with-backoff.
 * @param {{ onGraph?: (g: object) => void, onStatus?: (s: object) => void,
 *   onConnection?: (state: 'connecting'|'open'|'closed') => void,
 *   onHello?: (h: object) => void, url?: string }} opts
 * @returns {{ close(): void }}
 */
export function connect({ onGraph, onStatus, onConnection, onHello, url = '/events' } = {}) {
  let source = null
  let closed = false
  let backoff = 1000
  let retryTimer = null

  function notify(state) {
    if (onConnection) onConnection(state)
  }

  function open() {
    if (closed) return
    notify('connecting')
    const EventSourceCtor = globalThis.EventSource
    const es = new EventSourceCtor(url)
    source = es

    es.addEventListener('hello', evt => {
      if (onHello) onHello(JSON.parse(evt.data))
    })
    es.addEventListener('graph', evt => {
      if (onGraph) onGraph(JSON.parse(evt.data))
    })
    es.addEventListener('status', evt => {
      if (onStatus) onStatus(JSON.parse(evt.data))
    })
    es.onopen = () => {
      backoff = 1000
      notify('open')
    }
    es.onerror = () => {
      es.close()
      notify('closed')
      if (closed) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        open()
      }, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    }
  }

  open()

  return {
    close() {
      closed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (source) {
        source.close()
        source = null
      }
    },
  }
}

// ---------------------------------------------------------------- layout load/save

let base = null // last known Layout (save base)
let pending = null // pending LayoutPatch, not yet flushed
let flushTimer = null
let saveBackoff = 1000
let waiters = [] // resolve fns for flushLayout() while a save is in flight/pending

function resolveWaitersIfIdle() {
  if (!pending && !flushTimer) {
    const ws = waiters
    waiters = []
    for (const w of ws) w()
  }
}

/** GET /layout -> validateLayout -> Layout. Remembers the result as the save base. */
export async function loadLayout() {
  const fetchFn = globalThis.fetch
  const res = await fetchFn('/layout')
  const json = await res.json()
  const layout = validateLayout(json)
  base = layout
  return layout
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    doFlush()
  }, SAVE_DEBOUNCE_MS)
}

async function doFlush() {
  if (!pending || isEmptyPatch(pending)) {
    pending = null
    resolveWaitersIfIdle()
    return
  }
  if (!base) {
    try {
      await loadLayout()
    } catch {
      // couldn't load base; retry with backoff
      retryFlush()
      return
    }
  }

  const patchToSend = pending
  const fullLayout = applyLayoutPatch(base, patchToSend)

  try {
    const fetchFn = globalThis.fetch
    const res = await fetchFn('/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullLayout),
    })
    if (!res.ok) throw new Error(`POST /layout failed: ${res.status}`)

    // success: if nothing new arrived while this POST was in flight, clear pending.
    // If new patches did arrive (pending is now a different, combined object), keep them;
    // they already include patchToSend's entries, so the next flush simply resends them
    // (harmless: applying the same key twice is idempotent).
    if (pending === patchToSend) pending = null
    base = fullLayout
    saveBackoff = 1000

    if (pending && !isEmptyPatch(pending)) {
      scheduleFlush()
    } else {
      pending = null
      resolveWaitersIfIdle()
    }
  } catch {
    // keep patch pending (already combined with any newer arrivals), retry with backoff
    retryFlush()
  }
}

function retryFlush() {
  const delay = saveBackoff
  saveBackoff = Math.min(saveBackoff * 2, MAX_BACKOFF_MS)
  flushTimer = setTimeout(() => {
    flushTimer = null
    doFlush()
  }, delay)
}

/** Combines patch into the pending save, throttled to at most one POST per SAVE_DEBOUNCE_MS. */
export function saveLayout(patch) {
  if (isEmptyPatch(patch)) return
  pending = pending ? combinePatches(pending, patch) : patch
  scheduleFlush()
}

/** Resolves when nothing is pending (no pending patch, no scheduled/in-flight flush). */
export function flushLayout() {
  if (!pending && !flushTimer) return Promise.resolve()
  return new Promise(resolve => waiters.push(resolve))
}

/** Clears all module state. For tests only. */
export function _resetForTests() {
  base = null
  pending = null
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  saveBackoff = 1000
  waiters = []
}
