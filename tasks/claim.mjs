#!/usr/bin/env node
// Task claim locks. Locks live in <main worktree>/tasks/claims/Tn.lock so all git worktrees share them.
//
//   node tasks/claim.mjs T5 --agent <name>            claim (exclusive create; exit 1 if taken)
//   node tasks/claim.mjs T5 --heartbeat [--agent n]   refresh heartbeat (do this every <= 30 min)
//   node tasks/claim.mjs T5 --release --agent <name>  release your own lock
//   node tasks/claim.mjs T5 --release --force         coordinator only: release any lock
//   node tasks/claim.mjs --status                     list locks, flag stale ones (> 2 h)
//   node tasks/claim.mjs --check-owners               verify no path is owned by two tasks
import { openSync, writeSync, closeSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadOwners, matches, git, mainWorktree, REPO } from './owners.mjs'

const STALE_MS = 2 * 60 * 60 * 1000
const CLAIMS = join(mainWorktree(), 'tasks', 'claims')
const args = process.argv.slice(2)
const flag = f => args.includes(f)
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const id = args.find(a => /^T\d+$/.test(a))
const lockPath = t => join(CLAIMS, `${t}.lock`)
const die = (msg, code = 1) => { console.error(msg); process.exit(code) }
const readLock = t => JSON.parse(readFileSync(lockPath(t), 'utf8'))

mkdirSync(CLAIMS, { recursive: true })

if (flag('--check-owners')) process.exit(checkOwners())
if (flag('--status')) { status(); process.exit(0) }
if (!id) die('usage: claim.mjs Tn --agent <name> | --heartbeat | --release [--force] ; claim.mjs --status | --check-owners', 2)

const owners = loadOwners()
if (!owners[id]) die(`unknown task ${id}`)

if (flag('--heartbeat')) {
  if (!existsSync(lockPath(id))) die(`${id} is not claimed`)
  const lock = readLock(id)
  const agent = opt('--agent')
  if (agent && agent !== lock.agent) die(`${id} is held by ${lock.agent}, not ${agent}`)
  lock.heartbeat = Date.now()
  writeFileSync(lockPath(id), JSON.stringify(lock, null, 2))
  console.log(`${id} heartbeat ${new Date(lock.heartbeat).toISOString()}`)
} else if (flag('--release')) {
  if (!existsSync(lockPath(id))) die(`${id} is not claimed`, 0)
  const lock = readLock(id)
  if (!flag('--force') && opt('--agent') !== lock.agent) {
    die(`${id} is held by ${lock.agent}; pass --agent ${lock.agent} to release your own lock, or --force (coordinator only)`)
  }
  rmSync(lockPath(id))
  console.log(`${id} released`)
} else {
  const agent = opt('--agent')
  if (!agent) die('--agent <name> is required to claim')
  const now = Date.now()
  const lock = { task: id, agent, startedAt: now, heartbeat: now, owns: owners[id].owns, pid: process.pid }
  let fd
  try {
    fd = openSync(lockPath(id), 'wx') // exclusive create: exactly one racer wins
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    let held = '?'
    try { held = readLock(id).agent } catch {}
    die(`${id} is already claimed by ${held}; pick another task`)
  }
  writeSync(fd, JSON.stringify(lock, null, 2))
  closeSync(fd)
  console.log(`${id} claimed by ${agent}`)
}

function status() {
  const locks = readdirSync(CLAIMS).filter(f => f.endsWith('.lock'))
  if (!locks.length) { console.log('no claims'); return }
  for (const f of locks) {
    let l
    try { l = JSON.parse(readFileSync(join(CLAIMS, f), 'utf8')) } catch { console.log(`${f}: unreadable (being written?)`); continue }
    const age = Date.now() - l.heartbeat
    console.log(`${l.task.padEnd(4)} ${l.agent.padEnd(24)} heartbeat ${Math.round(age / 60000)} min ago${age > STALE_MS ? '  STALE' : ''}`)
  }
}

function checkOwners() {
  const owners = loadOwners()
  const tasks = Object.entries(owners).filter(([, t]) => !t.fallback)
  const problems = []
  // 1) every glob, instantiated as a sample path, must match no other task's globs
  for (const [a, ta] of tasks) {
    for (const g of ta.owns) {
      const samples = [g.replace(/\*\*/g, 'zz/zz').replace(/\*/g, 'zz').replace(/\?/g, 'z'), g.replace(/\/\*\*$/, '/x.js').replace(/\*/g, 'x')]
      for (const s of samples) {
        for (const [b, tb] of tasks) {
          if (a !== b && tb.owns.some(h => matches(h, s))) problems.push(`${a} glob "${g}" (e.g. ${s}) overlaps ${b}`)
        }
      }
    }
  }
  // 2) every file in the working tree must be owned by at most one task
  let files = []
  try { files = git(['ls-files', '--cached', '--others', '--exclude-standard'], REPO).split('\n').filter(Boolean) } catch {}
  for (const f of files) {
    const who = tasks.filter(([, t]) => t.owns.some(g => matches(g, f))).map(([k]) => k)
    if (who.length > 1) problems.push(`${f} is owned by ${who.join(', ')}`)
  }
  const uniq = [...new Set(problems)]
  if (uniq.length) { console.error(uniq.join('\n')); return 1 }
  console.log(`owners ok: ${tasks.length} tasks, ${files.length} files, no overlaps`)
  return 0
}
