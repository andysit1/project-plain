# L3I-to-coordinator-001: wire L3 inference in, plus one fixture correction

- From: L3I (L3 data-layer inference engine)
- To: coordinator
- Status: resolved by coordinator (Sep 24, 2026)

## What I need

1. **Fixture fix (shared/fixtures/graph.classes.json):** in `frames["app/structures.py::Registry.add"]`,
   the var `name` should have `src: "return"`, not `"mutation"`. Nothing mutates `name`. Its `str` comes
   from the call site `self.add("sq", sq)` in `Registry.build`, which is call-site evidence and ranks as
   `'return'`, the same as the `shape` param next to it (the fixture already labels that one `'return'`).
   `tests/unit/l3-infer-layers.test.js` currently patches this one field before comparing and says why.
   Once the fixture is fixed, that line can go.

2. **Wiring (map/src/extract.js, map/src/graph.js).** No contract change is needed.
   - extract.js `extractFile`: for Python, call `extractPythonData(tree.rootNode)` from
     `map/src/extract-data.js` **before** `parser.delete()` and return it as, say, `data`
     (`null` for other languages).
   - graph.js: collect `dataByFile[file] = data` for every Python file (cache it with the rest of the per-file
     parse output). Then call
     `inferLayers({ nodes, edges, classes, dataByFile, resolveClass })` from `map/src/infer.js`, where
     `resolveClass(file, nameText) -> classId|null` reuses the import resolution you already do for class
     edges. `nameText` can be `"Point"`, `"models.Point"` or a quoted forward ref (quotes already stripped
     by infer). Nodes must carry `cls` and `returns`, and classes must carry `bases`.
   - Apply the result: `graph.frames = frames`. For each class: `field.shape/src = fieldShapes[cls.id][field.name]`
     (when present) and `cls.structure = structures[cls.id]`. `fieldShapes` can also contain fields the L1
     extractor does not list (e.g. `self.x` set only outside `__init__`). Whether to add those is up to you.

## Why

L3 frames, field shapes and structures are produced but not yet emitted in the CodeGraph.

## What I did meanwhile

Both modules are pure and tested on their own (`node --test tests/unit/l3-infer-*.test.js`), using the
tree-sitter loader helper in `tests/unit/helpers/l3-parse.js`.
