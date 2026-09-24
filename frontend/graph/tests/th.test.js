import test from 'node:test'
import assert from 'node:assert/strict'
import { Rect, State } from '../components/node.js'
import { Transition } from '../components/transition.js'
import { TransitionGroupManager } from '../components/th.js'

const node = (id, x = 0, y = 0) => new State(id, `n${id}`, new Rect(x, y, 150, 75))

// Build a transition the way GraphManager.makeTransitions does.
function link (mgr, from, to, id = 0, name = 't') {
    const grp = mgr.getTransitionGroup(from, to)
    const t = new Transition(id, name, from, to, grp)
    mgr.addTransition(from, to, t)
    return t
}

test('a group is created on first request and reused afterwards', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2)
    const first = mgr.getTransitionGroup(a, b)
    assert.equal(mgr.getTransitionGroup(a, b), first)
    assert.equal(mgr.getTransitionGroup(b, a), first, 'the reversed pair made a second group')
})

test('a new group starts empty', () => {
    const mgr = new TransitionGroupManager()
    assert.deepEqual(mgr.getTransitionGroup(node(1), node(2)).transitions, [])
})

test('two transitions between the same nodes share one group', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2)
    link(mgr, a, b, 1)
    link(mgr, a, b, 2)
    assert.equal(Object.keys(mgr.transitions_map.map).length, 1)
    assert.equal(mgr.getTransitioArray(a, b).length, 2)
})

test('the transition list is shared regardless of the argument order', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2)
    link(mgr, a, b, 1)
    assert.equal(mgr.getTransitioArray(b, a).length, 1)
})

test('an unlinked pair reports an empty transition list rather than undefined', () => {
    const mgr = new TransitionGroupManager()
    assert.deepEqual(mgr.getTransitioArray(node(1), node(2)), [])
})

test('different pairs get different groups', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2), c = node(3)
    link(mgr, a, b, 1)
    link(mgr, b, c, 2)
    assert.equal(Object.keys(mgr.transitions_map.map).length, 2)
})

test('removeTransitionsFor drops every group that touches the node', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2), c = node(3)
    link(mgr, a, b, 1)      // touches b
    link(mgr, b, c, 2)      // touches b
    link(mgr, a, c, 3)      // does not touch b
    mgr.removeTransitionsFor(b)
    assert.equal(Object.keys(mgr.transitions_map.map).length, 1, 'groups touching the node survived')
    assert.equal(mgr.getTransitioArray(a, c).length, 1, 'an unrelated group was removed')
    assert.deepEqual(mgr.getTransitioArray(a, b), [])
    assert.deepEqual(mgr.getTransitioArray(b, c), [])
})

test('removeTransitionsFor is a no-op for a node with no links', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2)
    link(mgr, a, b, 1)
    mgr.removeTransitionsFor(node(99))
    assert.equal(mgr.getTransitioArray(a, b).length, 1)
})

test('removing a node clears the transitions in both directions', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2)
    link(mgr, a, b, 1)
    link(mgr, b, a, 2)      // reverse direction, same group
    mgr.removeTransitionsFor(a)
    const [flat] = mgr.listTransitionsAndNestedGroupsInArray()
    assert.deepEqual(flat, [], 'transitions survived the removal of one of their nodes')
})

test('the flattened list holds every transition and every group', () => {
    const mgr = new TransitionGroupManager()
    const a = node(1), b = node(2), c = node(3)
    link(mgr, a, b, 1)
    link(mgr, a, b, 2)
    link(mgr, b, c, 3)
    const [transitions, groups] = mgr.listTransitionsAndNestedGroupsInArray()
    assert.equal(transitions.length, 3)
    assert.equal(groups.length, 2)
    assert.deepEqual(transitions.map(t => t.id).sort(), [1, 2, 3])
})

test('an empty manager flattens to two empty lists', () => {
    const [transitions, groups] = new TransitionGroupManager().listTransitionsAndNestedGroupsInArray()
    assert.deepEqual(transitions, [])
    assert.deepEqual(groups, [])
})

test('a group requested but never used contributes no transitions', () => {
    const mgr = new TransitionGroupManager()
    mgr.getTransitionGroup(node(1), node(2))
    const [transitions, groups] = mgr.listTransitionsAndNestedGroupsInArray()
    assert.deepEqual(transitions, [])
    assert.equal(groups.length, 1)
})
