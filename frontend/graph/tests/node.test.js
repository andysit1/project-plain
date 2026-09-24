import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeCtx } from './helpers/dom-stub.js'
import { Rect, State, nextNodeId, reserveNodeId } from '../components/node.js'

test('Rect reports its own centre', () => {
    const r = new Rect(100, 200, 150, 75)
    assert.equal(r.cx(), 175)
    assert.equal(r.cy(), 237.5)
})

test('node ids are strictly increasing', () => {
    const a = nextNodeId(), b = nextNodeId(), c = nextNodeId()
    assert.ok(b > a && c > b, `expected ascending ids, got ${a}, ${b}, ${c}`)
})

test('ids stay unique after a node is deleted', () => {
    // The old code derived ids from states.length, so deleting a node reissued an id.
    const states = [new State(nextNodeId(), 'a', new Rect(0, 0, 10, 10)),
                    new State(nextNodeId(), 'b', new Rect(0, 0, 10, 10))]
    states.pop()                                  // delete the second node
    const revived = new State(nextNodeId(), 'c', new Rect(0, 0, 10, 10))
    assert.ok(!states.some(s => s.id === revived.id), 'a deleted id was handed out again')
})

test('reserveNodeId keeps later generated ids above a restored id', () => {
    reserveNodeId(9999)
    assert.ok(nextNodeId() > 9999)
})

test('reserveNodeId ignores values that are not numbers or are already used', () => {
    const before = nextNodeId()
    reserveNodeId('not-a-number')
    reserveNodeId(0)
    assert.ok(nextNodeId() > before, 'the counter went backwards')
})

test('updateName replaces the label', () => {
    const s = new State(1, 'old', new Rect(0, 0, 10, 10))
    s.updateName('new')
    assert.equal(s.name, 'new')
})

test('the hit box is exactly the drawn box', () => {
    const s = new State(1, 'n', new Rect(100, 100, 150, 75))
    assert.ok(s.isInBounds(100, 100), 'top-left corner should hit')
    assert.ok(s.isInBounds(249, 174), 'inside the far edge should hit')
    assert.ok(!s.isInBounds(250, 174), 'right edge is exclusive')
    assert.ok(!s.isInBounds(249, 175), 'bottom edge is exclusive')
    assert.ok(!s.isInBounds(99, 100), 'a pixel left of the box should miss')
})

test('the hit box has no invisible margin that steals a neighbour click', () => {
    // The previous version padded bounds by 8px, so adjacent nodes fought over clicks.
    const s = new State(1, 'n', new Rect(100, 100, 150, 75))
    for (let d = 1; d <= 8; d++) {
        assert.ok(!s.isInBounds(100 - d, 137), `point ${d}px left of the node still hit it`)
        assert.ok(!s.isInBounds(249 + d, 137), `point ${d}px right of the node still hit it`)
    }
})

test('fitText leaves a short label untouched', () => {
    const ctx = fakeCtx()            // 6px per character
    const s = new State(1, 'n', new Rect(0, 0, 150, 75))
    assert.equal(s.fitText(ctx, 'short', 150), 'short')
})

test('fitText truncates a long label with an ellipsis that fits the width', () => {
    const ctx = fakeCtx()
    const s = new State(1, 'n', new Rect(0, 0, 150, 75))
    const long = 'def some_really_long_function_name(alpha, beta, gamma)'
    const out = s.fitText(ctx, long, 60)
    assert.ok(out.endsWith('…'), `expected an ellipsis, got ${out}`)
    assert.ok(out.length < long.length, 'text was not shortened')
    assert.ok(ctx.measureText(out).width <= 60, 'shortened text still overflows')
    // and it is the longest such prefix: one more character would overflow
    const oneMore = long.slice(0, out.length) + '…'
    assert.ok(ctx.measureText(oneMore).width > 60, 'truncated more than necessary')
})

test('fitText copes with a zero width budget', () => {
    const ctx = fakeCtx()
    const s = new State(1, 'n', new Rect(0, 0, 0, 0))
    assert.equal(s.fitText(ctx, 'anything', 0), '…')
})

test('draw paints the node and its label without touching the DOM', () => {
    const ctx = fakeCtx()
    const s = new State(7, 'Node', new Rect(0, 0, 150, 75))
    s.draw(ctx)
    const names = ctx.calls.map(c => c[0])
    assert.ok(names.includes('fill'))
    assert.ok(names.includes('stroke'))
    const label = ctx.calls.find(c => c[0] === 'fillText')
    assert.deepEqual(label.slice(1), ['Node', 75, 37.5], 'label was not centred in the node')
})

test('drawActive paints nothing unless the node is the active state', () => {
    const s = new State(1, 'n', new Rect(0, 0, 150, 75))
    const idle = fakeCtx()
    s.drawActive(idle)
    assert.equal(idle.calls.length, 0)

    const active = fakeCtx()
    s.activeState = true
    s.drawActive(active)
    assert.ok(active.calls.some(c => c[0] === 'stroke'))
})

test('the highlight ring is drawn outside the node box', () => {
    const ctx = fakeCtx()
    const s = new State(1, 'n', new Rect(100, 100, 150, 75))
    s.fillNodePath(ctx, 8)
    const xs = ctx.calls.flatMap(c => (c[0] === 'moveTo' || c[0] === 'lineTo') ? [c[1]] : [])
    assert.equal(Math.min(...xs), 92, 'ring did not expand left by the buffer')
    assert.equal(Math.max(...xs), 258, 'ring did not expand right by the buffer')
})
