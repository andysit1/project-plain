# Graph tests

Unit tests for the canvas state-graph editor. They use Node's built-in test runner,
so there is nothing to install.

```
cd frontend/graph
npm test            # or: node --test tests/
```

Node 18 or newer is required. `package.json` marks this directory as an ES module
package so the same source files the browser loads can be imported directly.

## Layout

| File | Covers |
| --- | --- |
| `placement.test.js` | grid snapping and free-slot search in `utils/placement.js` |
| `node.test.js` | `Rect`, `State`, id generation, hit box, label fitting |
| `hashmap.test.js` | the order-independent pair keys in `components/utils/hashmap.js` |
| `transition.test.js` | link geometry, arrow clipping, self-loops, hover labels |
| `th.test.js` | `TransitionGroupManager` grouping and cleanup on delete |
| `graph.test.js` | camera, hit testing, selection, drag, pan, zoom, painting |
| `graph_handler.test.js` | the toolbar actions: add, delete, link, clear, save |

## The DOM stub

`helpers/dom-stub.js` installs the small slice of the browser these modules touch:
`window`, `document`, `requestAnimationFrame`, and a fake canvas whose 2D context
records the calls made against it. Import it before any module under test, because
`components/graph.js` reads `window.devicePixelRatio` while it is being evaluated.

`requestAnimationFrame` records its callback instead of running it, so constructing a
`Graph` does not start an endless render loop inside the test process.

The fake `measureText` returns six pixels per character, which is what makes the
label-truncation assertions in `node.test.js` deterministic.

## Writing new tests

Build a graph through `makeGraph()` in `graph.test.js` or `setup()` in
`graph_handler.test.js` rather than constructing one by hand. Both reset the stub
elements first, so tests do not leak selection state into each other.

Drive interaction through the handlers (`onMouseDown`, `onMouseMove`, `onMouseUp`,
`onWheel`) with `pointerEvent(x, y)`. Coordinates passed to those handlers are screen
pixels; coordinates on a node's `rect` are world pixels. They only coincide while the
camera is at its default position.

Comparing a coordinate against zero needs care: JavaScript's remainder operator
returns `-0` for negative inputs, and `assert.equal` treats that as different from `0`.
Use the `onGrid` helper or `Math.abs(v) < 1e-12` instead.

Node ids come from a module-level counter that is shared across every test in a file,
so assert that ids are distinct rather than that they hold particular values.
