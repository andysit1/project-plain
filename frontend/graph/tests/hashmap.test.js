import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHashMap } from '../components/utils/hashmap.js'

test('a pair reads back the value it was stored with', () => {
    const m = new PairHashMap()
    m.set('A', 'B', 'value')
    assert.equal(m.get('A', 'B'), 'value')
})

test('the key does not depend on the order of the pair', () => {
    const m = new PairHashMap()
    m.set('A', 'B', 'first')
    assert.equal(m.get('B', 'A'), 'first')
    m.set('B', 'A', 'second')
    assert.equal(m.get('A', 'B'), 'second')
    assert.equal(Object.keys(m.map).length, 1, 'the reversed pair created a second entry')
})

test('numeric and string ids collapse to the same key', () => {
    const m = new PairHashMap()
    m.set(1, 2, 'x')
    assert.equal(m.get('1', '2'), 'x')
})

test('an unknown pair reads back as undefined', () => {
    const m = new PairHashMap()
    assert.equal(m.get('A', 'B'), undefined)
})

test('a pair of the same value is a valid key', () => {
    const m = new PairHashMap()
    m.set(3, 3, 'self')
    assert.equal(m.get(3, 3), 'self')
})

test('delete removes the pair in either order', () => {
    const m = new PairHashMap()
    m.set('A', 'B', 'x')
    m.delete('B', 'A')
    assert.equal(m.get('A', 'B'), undefined)
    assert.equal(Object.keys(m.map).length, 0)
})

test('list reports every pair with its value', () => {
    const m = new PairHashMap()
    m.set(1, 2, 'one-two')
    m.set(2, 3, 'two-three')
    const listed = m.list()
    assert.equal(listed.length, 2)
    const found = listed.find(e => e.value === 'one-two')
    assert.deepEqual([...found.pair].sort(), ['1', '2'])
})

test('two maps do not share storage', () => {
    const a = new PairHashMap()
    const b = new PairHashMap()
    a.set('A', 'B', 'only-in-a')
    assert.equal(b.get('A', 'B'), undefined)
})
