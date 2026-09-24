#!/usr/bin/env node
// Ownership guard. Rejects changes outside the current task's globs in tasks/owners.json.
//
//   node tasks/guard.mjs                          pre-commit mode: staged paths vs branch task/Tn-...
//   node tasks/guard.mjs --range main...HEAD [--task Tn]   review mode: a branch's whole diff
//
// Branches not named task/Tn-... (main, integration branches) are not checked.
// Scope comes from owners.json, never from the lock, so an agent cannot widen its own scope.
import { loadOwners, mayWrite, ownersOf, git, taskFromBranch } from './owners.mjs'

const args = process.argv.slice(2)
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const cwd = process.cwd()

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
const task = opt('--task') || taskFromBranch(branch)
if (!task) process.exit(0)

const owners = loadOwners()
if (!owners[task]) { console.error(`guard: unknown task ${task} (branch ${branch})`); process.exit(1) }

const range = opt('--range')
const out = range
  ? git(['diff', '--name-only', '--no-renames', range], cwd)
  : git(['diff', '--cached', '--name-only', '--no-renames'], cwd)
const paths = out.split('\n').filter(Boolean)
const bad = paths.filter(p => !mayWrite(task, p, owners))

if (bad.length) {
  console.error(`guard: ${task} may not write these paths:`)
  for (const p of bad) {
    const who = ownersOf(p, owners)
    console.error(`  ${p}  (owned by ${who.length ? who.join(', ') : 'T12 / unowned'})`)
  }
  console.error(`Unstage them and file a change request in tasks/requests/${task}-to-<owner>-NNN.md instead.`)
  process.exit(1)
}
if (range) console.log(`guard: ${paths.length} paths in ${range}, all owned by ${task}`)
