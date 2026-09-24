# map

Watches a repo, extracts a function call graph with tree-sitter, and serves it to the
project-plain canvas over HTTP/SSE.

## Usage

```
node bin/map.js [root=.] [options]
```

or, once linked/installed as a package binary:

```
map [root=.] [options]
```

### Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `7070` | Port to listen on. `--port 0` picks a free port. |
| `--host` | `127.0.0.1` | Host to bind. |
| `--no-open` | off | Don't open the browser on startup. |
| `--editor` | `code -g {file}:{line}` | Command run by `POST /open`. `{file}` is replaced with the absolute path, `{line}` with the line number. |
| `--debounce` | `200` | Milliseconds to debounce file-change rebuilds. |
| `--ignore` | | Comma-separated list of extra glob patterns to ignore, in addition to `.git`, `node_modules`, `dist`, `build`, `__pycache__`, `.venv`, `venv`. |
| `--once` | off | Build once, print the `CodeGraph` JSON to stdout, and exit (no server started). |

While the server is running and stdin is a TTY, type `r` + Enter to force a rebuild.

## Routes

| Route | Method | Response |
| --- | --- | --- |
| `/` | GET | `frontend/graph/index.html` |
| `/graph/*` | GET | Static files from `frontend/graph/` |
| `/shared/*` | GET | Static files from `shared/` |
| `/events` | GET | SSE stream: `hello`, `graph`, `status` events; `: ping` every 15s |
| `/layout` | GET | The saved `Layout` for the watched repo, or an empty layout |
| `/layout` | POST | Replace the saved layout. `204` on success, `400` on invalid body |
| `/open?file=&line=` | POST | Runs the editor command against `file`/`line`. `204` on success, `400` if `file` is missing or resolves outside the repo root |

See `shared/api.md` for the full contract, including the SSE payload shapes.

## Data directory

Layouts are persisted under `<project-plain>/data/<basename(root)>-<hash>/layout.json`
(managed by `map/src/layout-store.js`). Set the `MAP_DATA_DIR` environment variable to
override the `data/` root, for example in tests.
