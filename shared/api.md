# map HTTP / SSE contract (frozen by T0)

The server (T3, `map/src/server.js`) and the canvas client (T4, `frontend/graph/components/live.js`) meet here.
Types refer to `shared/contracts.js`. Everything is same-origin; no CORS.

## Routes

| Route | Method | Request | Response |
| --- | --- | --- | --- |
| `/` | GET | | `frontend/graph/index.html`, `text/html` |
| `/graph/*` | GET | | Static file from `frontend/graph/*`. 404 if missing, 403 on path traversal |
| `/shared/*` | GET | | Static file from `shared/*`. Same rules |
| `/events` | GET | | `text/event-stream`, see below |
| `/layout` | GET | | `200` JSON `Layout` for the watched repo, or `emptyLayout()` |
| `/layout` | POST | JSON full `Layout` (not a patch) | `204` on success. `400` JSON `{ error }` if `validateLayout` throws or the body is not JSON |
| `/open?file=<repo-relative>&line=<n>` | POST | | Runs the editor command, `204`. `400` if `file` is missing or resolves outside the repo root |

Content types: `.html` text/html, `.js`/`.mjs` text/javascript, `.css` text/css, `.json` application/json, `.svg` image/svg+xml, `.png` image/png, other application/octet-stream. All responses send `Cache-Control: no-store`.

## SSE `/events`

Standard `text/event-stream` framing, one JSON object per `data:` line:

```
event: hello
data: {"root":"C:/code/myrepo"}

event: graph
data: { ...CodeGraph }

event: status
data: {"reason":"change","at":1758700000000,"ms":42,"changed":1}
```

- On connect the server sends `hello`, then the latest `graph` (if one has been built), then the latest `status`.
- After every rebuild it broadcasts `graph` then `status` to every client.
- A comment line `: ping` is sent every 15 s to keep proxies open.
- The client reconnects on error with backoff (1 s, 2 s, 4 s … max 10 s) and treats the next `graph` as a full replacement.

## CLI (`map/bin/map.js`)

```
map [root=.] [--port 7070] [--host 127.0.0.1] [--no-open] [--editor "code -g {file}:{line}"]
             [--debounce 200] [--ignore <glob>[,<glob>...]] [--once]
```

- Watches `root` recursively (`fs.watch`, recursive) for `.py .ts .tsx .js .jsx .mjs .cjs`, ignoring `.git`, `node_modules`, `dist`, `build`, `__pycache__`, `.venv`, `venv` and the `--ignore` globs.
- Rebuild triggers: startup (`reason: 'start'`), a debounced file change (`'change'`), typing `r` + Enter on stdin (`'change'`, forces a rebuild). A failed build sends `status` with `reason: 'error'` and keeps the last good graph.
- `--once`: build once, print the `CodeGraph` JSON to stdout, exit (no server). Used by tests.
- `--port 0` picks a free port. The server prints `map: serving <root> at http://<host>:<port>` on stdout once listening.
- `{file}` in `--editor` is the absolute path, `{line}` the line number.

## Layout storage

`<project-plain>/data/<basename(root)>-<sha1(absolute root, forward slashes, lowercased drive letter)[0:8]>/layout.json`
(owned by T2, `map/src/layout-store.js`). `data/` is git-ignored.
