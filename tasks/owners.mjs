// Shared helpers for claim.mjs and guard.mjs: owners.json loading, glob matching, repo paths.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TASKS_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO = dirname(TASKS_DIR)

export function loadOwners() {
  return JSON.parse(readFileSync(join(TASKS_DIR, 'owners.json'), 'utf8')).tasks
}

/** Glob -> RegExp. Supports **, *, ?. Paths are repo-relative with forward slashes. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      const slashAfter = glob[i + 2] === '/'
      if (slashAfter) { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const cache = new Map()
export function matches(glob, path) {
  if (!cache.has(glob)) cache.set(glob, globToRegExp(glob))
  return cache.get(glob).test(path)
}

/** Task ids (excluding fallback tasks) whose globs match `path`. */
export function ownersOf(path, owners = loadOwners()) {
  return Object.entries(owners)
    .filter(([, t]) => !t.fallback && t.owns.some(g => matches(g, path)))
    .map(([id]) => id)
}

/** May task `id` write `path`? */
export function mayWrite(id, path, owners = loadOwners()) {
  const task = owners[id]
  if (!task) return false
  if (task.fallback) {
    const who = ownersOf(path, owners)
    return who.length === 0 || who.every(t => (task.grants || []).includes(t))
  }
  return task.owns.some(g => matches(g, path))
}

export function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Checkout that holds the shared tasks/claims/ dir: the MAIN worktree, so every
 * git worktree of this repo sees the same locks. */
export function mainWorktree() {
  try {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    return dirname(common)
  } catch { return REPO }
}

export function taskFromBranch(branch) {
  const m = /^task\/(T\d+)(?:-|$)/.exec(branch || '')
  return m ? m[1] : null
}
