# Canvas DOM + test-hook contract (frozen by T0)

T10 (`frontend/graph/index.html`, `index.js`) must provide these; T11's Playwright specs rely only on them.

## Element ids

| id | What |
| --- | --- |
| `canvas#canvas` | The graph canvas, fills the window below the status bar |
| `#status-conn` | Text: `connecting`, `open` or `closed`. Also `data-state` with the same value |
| `#status-counts` | Text like `15 functions · 16 calls` (in files mode: `400 files · 6000 functions`) |
| `#status-rebuild` | Last rebuild: time and `ms`, e.g. `rebuilt 12:03:04 (42 ms)` |
| `#files-mode-notice` | Visible (not `hidden`) only when `scene.mode === 'files'`; explains the ceiling |
| `#inspector` | Side panel. `hidden` attribute when nothing is selected |
| `#inspector-name`, `#inspector-sig`, `#inspector-loc` | Name, `name(params) -> returns`, `file:line` |
| `#inspector-callers li`, `#inspector-callees li` | One `li` per caller/callee, text = the other node's qname, `data-id` = its id |
| `#open-in-editor` | Button: `POST /open?file=&line=` |

## Test hook: `window.__plain`

Set by `index.js` on startup and updated after every render:

```js
window.__plain = {
  scene,            // the latest Scene (after applyCeiling), or null before the first graph
  graph,            // the latest CodeGraph
  renders,          // integer, +1 after each scene is drawn
  positions(),      // Record<nodeId, {x, y}> of scene.nodes (world coords, top-left)
  select(id),       // selects a node as a click would (fills the inspector)
  connection,       // 'connecting' | 'open' | 'closed'
}
```

Specs wait with `page.waitForFunction(() => window.__plain?.renders >= n)`.
