// Scripted edits applied to a temp copy of tests/demo-repo, one function per edit.
// Each function takes the repo dir (a temp copy made by copyDemoRepo()) and mutates files on disk.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Add a new function `chunk` to app/utils.py and call it from `read_file`. */
export function addFunction(dir) {
  const p = join(dir, 'app', 'utils.py')
  let src = readFileSync(p, 'utf8')
  src = src.replace(
    'def read_file(path):\n    """Read a text file and return its contents."""\n    with open(path, "r", encoding="utf-8") as fh:\n        return fh.read()\n',
    'def read_file(path):\n    """Read a text file and return its contents."""\n    with open(path, "r", encoding="utf-8") as fh:\n        return chunk(fh.read())\n\n\ndef chunk(text, size=1024):\n    """Split `text` into a list of `size`-character pieces."""\n    return [text[i:i + size] for i in range(0, len(text), size)]\n'
  )
  writeFileSync(p, src)
}

/** Change parse_env's parameter list (adds a `strict=False` keyword arg). */
export function editHeader(dir) {
  const p = join(dir, 'app', 'config.py')
  let src = readFileSync(p, 'utf8')
  src = src.replace('def parse_env(text):', 'def parse_env(text, strict=False):')
  writeFileSync(p, src)
}

/** Remove `close` from app/db.py and the call to it in app/main.py::run. */
export function deleteFunction(dir) {
  const dbPath = join(dir, 'app', 'db.py')
  let db = readFileSync(dbPath, 'utf8')
  db = db.replace(
    '\n\ndef close(conn):\n    """Close `conn`."""\n    conn["open"] = False\n',
    '\n'
  )
  writeFileSync(dbPath, db)

  const mainPath = join(dir, 'app', 'main.py')
  let main = readFileSync(mainPath, 'utf8')
  main = main.replace('from app.db import connect, query, close', 'from app.db import connect, query')
  main = main.replace('    close(conn)\n', '')
  writeFileSync(mainPath, main)
}

/** Rename slugify -> make_slug everywhere it's defined and called, keeping the body. */
export function renameFunction(dir) {
  const utilsPath = join(dir, 'app', 'utils.py')
  let utils = readFileSync(utilsPath, 'utf8')
  utils = utils.replace('def slugify(text):', 'def make_slug(text):')
  writeFileSync(utilsPath, utils)

  const mainPath = join(dir, 'app', 'main.py')
  let main = readFileSync(mainPath, 'utf8')
  main = main.replace('from app.utils import slugify', 'from app.utils import make_slug')
  main = main.replace('slugify(', 'make_slug(')
  writeFileSync(mainPath, main)
}

/** Generate a large repo (~6000 functions across 400 Python files) at `dir`, used to exercise files mode. */
export function makeLargeRepo(dir) {
  const write = writeFileSync
  const FILES = 400
  const FUNCS_PER_FILE = 15 // 400 * 15 = 6000
  mkdirSync(join(dir, 'big'), { recursive: true })
  write(join(dir, 'big', '__init__.py'), '')
  for (let f = 0; f < FILES; f++) {
    const lines = [`"""Generated module ${f}."""`, '']
    for (let i = 0; i < FUNCS_PER_FILE; i++) {
      const name = `fn_${f}_${i}`
      const callsNext = i + 1 < FUNCS_PER_FILE ? `    return fn_${f}_${i + 1}()` : '    return 0'
      lines.push(`def ${name}():`)
      lines.push(`    """Generated function ${name}."""`)
      lines.push(callsNext)
      lines.push('')
    }
    write(join(dir, 'big', `mod_${String(f).padStart(4, '0')}.py`), lines.join('\n') + '\n')
  }
}
