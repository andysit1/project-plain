# L1U-to-coordinator-001: disambiguate buildDataScene focusId for module pseudo-classes

- From: L1U (L1 classes frontend + layer switcher)
- To: coordinator (frozen data_view interface, shared/contracts.js), cc L3 frontend
- Status: resolved by coordinator (Sep 24, 2026)

## What I need

`buildDataScene(codeGraph, focusId)` gets one id for both views: a CodeNode id (frame view) or a
CodeClass id (schema view). For module pseudo-classes these collide:
`moduleClassId(file) === nodeId(file, '<module>')`, which is also the id of that file's `<module>`
CodeNode. So Alt+double-clicking the `structures.py` module box in L1 and double-clicking the
`<module>` function box in L2 call `buildDataScene` with the same string.

Proposal (additive): freeze an optional third argument
`buildDataScene(codeGraph, focusId, { kind: 'class' | 'function' })`. Without it, keep today's
rule (whatever data_view.js does now).

## Why

Without it the L3 view for a module box is whichever one data_view.js picks for the collision.

## What I did meanwhile

`frontend/graph/index.js` already passes `{ kind }` as the third argument (ignored by a
two-argument implementation), so nothing breaks either way.
