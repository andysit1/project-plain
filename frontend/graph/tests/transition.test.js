import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeCtx } from './helpers/dom-stub.js'
import { Rect, State } from '../components/node.js'
import { Transition, TransitionGroup } from '../components/transition.js'

const LINE_SEPARATION = 16

const node = (id, x, y) => new State(id, `n${id}`, new Rect(x, y, 150, 75))

function pair (ax, ay, bx, by) {
    const a = node(1, ax, ay)
    const b = node(2, bx, by)
    const grp = new TransitionGroup(a, b)
    return { a, b, grp }
}

test('normalizeDir turns a vector into a unit vector', () => {
    const grp = new TransitionGroup(node(1, 0, 0), node(2, 0, 0))
    const d = { x: 3, y: 4 }
    grp.normalizeDir(d)
    assert.equal(d.x, 0.6)
    assert.equal(d.y, 0.8)
})

test('normalizeDir on a zero vector yields a direction instead of NaN', () => {
    // Two nodes sitting on the same spot used to divide by zero here.
    const grp = new TransitionGroup(node(1, 0, 0), node(2, 0, 0))
    const d = { x: 0, y: 0 }
    grp.normalizeDir(d)
    assert.deepEqual(d, { x: 0, y: 1 })
})

test('rotateDir turns a vector a quarter turn', () => {
    const grp = new TransitionGroup(node(1, 0, 0), node(2, 0, 0))
    const d = { x: 1, y: 0 }
    grp.rotateDir(d, Math.PI / 2)
    assert.ok(Math.abs(d.x) < 1e-12)
    assert.equal(Math.round(d.y), 1)
})

test('offset of a lone transition is finite and perpendicular to the link', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 't', a, b, grp)
    grp.transitions.push(t)
    const o = grp.offset(t)
    for (const v of Object.values(o)) { assert.ok(Number.isFinite(v), 'offset produced a non-finite number') }
    // the link runs horizontally, so the separation direction must be vertical
    assert.ok(Math.abs(o.dirX) < 1e-12)
    assert.equal(Math.abs(o.dirY), 1)
    // a single transition sits on the centre line
    assert.ok(Math.abs(o.x) < 1e-12 && Math.abs(o.y) < 1e-12)
})

test('offsets for stacked nodes stay finite', () => {
    const { a, b, grp } = pair(100, 100, 100, 100)
    const t = new Transition(1, 't', a, b, grp)
    grp.transitions.push(t)
    const o = grp.offset(t)
    for (const [k, v] of Object.entries(o)) {
        assert.ok(Number.isFinite(v), `offset.${k} was ${v}`)
    }
})

test('three transitions in a group are spread evenly and symmetrically', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const ts = [1, 2, 3].map(i => new Transition(i, `t${i}`, a, b, grp))
    grp.transitions.push(...ts)
    const spread = ts.map(t => grp.offset(t).y)
    assert.ok(Math.abs(spread[1]) < 1e-12, 'the middle transition should sit on the centre line')
    assert.ok(Math.abs(spread[0] + spread[2]) < 1e-9, 'the outer transitions are not symmetric')
    assert.equal(Math.abs(spread[0] - spread[1]), LINE_SEPARATION)
})

test('offset of a transition that is not in the group does not throw', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const orphan = new Transition(9, 'orphan', a, b, grp)
    const o = grp.offset(orphan)   // indexOf returns -1
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y))
})

test('a self-loop draws nothing rather than crashing', () => {
    const a = node(1, 0, 0)
    const grp = new TransitionGroup(a, a)
    const t = new Transition(1, 'loop', a, a, grp)
    grp.transitions.push(t)
    const ctx = fakeCtx()
    t.draw(ctx)
    assert.equal(ctx.calls.length, 0, 'a self-loop tried to draw')
})

test('a self-loop is never hit by the pointer', () => {
    const a = node(1, 0, 0)
    const grp = new TransitionGroup(a, a)
    const t = new Transition(1, 'loop', a, a, grp)
    grp.transitions.push(t)
    assert.equal(t.isInBounds(75, 37), false)
})

test('a normal transition draws a line and an arrow head', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 't', a, b, grp)
    grp.transitions.push(t)
    const ctx = fakeCtx()
    t.draw(ctx)
    const names = ctx.calls.map(c => c[0])
    assert.ok(names.includes('stroke'), 'no line was stroked')
    assert.ok(names.includes('fill'), 'no arrow head was filled')
})

test('a point on the link is a hit and a distant point is not', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 't', a, b, grp)
    grp.transitions.push(t)
    // both node centres are at y = 37.5, so the link is the segment between them
    assert.ok(t.isInBounds(300, 37.5), 'a point on the link missed')
    assert.ok(!t.isInBounds(300, 300), 'a far away point was treated as a hit')
})

test('the hover label is only drawn when highlighted and positioned', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 'label', a, b, grp)
    grp.transitions.push(t)

    const cold = fakeCtx()
    t.drawHover(cold)
    assert.equal(cold.calls.length, 0, 'label drawn while not hovered')

    const noPos = fakeCtx()
    t.highlight = true
    t.drawHover(noPos)
    assert.equal(noPos.calls.length, 0, 'label drawn before a mouse position was recorded')

    const hot = fakeCtx()
    t.mousePos = { x: 50, y: 60 }
    t.drawHover(hot)
    const text = hot.calls.find(c => c[0] === 'fillText')
    assert.deepEqual(text.slice(1), ['label', 50, 50])
})

test('an unnamed transition draws no hover label', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, '', a, b, grp)
    grp.transitions.push(t)
    t.highlight = true
    t.mousePos = { x: 0, y: 0 }
    const ctx = fakeCtx()
    t.drawHover(ctx)
    assert.equal(ctx.calls.length, 0)
})

test('the arrow head sits back from the target point along the link', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 't', a, b, grp)
    const base = t.arrowBase({ x: 0, y: 0 }, { x: 100, y: 0 })
    assert.equal(base.x, 100 - base.size * 2)
    assert.equal(base.y, 0)
})

test('arrowBase does not divide by zero when both ends coincide', () => {
    const { a, b, grp } = pair(0, 0, 0, 0)
    const t = new Transition(1, 't', a, b, grp)
    const base = t.arrowBase({ x: 5, y: 5 }, { x: 5, y: 5 })
    assert.ok(Number.isFinite(base.x) && Number.isFinite(base.y))
})

test('clipArrow pulls the endpoint back to the edge of the target box', () => {
    const { a, b, grp } = pair(0, 0, 400, 0)
    const t = new Transition(1, 't', a, b, grp)
    const from = { x: a.rect.cx(), y: a.rect.cy() }
    const to = { x: b.rect.cx(), y: b.rect.cy() }
    t.clipArrow(b.rect, from, to)
    assert.equal(to.x, b.rect.x, 'endpoint was not clipped to the left edge of the target')
    assert.ok(to.y >= b.rect.y && to.y <= b.rect.y + b.rect.h)
})
