import { describe, expect, test } from 'bun:test'

import { coalesceGlobalEvents, LiveStore, normalizeGlobalEvent, reconciliationTarget } from './live-store'

function event(type: string, properties: Record<string, unknown>, id = type) {
  return { directory: '/work/alpha', payload: { id, type, properties } }
}

describe('live event normalization', () => {
  test('adds server scope and monotonic observation metadata', () => {
    expect(normalizeGlobalEvent('server_1', event('session.status', { sessionID: 'ses_1' }), 3)).toEqual({
      serverKey: 'server_1',
      directory: '/work/alpha',
      id: 'session.status',
      type: 'session.status',
      properties: { sessionID: 'ses_1' },
      observedAt: 3,
    })
  })

  test('rejects malformed envelopes', () => {
    expect(normalizeGlobalEvent('server_1', { payload: {} }, 1)).toBeUndefined()
    expect(normalizeGlobalEvent('server_1', { directory: '', payload: {} }, 1)).toBeUndefined()
    expect(normalizeGlobalEvent('server_1', { directory: '/work', payload: { id: '1', type: 'x' } }, 1)).toBeUndefined()
    expect(normalizeGlobalEvent('server_1', event('message.part.delta', { sessionID: 'ses_1', delta: 'missing identities' }), 1)).toBeUndefined()
  })

  test('coalesces only consecutive deltas for the same target', () => {
    const values = [
      normalizeGlobalEvent('server_1', event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'hel' }, '1'), 1)!,
      normalizeGlobalEvent('server_1', event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'lo' }, '2'), 2)!,
      normalizeGlobalEvent('server_1', event('session.status', { sessionID: 'ses_1' }, '3'), 3)!,
      normalizeGlobalEvent('server_1', event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: '!' }, '4'), 4)!,
    ]
    const result = coalesceGlobalEvents(values)
    expect(result).toHaveLength(3)
    expect(result[0]?.properties.delta).toBe('hello')
    expect(result[2]?.properties.delta).toBe('!')
  })

  test('maps events to the narrow route reconciliation target', () => {
    const session = normalizeGlobalEvent('server_1', event('session.updated', { info: { id: 'ses_1' } }), 1)!
    const message = normalizeGlobalEvent('server_1', event('message.updated', {
      sessionID: 'ses_2', info: { id: 'msg_1' },
    }), 2)!
    const unrelated = normalizeGlobalEvent('server_1', event('pty.updated', { info: { id: 'pty_1' } }), 3)!
    expect(reconciliationTarget(session)).toEqual({ home: true, sessionId: 'ses_1' })
    expect(reconciliationTarget(message)).toEqual({ home: false, sessionId: 'ses_2' })
    expect(reconciliationTarget(unrelated)).toEqual({ home: false })
  })
})

describe('LiveStore', () => {
  test('publishes immutable revisions and guards older responses', () => {
    const store = new LiveStore('server_1')
    const before = store.getSnapshot()
    let notifications = 0
    store.subscribe(() => notifications += 1)
    const applied = store.apply([
      event('session.status', { sessionID: 'ses_1', status: { type: 'busy' } }, '1'),
      event('todo.updated', { sessionID: 'ses_1', todos: [] }, '2'),
    ])
    const after = store.getSnapshot()

    expect(applied).toHaveLength(2)
    expect(after).not.toBe(before)
    expect(after.revision).toBe(2)
    expect(notifications).toBe(1)
    expect(store.isResponseCurrent(0)).toBe(false)
    expect(store.isResponseCurrent(2)).toBe(true)
    expect(store.eventsForSession('ses_1')).toHaveLength(2)
  })

  test('accumulates deltas across separate stream flushes', () => {
    const store = new LiveStore('server_1')
    store.apply([event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'hel' }, '1')])
    store.apply([event('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'part_1', field: 'text', delta: 'lo' }, '2')])
    expect([...store.getSnapshot().latest.values()][0]?.properties.delta).toBe('hello')
    expect(store.eventsForSession('ses_1')).toHaveLength(1)
    expect(store.eventsForSession('ses_1')[0]?.properties.delta).toBe('hello')
    expect(store.eventsForSession('ses_1')[0]?.observedAt).toBe(2)
  })

  test('bounds latest entity state', () => {
    const store = new LiveStore('server_1')
    store.apply(Array.from({ length: 600 }, (_, index) =>
      event(`unknown.${index}`, { id: String(index) }, String(index)),
    ))
    expect(store.getSnapshot().latest.size).toBe(500)
  })

  test('requests authoritative reconciliation before a session journal can regress', () => {
    const store = new LiveStore('server_1')
    store.apply(Array.from({ length: 501 }, (_, index) =>
      event('session.status', { sessionID: 'ses_1', status: { type: index % 2 ? 'busy' : 'idle' } }, String(index)),
    ))
    expect(store.eventsForSession('ses_1')).toHaveLength(500)
    expect(store.drainOverflowedSessions()).toEqual(['ses_1'])
    expect(store.drainOverflowedSessions()).toEqual([])
    store.rebaseSession('ses_1', store.getSnapshot().revision)
    store.apply([event('session.status', {
      sessionID: 'ses_1', status: { type: 'busy' },
    }, 'after-rebase')])
    expect(store.drainOverflowedSessions()).toEqual([])
  })

  test('turns oversized session payloads into bounded refresh signals', () => {
    const normalized = normalizeGlobalEvent('server_1', event('session.diff', {
      sessionID: 'ses_1', diff: [{ patch: 'x'.repeat(40_000) }],
    }), 1)
    expect(normalized?.properties).toEqual({
      sessionID: 'ses_1', oversized: true, eventType: 'session.diff',
    })
  })

  test('signals when the bounded session registry evicts a journal', () => {
    const store = new LiveStore('server_1')
    store.apply(Array.from({ length: 21 }, (_, index) =>
      event('session.status', { sessionID: `ses_${index}`, status: { type: 'busy' } }, String(index)),
    ))
    expect(store.drainOverflowedSessions()).toContain('ses_0')
  })
})
