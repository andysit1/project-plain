import test from 'node:test'
import assert from 'node:assert/strict'
import { GRID, NODE_GAP, snap, findFreeSpot } from '../utils/placement.js'

const W = 150, H = 75

const rect = (x, y, w = W, h = H) => ({ rect: { x, y, w, h } })

const onGrid = (v) => Math.abs(v % GRID) === 0

// Two rects overlap if they share area once each is grown by NODE_GAP.
function clashes (a, b, gap = NODE_GAP) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
           a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

test('snap rounds to the nearest grid multiple', () => {
    assert.equal(snap(0), 0)
    assert.equal(snap(GRID / 2 - 1), 0)
    assert.equal(snap(GRID / 2 + 1), GRID)
    assert.equal(snap(GRID * 3), GRID * 3)
    assert.equal(snap(-GRID * 2 - 1), -GRID * 2)
})

test('snap output is always an exact multiple of GRID', () => {
    for (let v = -500; v <= 500; v += 7) {
        assert.ok(onGrid(snap(v)), `snap(${v}) left the grid`)
    }
})

test('an empty graph places the node centred on the target point', () => {
    const spot = findFreeSpot([], W, H, { x: 400, y: 300 })
    assert.deepEqual(spot, { x: snap(400 - W / 2), y: snap(300 - H / 2) })
})

test('returned coordinates are always on the grid', () => {
    const states = [rect(0, 0), rect(200, 0)]
    const spot = findFreeSpot(states, W, H, { x: 137, y: 91 })
    assert.ok(onGrid(spot.x))
    assert.ok(onGrid(spot.y))
})

test('the centred slot is skipped when it is occupied', () => {
    const taken = [rect(snap(400 - W / 2), snap(300 - H / 2))]
    const spot = findFreeSpot(taken, W, H, { x: 400, y: 300 })
    assert.notDeepEqual(spot, { x: taken[0].rect.x, y: taken[0].rect.y }, 'new node reused the occupied slot')
    assert.ok(!clashes({ ...spot, w: W, h: H }, taken[0].rect), 'new node overlapped the existing one')
})

test('twenty nodes placed in sequence never overlap each other', () => {
    const states = []
    for (let i = 0; i < 20; i++) {
        const spot = findFreeSpot(states, W, H, { x: 400, y: 300 })
        for (const s of states) {
            assert.ok(!clashes({ ...spot, w: W, h: H }, s.rect),
                `node ${i} at ${spot.x},${spot.y} overlapped ${s.rect.x},${s.rect.y}`)
        }
        states.push(rect(spot.x, spot.y))
    }
    assert.equal(states.length, 20)
    // every pair, not just consecutive ones
    for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
            assert.ok(!clashes(states[i].rect, states[j].rect), `pair ${i}/${j} overlapped`)
        }
    }
})

test('placement avoids a blocked region such as the properties panel', () => {
    const panel = { rect: { x: 0, y: 0, w: 900, h: 400 } }
    const spot = findFreeSpot([panel], W, H, { x: 400, y: 200 })
    assert.ok(!clashes({ ...spot, w: W, h: H }, panel.rect), 'node was placed under the panel')
})

test('entries without a rect are ignored rather than crashing', () => {
    const spot = findFreeSpot([{ rect: null }, {}], W, H, { x: 100, y: 100 })
    assert.equal(spot.x, snap(100 - W / 2))
    assert.equal(spot.y, snap(100 - H / 2))
})

test('nodes of different sizes are kept apart', () => {
    const states = [rect(0, 0, 300, 200)]
    const spot = findFreeSpot(states, 40, 40, { x: 150, y: 100 })
    assert.ok(!clashes({ ...spot, w: 40, h: 40 }, states[0].rect))
})

test('an exhausted search falls back to the centred slot instead of looping forever', () => {
    // A blocker far larger than the rings we allow the search to walk.
    const wall = { rect: { x: -100000, y: -100000, w: 200000, h: 200000 } }
    const spot = findFreeSpot([wall], W, H, { x: 0, y: 0 }, 2)
    assert.deepEqual(spot, { x: snap(-W / 2), y: snap(-H / 2) })
})
