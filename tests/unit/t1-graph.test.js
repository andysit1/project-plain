import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateGraph } from '../../shared/contracts.js'
import { buildGraph, clearCache } from '../../map/src/graph.js'

// ---- a small temp repo: Python + TS, ~10 functions ----
// app/main.py: main -> run, run -> connect/query/close/slugify
// app/config.py: load_config -> parse_env, load_config -> Config.validate (method)
// app/utils.py: slugify, retry (nested fn calls retry.inner -> exercises nested fn)
// app/db.py: connect, query, close (cross-file import of retry)
// web/api.ts: fetchUser -> client.request (cross-file TS import)
// web/client.ts: request -> buildUrl

function writeRepo(dir) {
  mkdirSync(join(dir, 'app'), { recursive: true })
  mkdirSync(join(dir, 'web'), { recursive: true })

  writeFileSync(join(dir, 'app', 'main.py'), [
    'from app.config import load_config',
    'from app.db import connect, query, close',
    'from app.utils import slugify',
    '',
    'def main():',
    '    cfg = load_config()',
    '    run(cfg)',
    '',
    'def run(cfg):',
    '    conn = connect(cfg)',
    '    query(conn, "select 1")',
    '    close(conn)',
    '    slugify("Demo")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'app', 'config.py'), [
    'from app.utils import read_file',
    '',
    'def load_config(path=".env"):',
    '    text = read_file(path)',
    '    env = parse_env(text)',
    '    cfg = Config(env)',
    '    return cfg.validate()',
    '',
    'def parse_env(text):',
    '    return {}',
    '',
    'class Config:',
    '    def __init__(self, values):',
    '        self.values = values',
    '',
    '    def validate(self):',
    '        self.check()',
    '        return self',
    '',
    '    def check(self):',
    '        return True',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'app', 'utils.py'), [
    'def read_file(path):',
    '    return "x"',
    '',
    'def slugify(text):',
    '    return text.lower()',
    '',
    'def retry(fn, times=3):',
    '    def attempt():',
    '        return fn()',
    '    return attempt()',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'app', 'db.py'), [
    'from app.utils import retry',
    '',
    'def connect(url):',
    '    return retry(url)',
    '',
    'def query(conn, sql):',
    '    return []',
    '',
    'def close(conn):',
    '    return None',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'web', 'api.ts'), [
    "import { request } from './client'",
    '',
    'export async function fetchUser(id: string): Promise<string> {',
    '  return request(id)',
    '}',
    '',
  ].join('\n'))

  writeFileSync(join(dir, 'web', 'client.ts'), [
    'export async function request(path: string): Promise<string> {',
    '  return buildUrl(path)',
    '}',
    '',
    'export function buildUrl(path: string): string {',
    '  return path',
    '}',
    '',
  ].join('\n'))
}

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 't1-repo-'))
  writeRepo(dir)
  return dir
}

function findNode(graph, id) {
  return graph.nodes.find(n => n.id === id)
}

test('buildGraph on a small Python+TS repo passes validateGraph with expected nodes and edges', async () => {
  clearCache()
  const dir = mkRepo()
  const graph = await buildGraph(dir)
  validateGraph(graph)

  assert.equal(graph.version, 1)
  assert.ok(graph.nodes.length >= 10, `expected >= 10 nodes, got ${graph.nodes.length}`)

  const ids = graph.nodes.map(n => n.id)
  assert.ok(ids.includes('app/main.py::main'))
  assert.ok(ids.includes('app/main.py::run'))
  assert.ok(ids.includes('app/config.py::load_config'))
  assert.ok(ids.includes('app/config.py::parse_env'))
  // a method
  const method = findNode(graph, 'app/config.py::Config.validate')
  assert.ok(method, 'expected Config.validate method node')
  assert.equal(method.kind, 'method')
  assert.equal(method.qname, 'Config.validate')
  // a nested function
  const nested = findNode(graph, 'app/utils.py::retry.attempt')
  assert.ok(nested, 'expected nested function retry.attempt')
  assert.equal(nested.kind, 'fn')
  // module-level pseudo node (main.py has a top-level call under __main__)
  const modNode = findNode(graph, 'app/main.py::<module>')
  assert.ok(modNode, 'expected module pseudo-node for main.py')
  assert.equal(modNode.kind, 'module')
  assert.equal(modNode.name, 'main.py')
  assert.equal(modNode.line, 1)

  const edgeIds = graph.edges.map(e => e.id)
  // same-file call
  assert.ok(edgeIds.includes('app/main.py::main>app/main.py::run'))
  // method call resolved via self.
  assert.ok(edgeIds.includes('app/config.py::load_config>app/config.py::Config.validate'))
  assert.ok(edgeIds.includes('app/config.py::Config.validate>app/config.py::Config.check'))
  // cross-file python import
  assert.ok(edgeIds.includes('app/main.py::main>app/config.py::load_config'))
  assert.ok(edgeIds.includes('app/db.py::connect>app/utils.py::retry'))
  // cross-file TS import
  assert.ok(edgeIds.includes('web/api.ts::fetchUser>web/client.ts::request'))
  assert.ok(edgeIds.includes('web/client.ts::request>web/client.ts::buildUrl'))
  // module pseudo node calling main
  assert.ok(edgeIds.includes('app/main.py::<module>>app/main.py::main'))

  // no duplicate node/edge ids
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(edgeIds).size, edgeIds.length)
})

