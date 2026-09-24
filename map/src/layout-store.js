// Layout persistence for map. Owned by T2. See shared/api.md "Layout storage" and
// "Environment override", and shared/contracts.js for the Layout shape.
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, resolve } from 'node:path'
import {
  mkdir, readFile, writeFile, rename, unlink,
} from 'node:fs/promises'
import { validateLayout, emptyLayout } from '../../shared/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// map/src -> project-plain root
const DEFAULT_DATA_ROOT = join(__dirname, '..', '..', 'data')

/** Normalises an absolute repo root to a stable string: forward slashes, lowercase drive letter. */
function normaliseRoot(repoRoot) {
  let abs = resolve(repoRoot).split('\\').join('/')
  abs = abs.replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}:`)
  return abs
}

function dataRoot() {
  return process.env.MAP_DATA_DIR || DEFAULT_DATA_ROOT
}

// Per-directory promise chains so concurrent writeLayout calls to the same repo serialise.
const writeChains = new Map()

/** Returns the per-repo data directory, creating it on first use. */
export async function dataDirFor(repoRoot) {
  const norm = normaliseRoot(repoRoot)
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 8)
  const dir = join(dataRoot(), `${basename(norm)}-${hash}`)
  await mkdir(dir, { recursive: true })
  return dir
}

function layoutPath(dir) {
  return join(dir, 'layout.json')
}

async function sleep(ms) {
  return new Promise(res => setTimeout(res, ms))
}

/** Rename with retries: on Windows, renaming over an open-handle target can EPERM/EBUSY transiently. */
async function renameWithRetry(from, to, attempts = 5, delayMs = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      const retryable = e && (e.code === 'EPERM' || e.code === 'EBUSY')
      if (!retryable || i === attempts - 1) throw e
      await sleep(delayMs)
    }
  }
}

/** Reads and validates the layout for repoRoot. Missing -> emptyLayout(). Corrupt -> quarantined, emptyLayout(). */
export async function readLayout(repoRoot) {
  const dir = await dataDirFor(repoRoot)
  const file = layoutPath(dir)
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return emptyLayout()
    throw e
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
    validateLayout(parsed)
  } catch {
    await quarantine(dir, file)
    return emptyLayout()
  }
  return parsed
}

async function quarantine(dir, file) {
  const bad = join(dir, `layout.bad-${Date.now()}.json`)
  try {
    await renameWithRetry(file, bad)
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e
  }
}

/** Validates and writes the layout for repoRoot. Writes to the same repo are serialised. */
export async function writeLayout(repoRoot, layout) {
  // Validate up front so a bad layout rejects immediately and never enters the queue
  // (and never disturbs an in-flight write for the same repo). `writeLayout` is declared
  // async so this synchronous throw becomes a proper promise rejection for callers.
  validateLayout(layout)

  const norm = normaliseRoot(repoRoot)
  const prev = writeChains.get(norm) || Promise.resolve()
  const next = prev
    .catch(() => {}) // don't let a previous failure poison the chain
    .then(() => doWrite(repoRoot, layout))
  writeChains.set(norm, next)
  return next
}

async function doWrite(repoRoot, layout) {
  const dir = await dataDirFor(repoRoot)
  const file = layoutPath(dir)
  const tmp = `${file}.tmp`
  const body = JSON.stringify(layout)
  await writeFile(tmp, body, 'utf8')
  try {
    await renameWithRetry(tmp, file)
  } catch (e) {
    try { await unlink(tmp) } catch {}
    throw e
  }
}
