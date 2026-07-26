import { beforeEach, describe, expect, test } from 'bun:test'
import type { NormalizedGlobalEvent } from './live-store'
import { NotificationStore } from './notifications'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
})

function event(type: string, id: string, properties: Record<string, unknown>): NormalizedGlobalEvent {
  return { serverKey: 'server_1', directory: '/work', id, type, properties, observedAt: 1 }
}

describe('NotificationStore', () => {
  beforeEach(() => values.clear())

  test('records only authoritatively confirmed root completion and marks it viewed', () => {
    const store = new NotificationStore('server_1', () => 100)
    store.apply([event('session.status', 'idle_initial', { sessionID: 'ses_1', status: { type: 'idle' } })])
    expect(store.getSnapshot().entries).toHaveLength(0)
    store.apply([event('session.idle', 'idle', { sessionID: 'ses_1', notificationRoot: true, notificationToken: 'turn_1' })])
    store.apply([event('session.status', 'idle_status', { sessionID: 'ses_1', status: { type: 'idle' }, notificationRoot: true, notificationToken: 'turn_1' })])
    expect(store.getSnapshot().unseen).toBe(1)
    expect(store.getSnapshot().entries[0]?.kind).toBe('completion')
    store.markViewed('ses_1')
    expect(store.getSnapshot().unseen).toBe(0)
  })

  test('retains separate fast completions when their transition tokens differ', () => {
    const store = new NotificationStore('server_1', () => 100)
    store.apply([
      event('session.idle', 'idle_1', { sessionID: 'ses_1', notificationRoot: true, notificationToken: 'turn_1' }),
      event('session.idle', 'idle_2', { sessionID: 'ses_1', notificationRoot: true, notificationToken: 'turn_2' }),
    ])
    expect(store.getSnapshot().entries).toHaveLength(2)
  })

  test('records completion as viewed when its route is already active', () => {
    const store = new NotificationStore('server_1')
    store.apply([event('session.idle', 'idle', {
      sessionID: 'ses_1', notificationRoot: true, notificationViewed: true,
    })])
    expect(store.getSnapshot().entries).toHaveLength(1)
    expect(store.getSnapshot().unseen).toBe(0)
  })

  test('suppresses child completion but retains child errors and requests', () => {
    const store = new NotificationStore('server_1', () => 100)
    store.apply([
      event('session.created', 'created', { info: { id: 'ses_child', parentID: 'ses_parent' } }),
      event('session.status', 'busy', { sessionID: 'ses_child', status: { type: 'busy' } }),
      event('session.idle', 'idle', { sessionID: 'ses_child' }),
      event('session.error', 'error', { sessionID: 'ses_child' }),
      event('permission.asked', 'permission', { sessionID: 'ses_child' }),
    ])
    expect(store.getSnapshot().entries.map((entry) => entry.kind)).toEqual(['error', 'request'])
  })

  test('deduplicates events and bounds retained entries', () => {
    let now = 1_000
    const store = new NotificationStore('server_1', () => now)
    const errors = Array.from({ length: 110 }, (_, index) =>
      event('session.error', `error_${index}`, { sessionID: `ses_${index}` }))
    store.apply([...errors, errors.at(-1)!])
    expect(store.getSnapshot().entries).toHaveLength(100)
    expect(store.getSnapshot().entries[0]?.sessionID).toBe('ses_10')
    now += 8 * 24 * 60 * 60_000
    store.apply([event('session.error', 'new', { sessionID: 'ses_new' })])
    expect(store.getSnapshot().entries.map((entry) => entry.sessionID)).toEqual(['ses_new'])
  })

  test('persists server-scoped preferences', () => {
    const store = new NotificationStore('server_1')
    store.setPreference('error', true)
    store.setPreference('completion', true, true)
    const restored = new NotificationStore('server_1')
    expect(restored.getSnapshot().preferences.error).toBe(true)
    expect(restored.getSnapshot().preferences.sounds.completion).toBe(true)
    expect(new NotificationStore('server_2').getSnapshot().preferences.error).toBe(false)
  })

  test('clears notifications for only one project directory', () => {
    const store = new NotificationStore('server_1')
    store.apply([
      event('session.error', 'one', { sessionID: 'ses_1' }),
      { ...event('session.error', 'two', { sessionID: 'ses_2' }), directory: '/other' },
    ])
    store.clearDirectory('/work')
    expect(store.getSnapshot().entries.map((entry) => entry.sessionID)).toEqual(['ses_2'])
  })

  test('clears request attention when the request is resolved', () => {
    const store = new NotificationStore('server_1')
    store.apply([event('permission.asked', 'asked', { sessionID: 'ses_1' })])
    expect(store.getSnapshot().entries).toHaveLength(1)
    store.apply([event('permission.replied', 'replied', { sessionID: 'ses_1' })])
    expect(store.getSnapshot().entries).toHaveLength(0)
  })
})