test('editing only a body changes body but not sig; editing only params changes sig', async () => {
  clearCache()
  const dir = mkRepo()
  const g1 = await buildGraph(dir)
  const before = findNode(g1, 'app/utils.py::slugify')

  // body-only edit: change what slugify returns, keep the signature line identical
  writeFileSync(join(dir, 'app', 'utils.py'), [
    'def read_file(path):',
    '    return "x"',
    '',
    'def slugify(text):',
    '    return text.upper()  # changed body',
    '',
    'def retry(fn, times=3):',
    '    def attempt():',
    '        return fn()',
    '    return attempt()',
    '',
  ].join('\n'))
  const g2 = await buildGraph(dir)
  const afterBody = findNode(g2, 'app/utils.py::slugify')
  assert.notEqual(afterBody.body, before.body, 'body hash should change')
  assert.equal(afterBody.sig, before.sig, 'sig hash should not change on a body-only edit')

  // params-only edit: change the signature, keep the same body text
  writeFileSync(join(dir, 'app', 'utils.py'), [
    'def read_file(path):',
    '    return "x"',
    '',
    'def slugify(text, extra=1):',
    '    return text.upper()  # changed body',
    '',
    'def retry(fn, times=3):',
    '    def attempt():',
    '        return fn()',
    '    return attempt()',
    '',
  ].join('\n'))
  const g3 = await buildGraph(dir)
  const afterParams = findNode(g3, 'app/utils.py::slugify')
  assert.notEqual(afterParams.sig, afterBody.sig, 'sig hash should change on a params edit')
  assert.equal(afterParams.body, afterBody.body, 'body hash should not change on a params-only edit')
})

test('renaming a function keeps its body hash', async () => {
  clearCache()
  const dir = mkRepo()
  const g1 = await buildGraph(dir)
  const before = findNode(g1, 'app/utils.py::slugify')

  writeFileSync(join(dir, 'app', 'utils.py'), [
    'def read_file(path):',
    '    return "x"',
    '',
    'def slugify_v2(text):',
    '    return text.lower()',
    '',
    'def retry(fn, times=3):',
    '    def attempt():',
    '        return fn()',
    '    return attempt()',
    '',
  ].join('\n'))
  const g2 = await buildGraph(dir)
  const renamed = findNode(g2, 'app/utils.py::slugify_v2')
  assert.ok(renamed)
  assert.equal(renamed.body, before.body, 'renaming keeps the body hash (body text excludes the name)')
})

test('stats.changed is 0 on an unedited rebuild and 1 after touching one file', async () => {
  clearCache()
  const dir = mkRepo()
  const stats1 = {}
  await buildGraph(dir, { stats: stats1 })
  assert.ok(stats1.changed > 0, 'first build should report changed files')

  const stats2 = {}
  await buildGraph(dir, { stats: stats2 })
  assert.equal(stats2.changed, 0, 'second build with no edits should report 0 changed files')

  // touch one file: change its content (and thus size) so the cache reliably invalidates
  // regardless of filesystem mtime resolution
  writeFileSync(join(dir, 'app', 'utils.py'), [
    'def read_file(path):',
    '    return "x"',
    '',
    'def slugify(text):',
    '    return text.lower()  # touched',
    '',
    'def retry(fn, times=3):',
    '    def attempt():',
    '        return fn()',
    '    return attempt()',
    '',
  ].join('\n'))
  // ensure a fresh mtime too, belt and braces
  const now = new Date()
  utimesSync(join(dir, 'app', 'utils.py'), now, now)

  const stats3 = {}
  await buildGraph(dir, { stats: stats3 })
  assert.equal(stats3.changed, 1, 'touching one file should report 1 changed file')
})

test('a syntax error in one file adds to errors but other files still produce nodes', async () => {
  clearCache()
  const dir = mkRepo()
  writeFileSync(join(dir, 'app', 'broken.py'), 'def broken(:\n    pass\n')
  const graph = await buildGraph(dir)
  validateGraph(graph)
  assert.ok(graph.errors.length > 0, 'expected at least one error for the broken file')
  assert.ok(graph.errors.some(e => e.includes('broken.py')))
  // other files still produced nodes
  const ids = graph.nodes.map(n => n.id)
  assert.ok(ids.includes('app/main.py::main'))
  assert.ok(ids.includes('web/client.ts::buildUrl'))
})
