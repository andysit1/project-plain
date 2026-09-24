// Helpers shared by the e2e specs.
import { spawn } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..')
const DEMO_REPO = join(REPO_ROOT, 'tests', 'demo-repo')
const MAP_BIN = join(REPO_ROOT, 'map', 'bin', 'map.js')

const SERVING_RE = /map: serving .* at (http:\/\/\S+)/

/** Copy tests/demo-repo into a fresh temp directory and return its path. */
export function copyDemoRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'plain-demo-'))
  cpSync(DEMO_REPO, dir, { recursive: true })
  return dir
}

/**
 * Spawn `node map/bin/map.js <repoDir> --port 0 --no-open --debounce 100` with MAP_DATA_DIR
 * pointed at a fresh temp dir (or a caller-supplied one, so restarts can reuse it).
 * Resolves once the server prints its "serving ... at <url>" line.
 *
 * Returns { url, stop(), dataDir }.
 */
export function startMap(repoDir, { dataDir, timeoutMs = 20000 } = {}) {
  const resolvedDataDir = dataDir || mkdtempSync(join(tmpdir(), 'plain-data-'))

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [MAP_BIN, repoDir, '--port', '0', '--no-open', '--debounce', '100'],
      {
        env: { ...process.env, MAP_DATA_DIR: resolvedDataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(
        `map did not start within ${timeoutMs}ms: map/bin/map.js missing?\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      ))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      const m = stdout.match(SERVING_RE)
      if (m && !settled) {
        settled = true
        clearTimeout(timer)
        resolve({
          url: m[1],
          dataDir: resolvedDataDir,
          stop: () => stopChild(child),
        })
      }
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(
        `map did not start: map/bin/map.js missing? (spawn error: ${err.message})\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      ))
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(
        `map exited before it started serving (code=${code} signal=${signal}): map/bin/map.js missing or broken?\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
      ))
    })
  })
}

function stopChild(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
    child.kill()
    // Windows sometimes needs a harder kill for node child processes.
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, 3000)
  })
}

/** Wait until window.__plain.renders >= n. */
export function waitForRenders(page, n, opts = {}) {
  return page.waitForFunction(
    n => window.__plain && window.__plain.renders >= n,
    n,
    { timeout: 15000, ...opts }
  )
}

/** Return window.__plain.positions() from the page. */
export function positions(page) {
  return page.evaluate(() => window.__plain.positions())
}

/** Remove a temp dir tree, ignoring errors (best-effort cleanup). */
export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
}
