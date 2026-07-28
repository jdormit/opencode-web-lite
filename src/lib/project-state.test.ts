import { describe, expect, test } from 'bun:test'
import { orderProjects, readProjectState, writeProjectState } from './project-state'

describe('project state', () => {
  test('is versioned, server-scoped, ordered, and hides closed projects', () => {
    let stored: string | null = null
    const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } }
    const state = readProjectState(storage)
    state.order.server_a = ['/b', '/a']
    state.closed.server_a = ['/b']
    state.last.server_a = '/a'
    writeProjectState(storage, state)
    const restored = readProjectState(storage)
    expect(restored.last.server_a).toBe('/a')
    expect(orderProjects([{ directory: '/a' }, { directory: '/b' }], 'server_a', restored)).toEqual([{ directory: '/a' }])
    expect(orderProjects([{ directory: '/b' }], 'server_b', restored)).toEqual([{ directory: '/b' }])
  })

  test('recovers safely from malformed persistence', () => {
    expect(readProjectState({ getItem: () => '{' })).toEqual({ version: 1, order: {}, last: {}, closed: {} })
  })
})
