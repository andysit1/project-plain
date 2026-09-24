# Coordinator changelog

Changes to frozen files (`shared/**`, `tasks/owners.json`). Running agents: re-read this before each commit.

## 2026-09-24: T0 baseline

- `shared/contracts.js`, `shared/api.md` and the fixtures are frozen.
- map is built from scratch (map.zip was not available). The coordinator created `map/package.json` with
  `web-tree-sitter@0.22.6` and `tree-sitter-wasms@0.1.12` already installed, so T1 needs no dependency changes.
  `map/package*.json` is still owned by T3.
- Additions beyond the plan's contract sketch: `LayoutPatch` (null deletes a key), `applyLayoutPatch`,
  `combinePatches`, `isEmptyPatch`, `validateLayoutPatch`, `nodeId`, `edgeId`, `dirOf`,
  `SAVE_DEBOUNCE_MS`, `RING_MS`, `NODE_KINDS`, `SSE_EVENTS`. Hash formulas for `sig`/`body` are defined in contracts.js.
- Claim locks live in the MAIN worktree's `tasks/claims/`, so agents in separate git worktrees share them.
- `node tasks/guard.mjs --range main...HEAD` checks a whole branch (used at merge review).
- Old tests under `frontend/graph/tests/` are unowned (T12). They are not run by `npm test`; expect them to break.

## 2026-09-24: seams added before wave 1

- `shared/dom.md`: element ids and the `window.__plain` test hook (T10 provides, T11 consumes).
- `shared/api.md`: `MAP_DATA_DIR` env override (T2), `buildGraph` opts/stats (T1 -> T3), layout-store exports (T2 -> T3).
- `owners.json`: each T1–T10 also owns `tests/unit/snapshots/tN-*` and `tests/unit/helpers/tN-*`.

## 2026-09-24: T12 flow layout + edge routing

- T12 granted write access to T5, T8 and T10 files (all merged and released).
- First-run layout is now by call flow (`frontend/graph/utils/flow.js`): entry points left, callees right,
  one band per call tree, crossing-minimised column order. New nodes land one column right of their caller.
- Edges are routed orthogonally around nodes, right side out, left side in, never overlapping
  (`components/utils/router.js`); `buildEdges(codeEdges, boxOf, { obstacles })` enables it.
- `merge` skips placement above `NODE_CEILING` (files mode never saves positions): large repos went 9.8 s to 1.1 s.
- `shared/dom.md`: `#relayout` button and `window.__plain.relayout()`.
