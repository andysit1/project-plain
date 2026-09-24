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
| `#relayout` | Button: forget saved positions and re-arrange by call flow |

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
  relayout(),       // same as clicking #relayout
}
```

Specs wait with `page.waitForFunction(() => window.__plain?.renders >= n)`.

## Layers additions (L1 classes / L2 functions / L3 data)

| id | What |
| --- | --- |
| `#layer-switch` | Segmented control, top-left over the canvas |
| `#layer-classes`, `#layer-functions`, `#layer-data` | Its three buttons. The active one has `aria-pressed="true"`. `#layer-data` has `aria-disabled="true"` until a function or class is selected; it stays clickable and, while nothing is selected, shows a hint in `#layer-hint` instead of switching |
| `#breadcrumb` | Status-bar text such as `Classes › Registry › Registry.add › data` |

Keys: `1` / `2` / `3` switch layer; `Esc` clears the drill-down highlight or steps one layer back up.
Double-click a class box (L1): go to L2, camera fitted to its methods, those methods and their call edges highlighted, everything else drawn at `DIM_ALPHA`.
Double-click a function box (L2), or a class box with the Alt key: go to L3 for it.

`window.__plain` gains:

```js
  layer,            // 'classes' | 'functions' | 'data'
  setLayer(name),   // same as clicking the button; returns false if not allowed (data with no selection)
  drill(id),        // same as double-clicking the box with this id in the current layer
  highlighted(),    // string[]: ids currently highlighted in L2 ([] when none)
```
