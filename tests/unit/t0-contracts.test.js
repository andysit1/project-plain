import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync, spawnSync } from 'node:child_process'
import {
  validateGraph, validateLayout, validateLayoutPatch, emptyLayout, applyLayoutPatch,
  combinePatches, isEmptyPatch, dirOf,
} from '../../shared/contracts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fx = name => JSON.parse(readFileSync(join(ROOT, 'shared', 'fixtures', name), 'utf8'))

test('every fixture passes its validator', () => {
  for (const g of ['graph.small.json', 'graph.small.v2.json', 'graph.large.json']) validateGraph(fx(g))
  validateLayout(fx('layout.small.json'))
  validateLayout(emptyLayout())
  assert.equal(fx('graph.small.json').nodes.length, 15)
  assert.equal(fx('graph.large.json').nodes.length, 6000)
})

test('validators report the path of the first bad field', () => {
  const g = fx('graph.small.json')
  g.nodes[3].sig = 'nothex!!'
  assert.throws(() => validateGraph(g), /graph\.nodes\[3\]\.sig/)
  const e = fx('graph.small.json')
  e.edges[0].to = 'nope::x'; e.edges[0].id = e.edges[0].from + '>nope::x'
  assert.throws(() => validateGraph(e), /graph\.edges\[0\]\.to/)
  assert.throws(() => validateLayout({ ...emptyLayout(), nodes: { a: { x: 1 } } }), /layout\.nodes\["a"\]\.y/)
  assert.throws(() => validateLayout({ ...emptyLayout(), nodes: { a: null } }), /layout\.nodes\["a"\]/)
  validateLayoutPatch({ nodes: { a: null, b: { x: 0, y: 0 } } })
})

test('layout patches merge, delete with null, and detect emptiness', () => {
  const l = applyLayoutPatch(fx('layout.small.json'), { nodes: { 'app/main.py::main': null, 'x::y': { x: 1, y: 2 } } })
  assert.equal(l.nodes['app/main.py::main'], undefined)
  assert.deepEqual(l.nodes['x::y'], { x: 1, y: 2 })
  const c = combinePatches({ nodes: { a: { x: 1, y: 1 } } }, { nodes: { a: null, b: { x: 2, y: 2 } } })
  assert.deepEqual(c, { nodes: { a: null, b: { x: 2, y: 2 } } })
  assert.ok(isEmptyPatch({}) && isEmptyPatch({ nodes: {} }) && !isEmptyPatch({ orphans: { a: null } }))
  assert.equal(dirOf('app/main.py'), 'app')
  assert.equal(dirOf('main.py'), '.')
})

// a throwaway git repo holding a copy of tasks/, so locks and hooks never touch the real checkout
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 't0-'))
  cpSync(join(ROOT, 'tasks'), join(dir, 'tasks'), { recursive: true, filter: s => !s.endsWith('.lock') })
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't0@test'); git('config', 'user.name', 't0')
  return { dir, git }
}

test('two simultaneous claims produce exactly one lock', async () => {
  const { dir } = sandbox()
  const run = agent => new Promise(res => {
    const p = spawn(process.execPath, [join(dir, 'tasks', 'claim.mjs'), 'T5', '--agent', agent], { cwd: dir })
    p.on('exit', code => res(code))
  })
  const codes = await Promise.all([run('a'), run('b'), run('c'), run('d')])
  assert.equal(codes.filter(c => c === 0).length, 1, `exit codes ${codes}`)
  assert.deepEqual(readdirSync(join(dir, 'tasks', 'claims')).filter(f => f.endsWith('.lock')), ['T5.lock'])
})

test('guard rejects a commit on task/T5-x that touches map/src/server.js', () => {
  const { dir, git } = sandbox()
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('checkout', '-q', '-b', 'task/T5-x')
  mkdirSync(join(dir, 'map', 'src'), { recursive: true })
  mkdirSync(join(dir, 'frontend', 'graph', 'components'), { recursive: true })
  writeFileSync(join(dir, 'frontend', 'graph', 'components', 'merge.js'), '// ok\n')
  git('add', 'frontend/graph/components/merge.js')
  let r = spawnSync(process.execPath, [join(dir, 'tasks', 'guard.mjs')], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  writeFileSync(join(dir, 'map', 'src', 'server.js'), '// not T5\n')
  git('add', 'map/src/server.js')
  r = spawnSync(process.execPath, [join(dir, 'tasks', 'guard.mjs')], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /map\/src\/server\.js\s+\(owned by T3\)/)
})

test('owners.json globs do not overlap', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tasks', 'claim.mjs'), '--check-owners'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
