#!/usr/bin/env node
// map CLI: watches a repo, extracts a call graph and serves it to the canvas.
// See shared/api.md for the full contract.
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { startServer } from '../src/server.js'

function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '7070' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-open': { type: 'boolean', default: false },
      editor: { type: 'string', default: 'code -g {file}:{line}' },
      debounce: { type: 'string', default: '200' },
      ignore: { type: 'string' },
      once: { type: 'boolean', default: false },
    },
  })
  return {
    root: positionals[0] || '.',
    port: Number(values.port),
    host: values.host,
    open: !values['no-open'],
    editor: values.editor,
    debounce: Number(values.debounce),
    ignore: values.ignore ? values.ignore.split(',').filter(Boolean) : [],
    once: values.once,
  }
}

function openBrowser(url) {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref()
    } else if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
  } catch (err) {
    console.error('map: failed to open browser:', err)
  }
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2))
  const root = path.resolve(opts.root)

  if (opts.once) {
    const { buildGraph } = await import('../src/graph.js')
    const graph = await buildGraph(root, { ignore: opts.ignore })
    process.stdout.write(JSON.stringify(graph))
    return
  }

  const { url, close, rebuild } = await startServer(root, {
    port: opts.port,
    host: opts.host,
    editor: opts.editor,
    debounce: opts.debounce,
    ignore: opts.ignore,
    watch: true,
  })

  console.log(`map: serving ${root} at ${url}`)

  if (opts.open) openBrowser(url)

  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8')
    let buf = ''
    process.stdin.on('data', (chunk) => {
      buf += chunk
      if (buf.includes('\n')) {
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (line.trim() === 'r') rebuild('change')
        }
      }
    })
    process.stdin.resume()
  }

  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    await close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('map: fatal error:', err && err.stack ? err.stack : err)
  process.exit(1)
})
