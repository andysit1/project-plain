import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyLayout } from '../../shared/contracts.js'

// MAP_DATA_DIR must be set before layout-store reads it. layout-store reads the env
// var at call time (not import time), so we can set a fresh temp dir per test.
const { dataDirFor, readLayout, writeLayout } = await import('../../map/src/layout-store.js')

function withTempDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 't2-'))
  process.env.MAP_DATA_DIR = dir
  return dir
}

function layoutWith(n) {
  return { version: 1, nodes: { [`f.py::n${n}`]: { x: n, y: n } }, groups: {}, orphans: {} }
}

test('dataDirFor is stable across path spellings and differs across repos', async () => {
  withTempDataDir()
  const d1 = await dataDirFor('C:\\some\\repo')
  const d2 = await dataDirFor('c:/some/repo/')
  assert.equal(d1, d2)

  const d3 = await dataDirFor('C:\\some\\other-repo')
  assert.notEqual(d1, d3)
  assert.ok(existsSync(d1))
})

test('missing layout file returns emptyLayout()', async () => {
  withTempDataDir()
  const l = await readLayout(join('some', 'repo', 'missing'))
  assert.deepEqual(l, emptyLayout())
})

test('writeLayout then readLayout round-trips', async () => {
  withTempDataDir()
  const repo = 'C:/repo/round-trip'
  const layout = layoutWith(1)
  await writeLayout(repo, layout)
  const read = await readLayout(repo)
  assert.deepEqual(read, layout)
  const dir = await dataDirFor(repo)
  assert.ok(!readdirSync(dir).some(f => f.endsWith('.tmp')))
})

test('corrupt layout file is quarantined and readLayout returns empty', async () => {
  withTempDataDir()
  const repo = 'C:/repo/corrupt'
  const dir = await dataDirFor(repo)
  writeFileSync(join(dir, 'layout.json'), '{ not valid json')
  const l = await readLayout(repo)
  assert.deepEqual(l, emptyLayout())
  const bad = readdirSync(dir).filter(f => f.startsWith('layout.bad-'))
  assert.equal(bad.length, 1)
})

test('layout failing validateLayout is also quarantined', async () => {
  withTempDataDir()
  const repo = 'C:/repo/invalid-shape'
  const dir = await dataDirFor(repo)
  writeFileSync(join(dir, 'layout.json'), JSON.stringify({ version: 1, nodes: { a: { x: 1 } }, groups: {}, orphans: {} }))
  const l = await readLayout(repo)
  assert.deepEqual(l, emptyLayout())
  const bad = readdirSync(dir).filter(f => f.startsWith('layout.bad-'))
  assert.equal(bad.length, 1)
})

test('writeLayout rejects an invalid layout and leaves existing file untouched', async () => {
  withTempDataDir()
  const repo = 'C:/repo/reject-invalid'
  const good = layoutWith(7)
  await writeLayout(repo, good)
  await assert.rejects(() => writeLayout(repo, { version: 1, nodes: { a: { x: 1 } }, groups: {}, orphans: {} }))
  const read = await readLayout(repo)
  assert.deepEqual(read, good)
})

test('50 concurrent writeLayout calls leave a valid file matching the last call, no leftover .tmp', async () => {
  withTempDataDir()
  const repo = 'C:/repo/concurrent'
  const N = 50
  const writes = []
  for (let i = 0; i < N; i++) writes.push(writeLayout(repo, layoutWith(i)))
  await Promise.all(writes)
  const read = await readLayout(repo)
  assert.deepEqual(read, layoutWith(N - 1))
  const dir = await dataDirFor(repo)
  assert.ok(!readdirSync(dir).some(f => f.endsWith('.tmp')))
})

test('MAP_DATA_DIR override changes the data root, read at call time', async () => {
  const dirA = mkdtempSync(join(tmpdir(), 't2-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 't2-b-'))
  process.env.MAP_DATA_DIR = dirA
  const repo = 'C:/repo/env-switch'
  const outA = await dataDirFor(repo)
  assert.ok(outA.startsWith(dirA))

  process.env.MAP_DATA_DIR = dirB
  const outB = await dataDirFor(repo)
  assert.notEqual(outA, outB)
})
