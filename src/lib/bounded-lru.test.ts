import { describe, expect, test } from 'bun:test'

import { BoundedLru } from './bounded-lru'

describe('BoundedLru', () => {
  test('evicts the least recently used unpinned entry', () => {
    let now = 1
    const cache = new BoundedLru<string, number>(2, 1_000, () => now)
    cache.set('a', 1)
    now += 1
    cache.set('b', 2)
    now += 1
    expect(cache.get('a')).toBe(1)
    now += 1
    cache.set('c', 3)
    expect(cache.entries()).toEqual([['a', 1], ['c', 3]])
  })

  test('preserves pinned entries while removing idle state', () => {
    let now = 0
    const cache = new BoundedLru<string, number>(1, 10, () => now)
    cache.set('active', 1, true)
    cache.set('idle', 2)
    now = 20
    cache.evict()
    expect(cache.entries()).toEqual([['active', 1]])
  })

  test('does not revive expired entries and evicts after unpinning', () => {
    let now = 0
    const cache = new BoundedLru<string, number>(1, 10, () => now)
    cache.set('old', 1)
    now = 11
    expect(cache.get('old')).toBeUndefined()

    cache.set('pinned', 2, true)
    cache.set('other', 3, true)
    expect(cache.size).toBe(2)
    now += 1
    cache.pin('pinned', false)
    expect(cache.entries()).toEqual([['other', 3]])
  })

  test('reports entries evicted by the size bound', () => {
    const evicted: string[] = []
    const cache = new BoundedLru<string, number>(1, 1_000, Date.now, (key) => evicted.push(key))
    cache.set('a', 1)
    cache.set('b', 2)
    expect(evicted).toEqual(['a'])
  })
})
